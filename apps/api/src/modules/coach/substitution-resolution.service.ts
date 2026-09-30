/**
 * Leitura de um turno do fluxo de substituição de exercício (achado 2026-09-02, reescrito em
 * 2026-09-30 para a troca em lote e o alcance da troca).
 *
 * Dado o estado do fluxo (os exercícios-alvo, o que já foi oferecido a cada um) e a conversa
 * recente, decide numa única chamada, para CADA alvo: (1) qual substituto o aluno escolheu; (2)
 * o ALCANCE da troca — só hoje ou no protocolo — quando ele o disse de forma explícita; (3) se
 * recusou tudo o que foi oferecido; (4) se nomeou um exercício fora das listas. E, para o
 * turno como um todo: se a mensagem ainda é sobre esta troca, e se o aluno mencionou dor.
 *
 * Achado 2026-09-02 (reproduzido ao vivo): a primeira versão pedia pra IA EXTRAIR o nome exato
 * do exercício escolhido a partir do texto livre — e falhava sempre, porque a oferta verbaliza o
 * candidato de forma humanizada ("supino reto com halter"), não com o nome literal do catálogo
 * ("Supino Reto (Halter)"). A correção vale até hoje: a IA ESCOLHE (ou não) um item de uma
 * lista FECHADA de ids que RECEBEU — mesmo padrão do `SubstitutionTargetService` — e um id fora
 * da lista é tratado como "não escolheu".
 */
import { Injectable } from '@nestjs/common';
import type { BiologicalSex } from '@movivo/shared';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import { untrustedDataEnvelope } from '../ai-coach/context/untrusted-context';
import { LlmRouter } from '../ai-coach/llm/llm-router.service';
import type { ScrubUser } from '../ai-coach/llm/llm.types';
import type { ProtocolExerciseRef } from './substitution-target.service';

/** Alcance da troca: só a sessão de hoje (recomendação no WhatsApp) ou o protocolo. */
export type SubstitutionScope = 'TODAY' | 'PROTOCOL';

const turnSchema = z.object({
  topic: z.enum(['CONTINUE', 'NEW_TOPIC']),
  pain: z.boolean(),
  targets: z.array(
    z.object({
      targetId: z.string().min(1).max(100),
      chosenExerciseId: z.string().min(1).max(100).nullable(),
      scope: z.enum(['TODAY', 'PROTOCOL']).nullable(),
      rejectedOffered: z.boolean(),
      requestedOutsideList: z.boolean(),
    }),
  ),
});

export interface TurnTargetInput {
  /** Id do exercício do protocolo que o aluno quer trocar. */
  targetId: string;
  targetName: string;
  /** Opções já mostradas ao aluno para este alvo — só estas aceitam referência posicional. */
  offered: readonly ProtocolExerciseRef[];
  /** Demais opções seguras (ainda não mostradas): aceitas só quando NOMEADAS explicitamente. */
  others: readonly ProtocolExerciseRef[];
  /** O que já ficou definido em turnos anteriores (o aluno pode mudar de ideia). */
  current: { chosenName: string | null; scope: SubstitutionScope | null };
}

export interface ResolveTurnRequest {
  userId: string;
  operationId: string;
  user: ScrubUser;
  /** Janela recente da conversa (`ctx.volatileSuffix`), incluindo a mensagem atual do aluno. */
  recentConversation: string;
  targets: readonly TurnTargetInput[];
  personaSlot: BiologicalSex | null;
}

export interface TurnTargetResult {
  targetId: string;
  chosenExerciseId: string | null;
  scope: SubstitutionScope | null;
  rejectedOffered: boolean;
  requestedOutsideList: boolean;
}

export type ResolveTurnResult =
  /** `ok: false` = a leitura falhou (LLM indisponível/JSON inválido): nada foi entendido. */
  | { ok: false }
  | { ok: true; topic: 'CONTINUE' | 'NEW_TOPIC'; pain: boolean; targets: TurnTargetResult[] };

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

const SYSTEM =
  'Você lê uma conversa recente entre um aluno e o AI Coach da MOVIVO sobre TROCAR exercícios ' +
  'do protocolo de treino dele. Para cada exercício-alvo recebido (com as opções seguras já ' +
  'oferecidas, `offered`, e as demais opções seguras, `others`), decida sobre a ÚLTIMA ' +
  'mensagem do aluno, usando as anteriores só como contexto:\n' +
  '1) `chosenExerciseId`: ela ESCOLHE um substituto? O id TEM que ser exatamente um dos ids ' +
  'de `offered` ou `others` DAQUELE alvo. Referência por posição ("a segunda", "o primeiro") ' +
  'ou por característica só vale para `offered`; para `others` só vale quando o aluno NOMEIA o ' +
  'exercício. Confirmação vaga ("ok", "beleza", "pode ser") sem apontar nenhuma opção NÃO ' +
  'conta: null. Se o aluno não falou deste alvo agora, mantenha null.\n' +
  '2) `scope`: o aluno disse EXPLICITAMENTE o alcance da troca? "TODAY" só quando ele limita ' +
  'ao momento ("hoje", "agora", "só dessa vez", "só por hoje", "nesse treino", "só hoje"). ' +
  '"PROTOCOL" só quando quer a mudança no protocolo ("no meu protocolo", "de vez", "sempre", ' +
  '"definitivo", "tira do meu treino", "pode trocar no protocolo"). Resposta curta a uma ' +
  'pergunta de alcance anterior do Coach conta ("só hoje", "no protocolo"). Um MOTIVO sozinho ' +
  '("tá cheio", "estou com pressa", "não gosto") NÃO define o alcance: null. Se `current.scope` ' +
  'já existe e ele não mudou de ideia, devolva null (o valor atual é mantido).\n' +
  '3) `rejectedOffered`: ele recusa EXPLICITAMENTE todas as opções de `offered` e quer ver ' +
  'outras ("nenhuma dessas", "tem outras?", "quero mais opções")? Hesitação sem recusa clara ' +
  '("não sei", "deixa eu pensar") é false.\n' +
  '4) `requestedOutsideList`: ele NOMEIA um exercício específico que prefere e que NÃO está em ' +
  '`offered` nem em `others` deste alvo? true só nesse caso.\n' +
  'No nível do turno: `topic` é "NEW_TOPIC" quando a última mensagem trata de OUTRO assunto ' +
  '(carga, dor forte, nutrição, cumprimento, outro exercício sem relação com a troca); é ' +
  '"CONTINUE" para qualquer resposta ou desdobramento desta troca. `pain` é true se em ' +
  'qualquer ponto desta troca o aluno menciona dor ou desconforto físico no exercício. ' +
  'Retorne somente JSON estrito: {"topic": "CONTINUE"|"NEW_TOPIC", "pain": true|false, ' +
  '"targets": [{"targetId": "<id do alvo>", "chosenExerciseId": "<id>"|null, "scope": ' +
  '"TODAY"|"PROTOCOL"|null, "rejectedOffered": true|false, "requestedOutsideList": ' +
  'true|false}]} — uma entrada por alvo recebido.';

@Injectable()
export class SubstitutionResolutionService {
  constructor(
    private readonly llm: LlmRouter,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SubstitutionResolutionService.name);
  }

  async resolveTurn(request: ResolveTurnRequest): Promise<ResolveTurnResult> {
    if (request.targets.length === 0) return { ok: false };
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
        // `ai_jobs.intent` é `varchar(30)` — ver o achado em `SubstitutionTargetService`.
        intent: 'substitution_turn',
        personaSlot: request.personaSlot,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: untrustedDataEnvelope('CONVERSA_E_ALVOS_DA_TROCA', {
              conversation: request.recentConversation,
              targets: request.targets,
            }),
          },
        ],
      });
      const parsed = turnSchema.parse(parseJson(result.text));

      // Cada alvo: o id escolhido só vale se for um dos ids que RECEBEU para aquele alvo.
      const byId = new Map(request.targets.map((target) => [target.targetId, target]));
      const targets: TurnTargetResult[] = [];
      for (const returned of parsed.targets) {
        const input = byId.get(returned.targetId);
        if (!input || targets.some((t) => t.targetId === returned.targetId)) continue;
        const allowed = new Set([...input.offered, ...input.others].map((c) => c.id));
        targets.push({
          ...returned,
          chosenExerciseId:
            returned.chosenExerciseId !== null && allowed.has(returned.chosenExerciseId)
              ? returned.chosenExerciseId
              : null,
        });
      }
      return { ok: true, topic: parsed.topic, pain: parsed.pain, targets };
    } catch (error) {
      this.logger.warn(
        { event: 'substitution_turn_resolution_failed', err: String(error) },
        'leitura do turno da troca falhou — segue como não resolvida',
      );
      return { ok: false };
    }
  }
}
