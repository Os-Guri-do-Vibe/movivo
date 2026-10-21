/**
 * Avaliação da AGENDA FLEXÍVEL contra o modelo REAL (manual, custa tokens).
 *
 * Roda o golden set de 50 frases (`schedule-golden-set.fixture.ts`) por dois componentes de
 * produção, com os prompts de produção:
 *   1. `ScheduleRequestParserService` — o pedido vira ação/dia/treino? (medido contra o esperado)
 *   2. `IntentClassifier` (só o fallback por LLM; o kNN fica de fora) — a frase vai para a rota
 *      certa (agenda, link ou outro assunto)?
 *
 * O adaptador de LLM repete o que o `LlmRouter` faz na porta de saída: PII scrubber sobre
 * `system` e `messages` ANTES de chamar o provedor. Foi o scrubber que quebrou a agenda em
 * produção (datas viravam `[data]`), então ele não pode ficar de fora desta avaliação.
 *
 * ⚠️ Dados 100% sintéticos (nenhum aluno real), por isso chama o adaptador direto em vez do
 * `LlmRouter` — o gate HEALTH não se aplica. Não usar com dado de aluno.
 *
 * Uso (chave no ambiente; escolha o provedor):
 *   cd apps/api
 *   EVAL_PROVIDER=deepseek DEEPSEEK_API_KEY=... pnpm exec tsx src/scripts/eval-agenda.ts
 *   EVAL_PROVIDER=openai OPENAI_API_KEY=... pnpm exec tsx src/scripts/eval-agenda.ts
 *   EVAL_PROVIDER=anthropic ANTHROPIC_API_KEY=... pnpm exec tsx src/scripts/eval-agenda.ts
 * Opcionais: EVAL_MODEL, EVAL_RUNS (padrão 1), EVAL_MIN_PASS (padrão 0.9).
 */
import { PinoLogger } from 'nestjs-pino';

import { IntentClassifier } from '../modules/ai-coach/intent/intent-classifier.service';
import type { LlmRouter } from '../modules/ai-coach/llm/llm-router.service';
import type { LLMProvider, LLMRequest } from '../modules/ai-coach/llm/llm.types';
import { scrubPII } from '../modules/ai-coach/llm/pii-scrubber';
import {
  AnthropicProvider,
  DeepSeekProvider,
  OpenAiProvider,
} from '../modules/ai-coach/llm/providers';
import {
  GOLDEN_USER,
  SCHEDULE_GOLDEN_SET,
  scenarioRequest,
  type ExpectedRoute,
  type ScheduleGoldenCase,
} from '../modules/coach/schedule-golden-set.fixture';
import {
  ScheduleRequestParserService,
  type ParsedScheduleRequest,
} from '../modules/coach/schedule-request-parser.service';

function makeProvider(): LLMProvider {
  const kind = process.env.EVAL_PROVIDER ?? 'deepseek';
  const model = process.env.EVAL_MODEL;
  if (kind === 'openai') {
    return new OpenAiProvider('OPENAI_GPT41', model ?? 'gpt-4.1', process.env.OPENAI_API_KEY);
  }
  if (kind === 'anthropic') {
    return new AnthropicProvider(
      'ANTHROPIC_SONNET45',
      model ?? 'claude-sonnet-4-5',
      process.env.ANTHROPIC_API_KEY,
    );
  }
  if (kind === 'deepseek') {
    return new DeepSeekProvider(model ?? 'deepseek-v4-pro', process.env.DEEPSEEK_API_KEY);
  }
  throw new Error(`EVAL_PROVIDER inválido: ${kind}`);
}

/** O que o `LlmRouter` faz na porta de saída, sem banco, métricas nem gate (dado sintético). */
function scrubbingRouter(provider: LLMProvider): LlmRouter {
  return {
    async complete(request: LLMRequest) {
      const result = await provider.complete(
        {
          system: scrubPII(request.system, request.user),
          messages: request.messages.map((m) => ({
            ...m,
            content: scrubPII(m.content, request.user),
          })),
          maxTokens: request.maxTokens ?? 400,
          temperature: request.temperature ?? 0,
          json: request.json ?? false,
          cache: false,
        },
        AbortSignal.timeout(60_000),
      );
      return { text: result.text };
    },
  } as unknown as LlmRouter;
}

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

function describeParsed(parsed: ParsedScheduleRequest): string {
  const bits: string[] = [parsed.action];
  if (parsed.date) bits.push(`dia=${parsed.date}`);
  if (parsed.invalidDate) bits.push(`fora=${parsed.invalidDate}`);
  if (parsed.sessionKey) bits.push(`treino=${parsed.sessionKey}`);
  if (parsed.placements.length > 0) {
    bits.push(`posições=${parsed.placements.map((p) => `${p.sessionKey}@${p.date}`).join(',')}`);
  }
  if (parsed.leaveOut.length > 0) {
    bits.push(`fora=${parsed.leaveOut.map((l) => l.sessionKey ?? l.date).join(',')}`);
  }
  return bits.join(' ');
}

/** Devolve os motivos da divergência; lista vazia = a leitura bate com o esperado. */
function judgeParse(c: ScheduleGoldenCase, parsed: ParsedScheduleRequest): string[] {
  const reasons: string[] = [];
  if (!c.actions.includes(parsed.action)) {
    reasons.push(`ação ${parsed.action}, esperado ${c.actions.join('|')}`);
  }
  if (c.date === 'FORA') {
    if (parsed.invalidDate === null) reasons.push('esperava dia fora da semana (recusa)');
  } else if (c.date !== undefined && c.actions.includes(parsed.action)) {
    if (parsed.date !== c.date) reasons.push(`dia ${parsed.date}, esperado ${c.date}`);
  }
  if (c.sessionKey !== undefined && parsed.sessionKey !== c.sessionKey) {
    reasons.push(`treino ${parsed.sessionKey}, esperado ${c.sessionKey}`);
  }
  if (c.placements) {
    const got = new Map(parsed.placements.map((p) => [p.sessionKey, p.date]));
    for (const want of c.placements) {
      if (got.get(want.sessionKey) !== want.date) {
        reasons.push(
          `posição ${want.sessionKey} em ${got.get(want.sessionKey)}, esperado ${want.date}`,
        );
      }
    }
  }
  if (c.leaveOut) {
    const got = new Set(parsed.leaveOut.map((l) => l.sessionKey));
    for (const key of c.leaveOut) if (!got.has(key)) reasons.push(`faltou deixar ${key} de fora`);
  }
  return reasons;
}

function routeOf(intent: string): ExpectedRoute {
  if (intent === 'AJUSTE_AGENDA') return 'AGENDA';
  if (intent === 'PEDIDO_LINK_TREINO') return 'LINK';
  return 'OTHER';
}

async function main(): Promise<void> {
  const provider = makeProvider();
  if (!provider.hasCredentials()) throw new Error('Chave do provedor ausente no ambiente.');
  const runs = Number(process.env.EVAL_RUNS ?? 1);
  const minPass = Number(process.env.EVAL_MIN_PASS ?? 0.9);
  const llm = scrubbingRouter(provider);
  const logger = {
    setContext: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  } as unknown as PinoLogger;

  const parser = new ScheduleRequestParserService(llm, logger);
  const classifier = new IntentClassifier(
    // Sem kNN: o embedding "indisponível" faz o classificador usar o fallback por LLM.
    {
      embed: async () => {
        throw new Error('sem embedding nesta avaliação');
      },
    } as never,
    {} as never,
    llm,
    { recent: async () => [] } as never,
    logger,
  );

  let parseTotal = 0;
  let parsePassed = 0;
  let routeTotal = 0;
  let routePassed = 0;
  let guardrailed = 0;
  /** Pedido de agenda que o fluxo trataria como "não entendi"/recusa quando deveria atender. */
  let missedRequests = 0;
  /** Frase que NÃO era pedido de agenda e foi lida como pedido (aplicaria uma mudança indevida). */
  let falseApplies = 0;
  const failures: string[] = [];

  for (const c of SCHEDULE_GOLDEN_SET) {
    for (let run = 1; run <= runs; run++) {
      const parsed = await parser.parse({
        userId: 'eval',
        operationId: `eval-${c.id}-${run}`,
        user: GOLDEN_USER,
        personaSlot: null,
        ...scenarioRequest(c.message, c.openQuestion),
      });
      const parseReasons = judgeParse(c, parsed);
      parseTotal++;
      if (parseReasons.length === 0) parsePassed++;
      else
        failures.push(`[parser] ${c.id}: ${parseReasons.join('; ')} → ${describeParsed(parsed)}`);
      if (c.route === 'AGENDA' && (parsed.action === 'OUTRO' || parsed.action === 'LINK')) {
        missedRequests++;
      }
      if (c.route === 'OTHER' && !c.actions.includes(parsed.action)) falseApplies++;

      const intent = await classifier.classify({
        userId: 'eval',
        user: GOLDEN_USER,
        message: c.message,
      });
      if (intent.stage === 'GUARDRAIL') {
        guardrailed++;
        continue;
      }
      routeTotal++;
      const route = routeOf(intent.intent);
      // Uma frase que não é agenda e foi roteada para a agenda é CONTIDA quando o parser lê
      // "outro assunto": o fluxo se abstém e a resposta segue para o Coach (rede de segurança).
      const contained = c.route === 'OTHER' && route === 'AGENDA' && parsed.action === 'OUTRO';
      if (route === c.route || contained || c.skipRoute) routePassed++;
      else failures.push(`[rota] ${c.id}: ${intent.intent}, esperado ${c.route}`);
    }
  }

  const parseRate = parsePassed / parseTotal;
  const routeRate = routeTotal === 0 ? 1 : routePassed / routeTotal;
  out(
    `Provedor: ${provider.name} (${provider.model}) — ${SCHEDULE_GOLDEN_SET.length} frases x ${runs}`,
  );
  out(`Parser:        ${parsePassed}/${parseTotal} = ${(parseRate * 100).toFixed(1)}%`);
  out(
    `Rota (LLM):    ${routePassed}/${routeTotal} = ${(routeRate * 100).toFixed(1)}%` +
      (guardrailed > 0 ? ` (${guardrailed} cortadas pelo guardrail clínico)` : ''),
  );
  out(`Pedidos de agenda lidos como "outro assunto" (o aluno seria ignorado): ${missedRequests}`);
  out(`Frases que não eram agenda lidas como pedido de mudança: ${falseApplies}`);
  for (const failure of failures) out(`✗ ${failure}`);
  process.exit(parseRate >= minPass && routeRate >= minPass ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(2);
});
