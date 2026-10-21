/**
 * Leitura do pedido de agenda do aluno (agenda flexível, 2026-10-20).
 *
 * A IA só TRADUZ a frase do aluno para um pedido estruturado ("amanhã quero descansar" →
 * `DESCANSAR` na data de amanhã). Quem decide o novo arranjo da semana é o planejador
 * determinístico (`schedule-planner.ts`). Mesmo molde de `SubstitutionTargetService`: JSON
 * estrito, temperatura 0, e a IA só pode devolver datas da semana e chaves de treino que
 * RECEBEU na lista — qualquer valor fora dela (alucinação) é descartado, nunca aceito.
 *
 * Pedidos que não precisam de IA ("desfazer", "me manda o link") são reconhecidos por regra
 * antes de chamar o modelo.
 */
import { Injectable } from '@nestjs/common';
import type { BiologicalSex } from '@movivo/shared';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import {
  UNTRUSTED_CONTEXT_POLICY,
  untrustedDataEnvelope,
} from '../ai-coach/context/untrusted-context';
import { LlmRouter } from '../ai-coach/llm/llm-router.service';
import type { ScrubUser } from '../ai-coach/llm/llm.types';
import { addDays, type SessionSelector } from '../workout/schedule-planner';

const ACTIONS = [
  'TREINAR',
  'DESCANSAR',
  'REORGANIZAR',
  'ESCOLHA',
  'REGISTRAR',
  'DESFAZER',
  'LINK',
  'OUTRO',
] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * O modelo NÃO recebe nem devolve datas: o `LlmRouter` passa todo conteúdo pelo PII scrubber, que
 * troca qualquer `AAAA-MM-DD` por `[data]` (achado 2026-10-21, produção: o parser via a semana
 * toda como `[data]`, inventava uma data e o fluxo recusava com "esse dia já passou"). Ele
 * escolhe um DIA por referência e o servidor converte para a data da semana.
 */
const WEEKDAY_REF: Record<string, string> = {
  segunda: 'SEG',
  terça: 'TER',
  quarta: 'QUA',
  quinta: 'QUI',
  sexta: 'SEX',
  sábado: 'SAB',
  domingo: 'DOM',
};
const OUTSIDE_WEEK_REF = 'FORA_DA_SEMANA';

function normalizeRef(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

const parsedSchema = z
  .object({
    action: z.enum(ACTIONS),
    date: z.string().nullable().optional(),
    sessionKey: z.string().max(60).nullable().optional(),
    leaveOut: z
      .array(
        z
          .object({
            date: z.string().nullable().optional(),
            sessionKey: z.string().max(60).nullable().optional(),
          })
          .strict(),
      )
      .max(7)
      .optional(),
    placements: z
      .array(z.object({ sessionKey: z.string().max(60), date: z.string().nullable() }).strict())
      .max(7)
      .optional(),
  })
  .strict();

export type ScheduleRequestAction = (typeof ACTIONS)[number];

export interface ParsedScheduleRequest {
  action: ScheduleRequestAction;
  /** Data do pedido, já validada contra a semana; `null` quando o aluno não disse. */
  date: string | null;
  /**
   * Data bem formada que o aluno pediu mas a regra não aceita (semana que vem, dia antigo): o fluxo
   * RECUSA em vez de tratar como "não disse" (que vale "hoje"). `null` quando nenhuma foi recusada.
   */
  invalidDate: string | null;
  sessionKey: string | null;
  leaveOut: SessionSelector[];
  placements: Array<{ sessionKey: string; date: string | null }>;
}

export interface WeekDayForParser {
  date: string;
  /** "terça". */
  weekday: string;
  /** Chave do treino, ou `null` no descanso. */
  sessionKey: string | null;
  situation: 'feito' | 'previsto' | 'sem registro' | 'descanso';
}

export interface ParseScheduleRequest {
  userId: string;
  /** Dias recém-passados que o aluno ainda pode registrar (ontem, anteontem), com o dia da semana. */
  recentDays?: ReadonlyArray<{ date: string; weekday: string }>;
  operationId: string;
  user: ScrubUser;
  message: string;
  today: string;
  week: readonly WeekDayForParser[];
  sessions: ReadonlyArray<{ key: string; label: string }>;
  /** Pergunta que o Coach acabou de fazer (qual treino deixar de fora), se houver. */
  openQuestion?: string;
  personaSlot: BiologicalSex | null;
}

const UNDO =
  /\b(desfaz(er)?|desfa[çc]a|volta(r)?\s+(como|pro|para|ao)\s+(estava|original|normal|plano)|cancela(r)?\s+(a\s+|o\s+)?(mudan[çc]a|ajuste|altera[çc][ãa]o))\b/i;

const EMPTY = (action: ScheduleRequestAction): ParsedScheduleRequest => ({
  action,
  date: null,
  invalidDate: null,
  sessionKey: null,
  leaveOut: [],
  placements: [],
});

function parseJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '');
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('JSON ausente');
  return JSON.parse(trimmed.slice(first, last + 1));
}

/** Reconhecimento por regra, sem custo de modelo. */
export function quickScheduleAction(message: string): 'DESFAZER' | null {
  return UNDO.test(message) ? 'DESFAZER' : null;
}

@Injectable()
export class ScheduleRequestParserService {
  constructor(
    private readonly llm: LlmRouter,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ScheduleRequestParserService.name);
  }

  async parse(request: ParseScheduleRequest): Promise<ParsedScheduleRequest> {
    const quick = quickScheduleAction(request.message);
    if (quick) return EMPTY(quick);

    const dates = new Set([
      ...request.week.map((day) => day.date),
      ...(request.recentDays ?? []).map((day) => day.date),
    ]);
    const keys = new Set(request.sessions.map((session) => session.key));

    // Referência de dia → data. Datas de fora da semana nunca viram data: viram `invalidDate`.
    const refs = new Map<string, string>();
    for (const day of request.week) {
      const ref = WEEKDAY_REF[day.weekday];
      if (ref) refs.set(ref, day.date);
      // O nome por extenso ("QUARTA") também vale, se o modelo não seguir a sigla.
      refs.set(normalizeRef(day.weekday), day.date);
    }
    const nearDays: ReadonlyArray<readonly [string, string]> = [
      ['HOJE', request.today],
      ['AMANHA', addDays(request.today, 1)],
      ['ONTEM', addDays(request.today, -1)],
      ['ANTEONTEM', addDays(request.today, -2)],
    ];
    for (const [ref, date] of nearDays) if (dates.has(date)) refs.set(ref, date);
    const lastDay = request.week.at(-1)?.date ?? request.today;
    const afterWeek = addDays(lastDay, 1);

    // Primeiro dia bem formado que a regra não aceita (fora da semana): quem chama recusa o pedido.
    let invalidDate: string | null = null;
    const cleanDate = (value: string | null | undefined): string | null => {
      if (!value) return null;
      const ref = normalizeRef(value);
      const byRef = refs.get(ref);
      if (byRef) return byRef;
      if (ref === OUTSIDE_WEEK_REF || ref === 'AMANHA') {
        invalidDate ??= afterWeek;
        return null;
      }
      // Compatibilidade: uma data ISO só vale se for da semana recebida.
      if (ISO_DATE.test(value) && dates.has(value)) return value;
      if (ISO_DATE.test(value)) invalidDate ??= value;
      return null;
    };
    const cleanKey = (value: string | null | undefined): string | null =>
      value && keys.has(value) ? value : null;

    try {
      const result = await this.llm.complete({
        purpose: 'AI_RESPONSE',
        userId: request.userId,
        operationId: request.operationId,
        user: request.user,
        dataClass: 'HEALTH',
        temperature: 0,
        json: true,
        maxTokens: 400,
        // `ai_jobs.intent` é varchar(30): manter o rótulo curto (ver SubstitutionTargetService).
        intent: 'schedule_request_parse',
        personaSlot: request.personaSlot,
        system:
          'Você lê a mensagem de WhatsApp de um aluno de treino e a traduz para um pedido ' +
          'estruturado sobre a AGENDA da semana dele (quando treinar, quando descansar). Você NÃO ' +
          'decide nada: só extrai o que ele pediu. Receberá o dia de hoje, a semana (segunda a ' +
          'domingo, com o treino previsto em cada dia) e a lista de treinos. Responda somente JSON ' +
          'estrito: {"action": "...", "date": "<DIA>"|null, "sessionKey": "<chave>"|null, ' +
          '"leaveOut": [{"date": "<DIA>"|null, "sessionKey": "<chave>"|null}], ' +
          '"placements": [{"sessionKey": "<chave>", "date": "<DIA>"|null}]}.\n' +
          'action: TREINAR = quer treinar num dia (hoje se não disser outro) um treino do plano, ' +
          'inclusive "passa/joga o treino de hoje (ou de outro dia) para tal dia"; DESCANSAR = ' +
          'quer descansar num dia (mover os treinos para frente); REGISTRAR = ele JÁ ' +
          'treinou num dia que passou (ontem, anteontem) e quer registrar o treino (date = o dia ' +
          'em que treinou, sessionKey = o treino que fez, se disse); REORGANIZAR = diz ' +
          'onde fica CADA treino (use placements; date null = o treino fica de fora); ESCOLHA = ' +
          'só responde qual treino deixar de fora à pergunta em aberto (use leaveOut); DESFAZER = ' +
          'quer voltar ao que estava; LINK = só pede o link do treino de hoje; OUTRO = qualquer ' +
          'outra coisa (inclui perguntar, tirar dúvida ou conversar sem pedir mudança).\n' +
          'date NUNCA é uma data: é um <DIA> escolhido entre HOJE, AMANHA, ONTEM, ANTEONTEM, SEG, ' +
          'TER, QUA, QUI, SEX, SAB, DOM (os dias da semana recebida, campo "dia") ou ' +
          'FORA_DA_SEMANA, para um dia que não está nesta semana ("quinta da semana que vem", ' +
          '"dia 30"). Converta "hoje", "amanhã", "quinta", "sábado" para o <DIA> certo. Use null ' +
          'SÓ quando ele não disse nenhum dia. Se ele se corrige no meio da fala ("pra sexta, ' +
          'não, pra sábado"), vale o último dia dito. sessionKey: a chave do treino que ele citou, ' +
          'por letra ("treino A"), foco ("o de pernas"), posição ou pelo dia em que está previsto ' +
          '("o treino de quarta", "o de hoje": é a sessionKey desse dia na semana recebida), ' +
          'SOMENTE da lista de treinos recebida; null se ele não citou ou se não der para apontar ' +
          'com segurança. Cansaço ou sono ruim explicam o pedido, não o mudam: "estou cansado, ' +
          'amanhã descanso" é DESCANSAR AMANHA. O nome com que ele chama o Coach (Léo, ' +
          'Leozinho) e as hesitações não mudam o pedido; pedidos para o profissional rever o ' +
          'protocolo no futuro não são agenda desta semana, ignore essa parte. ' +
          UNTRUSTED_CONTEXT_POLICY,
        messages: [
          {
            role: 'user',
            content: untrustedDataEnvelope('PEDIDO_DE_AGENDA', {
              hoje: {
                dia: 'HOJE',
                weekday: request.week.find((day) => day.date === request.today)?.weekday ?? null,
              },
              semana: request.week.map((day) => ({
                dia: WEEKDAY_REF[day.weekday] ?? null,
                weekday: day.weekday,
                ehHoje: day.date === request.today,
                sessionKey: day.sessionKey,
                situation: day.situation,
              })),
              diasRecentesParaRegistro: (request.recentDays ?? []).map((day) => ({
                dia: day.date === addDays(request.today, -1) ? 'ONTEM' : 'ANTEONTEM',
                weekday: day.weekday,
              })),
              treinos: request.sessions,
              perguntaEmAberto: request.openQuestion ?? null,
              mensagem: request.message,
            }),
          },
        ],
      });
      const parsed = parsedSchema.parse(parseJson(result.text));
      const date = cleanDate(parsed.date);
      const leaveOut = (parsed.leaveOut ?? [])
        .map((item) => ({
          ...(cleanDate(item.date) ? { date: cleanDate(item.date) as string } : {}),
          ...(cleanKey(item.sessionKey) ? { sessionKey: cleanKey(item.sessionKey) as string } : {}),
        }))
        .filter((item) => item.date !== undefined || item.sessionKey !== undefined);
      const placements = (parsed.placements ?? []).flatMap(
        (placement): Array<{ sessionKey: string; date: string | null }> => {
          const sessionKey = cleanKey(placement.sessionKey);
          if (!sessionKey) return [];
          if (placement.date === null) return [{ sessionKey, date: null }];
          const placed = cleanDate(placement.date);
          return placed ? [{ sessionKey, date: placed }] : [];
        },
      );
      this.logger.info(
        {
          event: 'schedule_request_parsed',
          userId: request.userId,
          action: parsed.action,
          day: parsed.date ?? null,
          resolved: date,
          invalidDate,
          sessionKey: parsed.sessionKey ?? null,
          placements: placements.length,
          leaveOut: leaveOut.length,
        },
        'pedido de agenda lido',
      );
      return {
        action: parsed.action,
        date,
        invalidDate,
        sessionKey: cleanKey(parsed.sessionKey),
        leaveOut,
        placements,
      };
    } catch (error) {
      this.logger.warn(
        { event: 'schedule_request_parse_failed', err: String(error) },
        'leitura do pedido de agenda falhou — o Coach pede ao aluno para repetir',
      );
      return EMPTY('OUTRO');
    }
  }
}
