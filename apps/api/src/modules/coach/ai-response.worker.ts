/**
 * AIResponseWorker (US-3.5) — o coração da conversa: orquestra a resposta de MOVI.
 *
 * Fluxo (fila `ai-response`, parâmetros da US-1.7): drena o batch (US-3.1) → lock por usuário
 * (US-3.1) → "digitando…" imediato → teto 50 msg/dia (US-2.2.4) → IntentClassifier (US-3.4) →
 * ContextService (US-3.2, +RAG em dúvida técnica US-3.3) → LlmRouter (US-2.2) → ValidationService
 * (US-2.3, `validateResponse`) → outbound (US-2.5). REUSA tudo; não reimplementa.
 *
 * FORA_DE_ESCOPO e limite não chamam LLM. Substituição só usa exercício da base (nunca
 * contraindicado). BLOCK → resposta-padrão + revisão humana. DLQ → fallback "já te respondo".
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import {
  buildHumanHandoffMessage,
  DEFAULT_AGENT_PERSONA,
  type AgentPersona,
  type BiologicalSex,
} from '@movivo/shared';

import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { FaqService } from '../../core/agent-config/faq.service';
import {
  ForbiddenTopicsService,
  ForbiddenTopicsUnavailableError,
} from '../../core/agent-config/forbidden-topics.service';
import { L1GuardrailService } from '../../core/agent-config/l1-guardrail.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import { ContextService } from '../ai-coach/context/context.service';
import { EvidenceGroundingService } from '../ai-coach/rag/evidence-grounding.service';
import { clinicalGuardrail } from '../ai-coach/intent/clinical-guardrail';
import { IntentClassifier } from '../ai-coach/intent/intent-classifier.service';
import type { Intent } from '../ai-coach/intent/intent.types';
import { PromptResolverService } from '../ai-coach/intent/prompt-resolver.service';
import { LlmAbuseGuard } from '../ai-coach/llm/llm-abuse-guard.service';
import { LlmRouter } from '../ai-coach/llm/llm-router.service';
import type { ScrubUser } from '../ai-coach/llm/llm.types';
import { isFinalFailure } from '../jobs/dlq.handler';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import type { CatalogExercise } from '../protocol/exercise-catalog';
import {
  findSafeCandidates,
  isPlausibleSubstitution,
  SUBSTITUTION_BATCH_SIZE,
} from '../protocol/exercise-substitution';
import { ExerciseCatalogProvider } from '../protocol/exercise-catalog-provider.service';
import {
  applySubstitution,
  collectProtocolExercises,
} from '../protocol/protocol-substitution-apply';
import {
  ProtocolSubstitutionRepository,
  type ActiveProtocolForSubstitution,
  type SubstitutionDiff,
} from '../protocol/protocol-substitution.repository';
import { AI_SUBSTITUTION_REVIEW_WINDOW_MS } from '../protocol/protocol-substitution-release.worker';
import type { ProtocolSubstitutionReleaseJob } from '../protocol/protocol-substitution-release.worker';
import { ValidationService } from '../protocol/validation/validation.service';
import type { AiResponseJob } from '../whatsapp/whatsapp-inbound.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { UserJobLock } from '../whatsapp/user-job-lock';
import {
  DAILY_LIMIT_MESSAGE,
  DLQ_FALLBACK_MESSAGE,
  FORBIDDEN_TOPIC_RESPONSE,
  SAFETY_HANDOFF_MESSAGE,
  STANDARD_BLOCK_RESPONSE,
  SUBSTITUTION_ALREADY_PENDING_MESSAGE,
  SUBSTITUTION_CATALOG_GAP_MESSAGE,
  SUBSTITUTION_FALLBACK_MESSAGE,
  SUBSTITUTION_NOT_SAFE_TO_APPLY_MESSAGE,
  TECHNICAL_NO_EVIDENCE_MESSAGE,
} from './coach-messages';
import { ConversationRepository } from './conversation.repository';
import { applyResponseFormatting } from './response-formatter';
import { SubstitutionCatalogLookupService } from './substitution-catalog-lookup.service';
import { SubstitutionResolutionService } from './substitution-resolution.service';
import { SubstitutionTargetService } from './substitution-target.service';
import { untrustedDataEnvelope } from '../ai-coach/context/untrusted-context';
import { METHODOLOGY_AWARE_INTENTS } from '../ai-coach/intent/prompts';
import { MethodologyProvider } from '../protocol/methodology-provider.service';

/** Resultado interno da montagem da resposta, antes de enviar/persistir. */
interface ResponseDraft {
  text: string;
  modelUsed: string | null;
  latencyMs: number;
  validationPassed: boolean;
  humanReview: boolean;
  blocked: boolean;
  /**
   * Achado 2026-09-08: quando `blocked` é `true`, a REGRA que disparou o `BLOCK_FALLBACK`
   * (ex.: `EXERCISE_NOT_ALLOWED`) — nunca o texto livre bloqueado (evita PII/dado de saúde em
   * log). Sem isso, um bloqueio no painel virava um alerta genérico sem NENHUMA pista de causa
   * (achado ao investigar um caso real: a única forma de saber o motivo era reproduzir a
   * conversa de novo com log manual).
   */
  blockedViolations?: string[];
  ragSources?: Array<{
    chunkId: string;
    documentId: string | null;
    title: string;
    sourceUrl?: string;
    documentVersion?: number;
    documentSha256?: string;
    publicationEventId?: string;
    evidenceId?: string;
    claimIds?: string[];
    verifierModel?: string;
  }>;
}

const MAX_MESSAGE_CHARS = 4000;

/**
 * Achado 2026-09-08 (bug reproduzido ao vivo pelo fundador): `maxTokens` era derivado de
 * `blockSize` (`{ CURTO: 96, MEDIO: 192, LIVRE: 384 }`) — um teto de GERAÇÃO da LLM, não de
 * FORMATAÇÃO. `blockSize` é conceitualmente só sobre como a resposta é particionada em
 * parágrafos/bolhas do WhatsApp (ver `BLOCK_SIZE_SPEC` em `@movivo/shared`); usá-lo pra
 * cortar a geração fazia a IA parar NO MEIO da frase sempre que o raciocínio precisava de
 * mais que ~100-200 tokens (comum em português técnico — termos como "hipertrofia"/
 * "braquial" fragmentam em vários tokens) — sem reticências, sem aviso, texto simplesmente
 * incompleto chegando ao aluno. A resposta é sempre gerada INTEIRA com este teto único e
 * generoso; quem decide como particionar em bolhas por `blockSize` é `applyResponseFormatting`
 * DEPOIS da geração, nunca truncando conteúdo — só reagrupando em `BUBBLE_SEPARATOR`.
 */
const GENERATIVE_MAX_TOKENS = 2000;

/**
 * Achado 2026-09-09 (pedido do fundador): "curadoria ilimitada, apresentação em blocos de 3"
 * — o offset de quantos candidatos já foram oferecidos pro aluno (por alvo de troca) vive em
 * Redis, mesmo padrão de `SENT_MARKER_TTL_SECONDS` no worker de WhatsApp. TTL generoso o
 * bastante pra uma conversa que pausa e retoma no mesmo dia, sem carregar offset de uma
 * negociação de dias atrás.
 */
const SUBSTITUTION_BATCH_TTL_SECONDS = 6 * 3600;

/**
 * Persona resolvida **uma única vez por job** (Sprint 11), com o slot pedido junto.
 *
 * O objeto desce inteiro pelas montagens de resposta: `persona` é o que de fato monta prompt
 * e copy; `slot` existe só para telemetria de cache no `LlmRouter`. Ninguém abaixo daqui
 * resolve persona de novo — ver o comentário no início de `process()`.
 */
interface PersonaContext {
  persona: AgentPersona;
  slot: BiologicalSex | null;
}

@Injectable()
export class AIResponseWorker implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
    private readonly lock: UserJobLock,
    private readonly classifier: IntentClassifier,
    private readonly prompts: PromptResolverService,
    private readonly faq: FaqService,
    private readonly forbiddenTopics: ForbiddenTopicsService,
    private readonly l1Guardrails: L1GuardrailService,
    private readonly context: ContextService,
    private readonly grounding: EvidenceGroundingService,
    private readonly llm: LlmRouter,
    private readonly abuse: LlmAbuseGuard,
    private readonly validation: ValidationService,
    private readonly methodology: MethodologyProvider,
    private readonly exerciseCatalog: ExerciseCatalogProvider,
    private readonly repo: ConversationRepository,
    private readonly healthConsent: HealthConsentService,
    private readonly substitutionRepo: ProtocolSubstitutionRepository,
    private readonly substitutionTarget: SubstitutionTargetService,
    private readonly substitutionResolution: SubstitutionResolutionService,
    private readonly substitutionCatalogLookup: SubstitutionCatalogLookupService,
    private readonly queueEvents: DashboardQueueEventsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AIResponseWorker.name);
  }

  onModuleInit(): void {
    const worker = this.workers.create<AiResponseJob>(QUEUE.aiResponse, (job) => this.process(job));
    worker.on('failed', (job, err) => {
      if (job && isFinalFailure(job)) {
        void this.handleTerminalFailure(job as Job<AiResponseJob>, err).catch((e: unknown) =>
          this.logger.error({ jobId: job.id, err: e }, 'fallback de DLQ da resposta falhou'),
        );
      }
    });
  }

  async process(job: Job<AiResponseJob>): Promise<{ status: string }> {
    const { userId, batchKey: suppliedBatchKey, correlationId, enqueuedAt } = job.data;
    const batchKey = this.keys.forUser(userId, 'ai-response', 'batch');
    if (suppliedBatchKey !== batchKey) {
      this.logger.warn(
        { event: 'ai_response_batch_key_rejected', userId },
        'batchKey do job não corresponde ao namespace do titular',
      );
    }

    const consentActive = await this.healthConsent.hasActiveForUser(userId);

    // O lock vem antes do drain: um job concorrente nunca consome o lote do outro.
    const token = await this.lock.acquire(userId);
    if (!token) {
      this.logger.info({ userId }, 'lock ocupado — lote preservado para o job em curso');
      return { status: 'LOCKED' };
    }

    try {
      if (!consentActive) {
        await this.drainBatch(batchKey);
        this.logger.info(
          { event: 'ai_response_discarded_no_consent', userId },
          'batch descartado sem tratamento apos revogacao',
        );
        return { status: 'CONSENT_REVOKED' };
      }

      const message = await this.drainBatch(batchKey);
      if (!message) {
        // Achado 2026-09-02 (reproduzido ao vivo, incluindo um bug de off-by-one na 1ª
        // versão deste fix): lote vazio na 1ª tentativa é normal (múltiplos triggers
        // coalescendo no mesmo lote). Lote vazio numa RETRY é outra coisa — significa que
        // uma tentativa anterior já drenou a mensagem do aluno e travou DEPOIS disso (ex.:
        // provedor de embedding/LLM indisponível), antes de entregar qualquer resposta. O
        // BullMQ não enxerga isso como falha (a retry "termina com sucesso" sem fazer
        // nada), então o handler de DLQ (`handleTerminalFailure`, mais abaixo) nunca
        // dispara — o aluno via "digitando…" da 1ª tentativa e depois silêncio permanente,
        // sem nenhum aviso. `job.attemptsMade` só é incrementado pelo BullMQ DEPOIS que o
        // processor retorna/lança (`Job.moveToCompleted`/`moveToFailed`, não antes) —
        // durante a 2ª chamada (a retry em si) o valor ainda é `1`, não `2`: `> 0` é o
        // teste certo pra "já houve pelo menos uma tentativa anterior", `> 1` nunca era
        // verdadeiro dentro do processor (confirmado ao vivo — a mensagem de fallback
        // nunca saía).
        if (job.attemptsMade > 0) {
          this.logger.warn(
            { userId, event: 'ai_response_empty_batch_after_retry' },
            'lote vazio numa nova tentativa — uma tentativa anterior perdeu a mensagem após travar; avisando o aluno',
          );
          await this.deliver(userId, correlationId, DLQ_FALLBACK_MESSAGE, null, false, enqueuedAt);
        }
        return { status: 'EMPTY' };
      }

      // ⚠️ Persona resolvida UMA vez por job, e propagada como OBJETO daqui para baixo.
      // Nunca repassar `biologicalSex` para os call sites resolverem de novo: uma publicação
      // ocorrida no meio deste job invalidaria o cache entre duas resoluções e a MESMA
      // resposta sairia com duas versões da persona (system prompt de uma, nome na
      // transcrição da outra). A leitura do titular é a mesma de sempre — uma query só.
      const { scrubUser, biologicalSex } = await this.repo.loadRuntimeUser(userId);
      const personaCtx: PersonaContext = {
        persona: await this.prompts.persona(biologicalSex),
        slot: biologicalSex,
      };
      const { persona } = personaCtx;

      await this.repo.persistTurn({ userId, direction: 'INBOUND', content: message });
      await this.context.recordTurn(userId, 'user', message);
      await this.enqueueTyping(userId);

      // O guardrail sempre vence o FAQ. Só mensagens dentro do perímetro seguro chegam ao
      // match exato; assim uma resposta estática nunca mascara um alerta prioritário.
      const guardrail = clinicalGuardrail(message);
      if (guardrail === 'SAFETY') {
        await this.repo.persistHandoff(userId, 'SAFETY', 'RED_FLAG');
        this.logger.info(
          { userId, event: 'handoff_safety', reason: 'RED_FLAG' },
          'handoff de segurança clínica — atendimento presencial orientado',
        );
        await this.deliver(userId, correlationId, SAFETY_HANDOFF_MESSAGE, null, false, enqueuedAt);
        await this.context.recordTurn(userId, 'assistant', SAFETY_HANDOFF_MESSAGE);
        return { status: 'SAFETY_HANDOFF' };
      }

      // Emergência sempre vence o teto operacional: limite de uso nunca mascara risco.
      if (await this.abuse.isOverDailyLimit(userId)) {
        await this.deliver(userId, correlationId, DAILY_LIMIT_MESSAGE, null, false, enqueuedAt);
        return { status: 'LIMIT' };
      }

      // L0 sempre vence; depois dele, bloqueios aprovados vencem FAQ/classificação/LLM.
      try {
        const topic = await this.forbiddenTopics.evaluate(message);
        if (topic) {
          await this.deliver(
            userId,
            correlationId,
            FORBIDDEN_TOPIC_RESPONSE,
            null,
            true,
            enqueuedAt,
            0,
            false,
          );
          await this.context.recordTurn(userId, 'assistant', FORBIDDEN_TOPIC_RESPONSE);
          this.logger.info(
            {
              event: 'forbidden_topic_blocked',
              topicKey: topic.topicKey,
              topicVersion: topic.version,
            },
            'tema proibido bloqueado antes do FAQ e do LLM',
          );
          return { status: 'FORBIDDEN_TOPIC' };
        }
      } catch (error) {
        if (!(error instanceof ForbiddenTopicsUnavailableError)) throw error;
        await this.repo.persistHandoff(userId, 'ALERT', 'AGENT_CONFIG_UNAVAILABLE');
        await this.deliver(
          userId,
          correlationId,
          STANDARD_BLOCK_RESPONSE,
          null,
          false,
          enqueuedAt,
          0,
          false,
        );
        await this.context.recordTurn(userId, 'assistant', STANDARD_BLOCK_RESPONSE);
        return { status: 'CONFIG_UNAVAILABLE' };
      }

      if (guardrail === 'SCOPE') {
        const response = this.prompts.foraDeEscopoResponseFor(persona);
        await this.deliver(userId, correlationId, response, null, true, enqueuedAt, 0, true);
        await this.context.recordTurn(userId, 'assistant', response);
        await this.context.summarizeIfNeeded(userId, persona.agentName);
        await this.repo.persistHandoff(userId, 'ALERT', 'FORA_DE_ESCOPO');
        return { status: 'SENT' };
      }

      const faq = await this.faq.match(message).catch(() => {
        this.logger.warn(
          { event: 'faq_runtime_degraded' },
          'FAQ indisponível; fluxo seguro segue para classificação',
        );
        return null;
      });
      if (faq) {
        const verdict = this.validation.validateResponse(faq.answer);
        const blocked = verdict.action !== 'PASS';
        const response = blocked ? STANDARD_BLOCK_RESPONSE : faq.answer;
        const l1Flags = blocked ? [] : await this.l1Guardrails.evaluate(message, response);
        await this.deliver(
          userId,
          correlationId,
          response,
          `FAQ_DETERMINISTIC:v${faq.version}`,
          !blocked,
          enqueuedAt,
          0,
          true,
        );
        await this.context.recordTurn(userId, 'assistant', response);
        await this.context.summarizeIfNeeded(userId, persona.agentName);
        if (blocked) await this.repo.persistHandoff(userId, 'ALERT', 'VALIDATOR_BLOCK');
        if (l1Flags.length > 0) {
          await this.repo.persistHandoff(userId, 'ALERT', 'L1_GUARDRAIL_FLAG');
          this.logger.info(
            { event: 'l1_guardrail_flag', ruleKeys: l1Flags.map((flag) => flag.ruleKey) },
            'guardrail L1 sinalizou resposta de FAQ para revisão',
          );
        }
        this.logger.info(
          { event: 'faq_answer_sent', faqId: faq.id, faqVersion: faq.version },
          'resposta determinística do FAQ enviada',
        );
        return { status: blocked ? 'BLOCKED' : 'FAQ' };
      }

      const intent = await this.classifier.classify({ userId, user: scrubUser, message });

      // TASK-3.6.1 (b) — Handoff de SEGURANÇA (red flag do guardrail US-3.4): não gera resposta
      // de IA; orienta atendimento presencial imediato + alerta prioritário. Sem promessa de SLA.
      if (intent.safetyHandoff) {
        await this.repo.persistHandoff(userId, 'SAFETY', 'RED_FLAG');
        this.logger.info(
          { userId, event: 'handoff_safety', reason: 'RED_FLAG' },
          'handoff de segurança clínica — atendimento presencial orientado',
        );
        await this.deliver(userId, correlationId, SAFETY_HANDOFF_MESSAGE, null, false, enqueuedAt);
        await this.context.recordTurn(userId, 'assistant', SAFETY_HANDOFF_MESSAGE);
        return { status: 'SAFETY_HANDOFF' };
      }

      if (intent.intent === 'PEDIDO_HANDOFF') {
        const configured = this.prompts.humanHandoffMessageFor(persona);
        const handoffVerdict = this.validation.validateResponse(configured);
        const response =
          handoffVerdict.action === 'PASS'
            ? configured
            : buildHumanHandoffMessage(DEFAULT_AGENT_PERSONA);
        if (handoffVerdict.action !== 'PASS') {
          this.logger.warn(
            {
              event: 'handoff_copy_blocked',
              rules: handoffVerdict.violations.map((violation) => violation.rule),
            },
            'copy configurada de passagem bloqueada; default seguro aplicado',
          );
        }
        await this.repo.persistHandoff(userId, 'ALERT', 'PEDIDO_HANDOFF');
        await this.deliver(userId, correlationId, response, null, true, enqueuedAt, 0, false);
        await this.context.recordTurn(userId, 'assistant', response);
        await this.context.summarizeIfNeeded(userId, persona.agentName);
        return { status: 'HANDOFF' };
      }

      const draft = await this.buildResponse(
        userId,
        intent.intent,
        message,
        scrubUser,
        personaCtx,
        correlationId,
      );
      const l1Flags = draft.blocked ? [] : await this.l1Guardrails.evaluate(message, draft.text);

      if (draft.blocked) {
        this.logger.info(
          {
            userId,
            event: 'ai_response_blocked',
            intent: intent.intent,
            violations: draft.blockedViolations ?? [],
          },
          'resposta bloqueada pelo validador — resposta-padrão + revisão humana',
        );
      }
      await this.deliver(
        userId,
        correlationId,
        draft.text,
        draft.modelUsed,
        draft.validationPassed,
        enqueuedAt,
        draft.latencyMs,
        true,
        draft.ragSources,
      );
      await this.context.recordTurn(userId, 'assistant', draft.text);
      await this.context.summarizeIfNeeded(userId, persona.agentName);

      // TASK-3.6.1 (a) — Alerta ASSÍNCRONO consultável (não handoff): revisão sem prazo.
      const reason = handoffReason(intent.intent, draft);
      if (reason) {
        await this.repo.persistHandoff(userId, 'ALERT', reason);
        this.logger.info(
          { userId, event: 'handoff_alert', reason },
          'alerta assíncrono ao painel CREF',
        );
      }
      if (l1Flags.length > 0) {
        await this.repo.persistHandoff(userId, 'ALERT', 'L1_GUARDRAIL_FLAG');
        this.logger.info(
          { event: 'l1_guardrail_flag', ruleKeys: l1Flags.map((flag) => flag.ruleKey) },
          'guardrail L1 sinalizou resposta para revisão',
        );
      }
      return { status: draft.blocked ? 'BLOCKED' : 'SENT' };
    } finally {
      await this.lock.release(userId, token);
    }
  }

  /**
   * Roteia a intenção para a montagem certa (com ou sem LLM). `persona` desce por parâmetro
   * desde o topo do job — ver o comentário em `process()`.
   */
  private async buildResponse(
    userId: string,
    intent: Intent,
    message: string,
    scrubUser: ScrubUser,
    personaCtx: PersonaContext,
    operationId: string,
  ): Promise<ResponseDraft> {
    if (intent === 'FORA_DE_ESCOPO') {
      // Recusa honesta pré-aprovada — sem LLM generativo (US-3.4). O nome da agente vem
      // da configuração publicada (US-7.6), nunca de literal no código.
      return draftPass(this.prompts.foraDeEscopoResponseFor(personaCtx.persona), null, 0);
    }
    if (intent === 'SUBSTITUICAO_EXERCICIO') {
      return this.buildSubstitution(userId, intent, message, scrubUser, personaCtx, operationId);
    }
    return this.buildGenerative(
      userId,
      intent,
      message,
      scrubUser,
      personaCtx,
      operationId,
      undefined,
    );
  }

  /**
   * Fluxo de substituição de exercício via IA (achado 2026-09-02) — sem motor determinístico
   * de ESCOLHA. A IA tem autonomia para IDENTIFICAR o exercício-alvo e para ler a confirmação
   * do aluno; o filtro de SEGURANÇA (`findSafeCandidates`) continua 100% determinístico e é
   * SEMPRE recomputado aqui — nunca reaproveitado de uma chamada anterior — tanto no que é
   * oferecido quanto no que pode ser persistido no protocolo do aluno.
   *
   * Achado 2026-09-02 (reproduzido ao vivo): a primeira versão tentava resolver a confirmação
   * ANTES de identificar o alvo, extraindo o nome do exercício escolhido do texto livre da
   * conversa — e nunca resolvia nada, porque o turno de oferta verbaliza o candidato de forma
   * humanizada ("supino reto com halter"), não com o nome literal do catálogo ("Supino Reto
   * (Halter)"), então a comparação exata nunca batia. A ordem certa: sempre IDENTIFICAR o
   * alvo primeiro (mesmo dado já disponível todo turno — via `protocoloCompleto`), computar os
   * candidatos seguros, e só então perguntar à IA se a última mensagem confirma um DESSES
   * candidatos específicos (lista fechada, mesmo padrão de `SubstitutionTargetService` — a IA
   * escolhe um id que RECEBEU, nunca extrai um nome livre).
   */
  private async buildSubstitution(
    userId: string,
    intent: Intent,
    message: string,
    scrubUser: ScrubUser,
    personaCtx: PersonaContext,
    operationId: string,
  ): Promise<ResponseDraft> {
    const active = await this.substitutionRepo.loadActiveProtocol(userId);
    if (!active) {
      return { ...draftPass(SUBSTITUTION_FALLBACK_MESSAGE, null, 0), humanReview: true };
    }
    // Regra de v1 (decisão do fundador): uma proposta pendente por vez. Uma segunda troca
    // pedida antes da primeira ser decidida é recusada na conversa, não empilhada.
    if (await this.substitutionRepo.hasPending(userId, active.protocolId)) {
      return draftPass(SUBSTITUTION_ALREADY_PENDING_MESSAGE, null, 0);
    }

    const catalog = this.exerciseCatalog.getAll();
    const protocolExercises = collectProtocolExercises(active.content);
    // Construído ANTES da identificação: turnos de continuação ("é insegurança mesmo, sem
    // dor") não citam o exercício sozinhos — só fazem sentido com a conversa recente junto
    // (achado 2026-09-02, reproduzido ao vivo).
    const ctx = await this.context.build(userId, intent, message, personaCtx.persona.agentName);

    const identified = await this.substitutionTarget.identify({
      userId,
      operationId,
      user: scrubUser,
      recentConversation: ctx.volatileSuffix,
      protocolExercises,
      personaSlot: personaCtx.slot,
    });
    const target = identified.identified
      ? this.exerciseCatalog.getById(identified.exerciseId)
      : undefined;

    if (!target) {
      // Não ficou claro qual exercício. `allowedExercises` trava no que JÁ está no protocolo
      // do aluno — a IA pode fazer referência ao que já existe pra ajudar a esclarecer ("você
      // quer dizer o agachamento ou o levantamento terra romeno?"), mas NUNCA nomear um
      // substituto novo aqui: sem alvo identificado, não há candidato seguro recomputado, e
      // nada garante que o que a IA diria por conta própria passaria pelo filtro determinístico
      // (achado 2026-09-02, reproduzido ao vivo — a IA verbalizava uma troca de qualquer jeito
      // quando este branch não tinha nenhuma restrição de vocabulário).
      return this.buildGenerative(userId, intent, message, scrubUser, personaCtx, operationId, {
        extraSystem:
          'O aluno expressou insatisfação com um exercício do protocolo dele, mas não ficou ' +
          'claro qual exercício específico do treino ele quer trocar. Pergunte de forma ' +
          'natural qual exercício ele quer trocar, sem sugerir nenhuma alternativa ainda.',
        allowedExercises: protocolExercises.flatMap((ex) => [ex.id, ex.name]),
      });
    }

    // Curadoria de substitutos seguros — ILIMITADA (achado 2026-09-09, pedido do fundador):
    // `findSafeCandidates` devolve TODOS os elegíveis, sem teto. A apresentação ao aluno é
    // feita em LOTES de `SUBSTITUTION_BATCH_SIZE` mais abaixo — a curadoria em si nunca
    // esconde um candidato elegível do fluxo de confirmação.
    const fullCuration = findSafeCandidates(target, active.constraints, catalog);

    // Achado 2026-09-08 (pedido do fundador, reproduzido ao vivo): "posso trocar X por
    // esteira normal?" já NOMEIA o substituto na mesma mensagem que pede a troca. Checado
    // contra a curadoria INTEIRA — elegível, mesmo que ainda não tenha aparecido em nenhum
    // lote oferecido — pra um pedido explícito nunca depender de qual lote está na tela.
    const explicitRequest = await this.substitutionResolution.resolveExplicitRequest({
      userId,
      operationId,
      user: scrubUser,
      recentConversation: ctx.volatileSuffix,
      targetExerciseName: target.name,
      candidates: fullCuration,
      personaSlot: personaCtx.slot,
    });
    if (explicitRequest.resolved) {
      // Recomputa do zero — mesma defesa em profundidade da confirmação de lote abaixo.
      const fresh = findSafeCandidates(target, active.constraints, catalog);
      const chosen = fresh.find((c) => c.id === explicitRequest.chosenExerciseId);
      if (chosen) {
        await this.clearSubstitutionBatch(userId, target.id);
        return this.applyAndPersistSubstitution(
          userId,
          intent,
          message,
          scrubUser,
          personaCtx,
          operationId,
          active,
          target,
          chosen,
        );
      }
      // Confirmou algo que não está mais no conjunto seguro — cai pro lote atual, sem persistir.
    }

    // Achado 2026-09-09 (pedido do fundador): "curadoria ilimitada, apresentação em blocos de
    // 3" — o offset de quantos candidatos já foram oferecidos pra este aluno, pra ESTE alvo,
    // vive em Redis (chave por alvo: pedir outra troca depois começa do zero naturalmente).
    const batchKey = this.keys.forUser(userId, 'substitution-batch', target.id);
    const storedOffset = Number(await this.redis.get(batchKey)) || 0;
    const offset = Math.min(storedOffset, fullCuration.length);
    const batch = fullCuration.slice(offset, offset + SUBSTITUTION_BATCH_SIZE);

    const resolution = await this.substitutionResolution.resolve({
      userId,
      operationId,
      user: scrubUser,
      recentConversation: ctx.volatileSuffix,
      targetExerciseName: target.name,
      candidates: batch,
      personaSlot: personaCtx.slot,
    });

    if (resolution.resolved) {
      // Recomputa do zero — nunca confia no cálculo de cima, que já pode estar obsoleto no
      // instante em que a confirmação chega (dupla checagem, defesa em profundidade).
      const fresh = findSafeCandidates(target, active.constraints, catalog);
      const chosen = fresh.find((c) => c.id === resolution.chosenExerciseId);
      if (chosen) {
        await this.clearSubstitutionBatch(userId, target.id);
        return this.applyAndPersistSubstitution(
          userId,
          intent,
          message,
          scrubUser,
          personaCtx,
          operationId,
          active,
          target,
          chosen,
        );
      }
      // Confirmou algo que não está mais no conjunto seguro (estado mudou) — cai pro lote
      // atual abaixo, sem persistir.
    }
    const rejectedAll = !resolution.resolved && resolution.rejectedAll;

    // Achado 2026-09-09 (pedido do fundador, reproduzido ao vivo — "supino reto máquina"):
    // nem confirmou nem recusou o lote com um "não gostei" vago — vale checar se o aluno
    // nomeou um exercício ESPECÍFICO fora da curadoria elegível. Pode existir no catálogo sem
    // ser opção segura pra ele (Revisão Obrigatória direto), ou pode não existir em lugar
    // nenhum (Revisão Obrigatória + opção de adicionar ao catálogo). Só roda depois do lote
    // atual já ter sido checado — referência posicional/vaga ("a segunda opção") é papel do
    // `resolve()` acima, não deste lookup.
    const lookup = await this.substitutionCatalogLookup.identify({
      userId,
      operationId,
      user: scrubUser,
      recentConversation: ctx.volatileSuffix,
      targetExerciseName: target.name,
      fullCatalog: catalog.map((ex) => ({ id: ex.id, name: ex.name })),
      personaSlot: personaCtx.slot,
    });
    if (lookup.requestedName) {
      if (lookup.matchedExerciseId) {
        const matched = this.exerciseCatalog.getById(lookup.matchedExerciseId);
        if (matched && !isPlausibleSubstitution(target, matched)) {
          // Achado 2026-09-09 (bug reportado pelo fundador, reproduzido em conversa real:
          // "Supino Reto (Máquina)" → "Remada Curvada" foi registrado na fila do profissional
          // como se fosse uma dúvida clínica legítima). `matched` existe no catálogo, mas
          // treina um padrão de movimento/grupo muscular DIFERENTE do alvo — não é uma troca
          // plausível, é um pedido sem nexo fisiológico. A fila do profissional é reservada
          // para trocas que a IA pode julgar clinicamente plausíveis (mesmo padrão + mesmo
          // grupo muscular alvo) mas que caem fora da curadoria por outro motivo (nível,
          // local, contraindicação) — isto NÃO é esse caso, então a IA já orienta na hora,
          // sem criar nenhuma pendência, e reoferece a curadoria segura real (`batch`).
          this.logger.info(
            {
              userId,
              event: 'substitution_request_not_plausible',
              targetExerciseId: target.id,
              requestedExerciseId: matched.id,
            },
            'pedido de substituição sem nexo fisiológico (grupo muscular/padrão diferente) — orientado na hora, sem registrar na fila',
          );
          await this.clearSubstitutionBatch(userId, target.id);
          if (batch.length === 0) {
            return { ...draftPass(SUBSTITUTION_FALLBACK_MESSAGE, null, 0), humanReview: true };
          }
          return this.offerSubstitutionBatch(
            userId,
            intent,
            message,
            scrubUser,
            personaCtx,
            operationId,
            target,
            batch,
            matched,
          );
        }
        if (matched) {
          // Mesmo padrão de movimento + mesmo grupo muscular alvo, mas não é elegível pra
          // este aluno por outro motivo (nível, local, contraindicação) — aí sim é uma dúvida
          // clínica real: Revisão Obrigatória, sem opção de "adicionar ao catálogo" (o
          // exercício já existe).
          await this.clearSubstitutionBatch(userId, target.id);
          return this.applyAndPersistSubstitution(
            userId,
            intent,
            message,
            scrubUser,
            personaCtx,
            operationId,
            active,
            target,
            matched,
            'MANDATORY',
          );
        }
      } else {
        // Não existe em lugar nenhum do catálogo — Revisão Obrigatória + opção de o time
        // adicionar ao catálogo antes de decidir (ver `DashboardService`/tela de revisão).
        await this.clearSubstitutionBatch(userId, target.id);
        const created = await this.substitutionRepo.createCatalogGapPending({
          userId,
          protocolId: active.protocolId,
          baseVersion: active.version,
          fromExerciseId: target.id,
          fromExerciseName: target.name,
          requestedExerciseName: lookup.requestedName,
          changeReason:
            `Substituição solicitada pelo aluno via WhatsApp: ${target.name} → ` +
            `"${lookup.requestedName}" (não existe no catálogo)`,
        });
        if (!created.created) {
          return draftPass(SUBSTITUTION_ALREADY_PENDING_MESSAGE, null, 0);
        }
        this.queueEvents.emit('protocol');
        return draftPass(SUBSTITUTION_CATALOG_GAP_MESSAGE, null, 0);
      }
    }

    if (batch.length === 0) {
      // Curadoria vazia desde o início — nada seguro pra oferecer, nada específico pedido.
      return { ...draftPass(SUBSTITUTION_FALLBACK_MESSAGE, null, 0), humanReview: true };
    }

    if (rejectedAll) {
      const nextOffset = offset + batch.length;
      if (nextOffset < fullCuration.length) {
        // Ainda há candidatos elegíveis não apresentados — próximo lote de
        // `SUBSTITUTION_BATCH_SIZE` (pedido do fundador: "3 primeiros, próximos 3...").
        await this.redis.set(batchKey, String(nextOffset), 'EX', SUBSTITUTION_BATCH_TTL_SECONDS);
        const nextBatch = fullCuration.slice(nextOffset, nextOffset + SUBSTITUTION_BATCH_SIZE);
        return this.offerSubstitutionBatch(
          userId,
          intent,
          message,
          scrubUser,
          personaCtx,
          operationId,
          target,
          nextBatch,
        );
      }
      // Esgotou a curadoria inteira — nada escolhido, nada específico reconhecível pedido.
      await this.clearSubstitutionBatch(userId, target.id);
      return { ...draftPass(SUBSTITUTION_FALLBACK_MESSAGE, null, 0), humanReview: true };
    }

    // Ambíguo — reoferece o MESMO lote (grava o offset, idempotente).
    await this.redis.set(batchKey, String(offset), 'EX', SUBSTITUTION_BATCH_TTL_SECONDS);
    return this.offerSubstitutionBatch(
      userId,
      intent,
      message,
      scrubUser,
      personaCtx,
      operationId,
      target,
      batch,
    );
  }

  /** Apaga o offset do lote de apresentação (achado 2026-09-09) — chamado sempre que a
   * substituição deste alvo é resolvida (aplicada ou virou pedido de catálogo), pra um pedido
   * futuro do MESMO alvo começar do zero, não de onde a conversa anterior parou. */
  private async clearSubstitutionBatch(userId: string, targetExerciseId: string): Promise<void> {
    await this.redis.del(this.keys.forUser(userId, 'substitution-batch', targetExerciseId));
  }

  /** Oferece um lote de candidatos seguros ao aluno — extraído de `buildSubstitution`
   * (achado 2026-09-09) porque é chamado tanto pro lote atual (ambíguo) quanto pro próximo
   * lote (rejeição explícita do lote atual). */
  private async offerSubstitutionBatch(
    userId: string,
    intent: Intent,
    message: string,
    scrubUser: ScrubUser,
    personaCtx: PersonaContext,
    operationId: string,
    target: CatalogExercise,
    batch: readonly CatalogExercise[],
    /**
     * Achado 2026-09-09: presente quando este lote é oferecido em RESPOSTA a um pedido
     * específico do aluno que não é uma troca plausível (grupo muscular/padrão diferente) —
     * a IA precisa explicar isso antes de oferecer as opções reais, não só listar candidatos.
     */
    rejectedRequest?: CatalogExercise,
  ): Promise<ResponseDraft> {
    const names = batch.map((candidate) => candidate.name);
    const rejectionNote = rejectedRequest
      ? `O aluno pediu para trocar "${target.name}" por "${rejectedRequest.name}", mas essa ` +
        'troca não é possível: o exercício pedido trabalha um grupo muscular/padrão de ' +
        'movimento diferente do original, então não é um substituto seguro. Explique isso de ' +
        'forma simples e humanizada (evite jargão técnico se não soar natural), deixando claro ' +
        'que esta troca específica não vai acontecer — NÃO diga que vai registrar/confirmar ' +
        'com o profissional sobre ELA. Em seguida, '
      : 'Apresente ';
    const extra =
      rejectionNote +
      `as OPÇÕES SEGURAS DA BASE para substituir "${target.name}": ${names.join(', ')}. ` +
      'Apresente essas opções de forma humanizada (não uma lista técnica) e pergunte qual o ' +
      'aluno prefere. NÃO sugira nenhum exercício fora desta lista nem invente carga.';
    return this.buildGenerative(userId, intent, message, scrubUser, personaCtx, operationId, {
      extraSystem: extra,
      allowedExercises: [
        target.name,
        target.id,
        ...batch.flatMap((candidate) => [candidate.name, candidate.id]),
        ...(rejectedRequest ? [rejectedRequest.name, rejectedRequest.id] : []),
      ],
    });
  }

  /**
   * Aluno confirmou uma troca segura: aplica ao conteúdo, revalida a ESTRUTURA INTEIRA do
   * protocolo (trocar um exercício pode quebrar uma regra de sessão mesmo quando o
   * substituto em si é seguro — ex.: `ISOLATION_AS_BASE`), e só então persiste em staging
   * (`protocol_substitution_requests`, nunca o protocolo `ACTIVE` diretamente — ver o
   * comentário de topo do schema). O protocolo do aluno só muda de fato na liberação
   * (`ProtocolSubstitutionReleaseWorker`, 30 min, ou aprovação manual do profissional).
   */
  private async applyAndPersistSubstitution(
    userId: string,
    intent: Intent,
    message: string,
    scrubUser: ScrubUser,
    personaCtx: PersonaContext,
    operationId: string,
    active: ActiveProtocolForSubstitution,
    target: CatalogExercise,
    chosen: CatalogExercise,
    /**
     * Achado 2026-09-09 (pedido do fundador): `'MANDATORY'` quando o aluno pediu
     * explicitamente um exercício que EXISTE no catálogo mas não é elegível pra ele
     * (`SubstitutionCatalogLookupService` achou um `matchedExerciseId` fora da curadoria
     * segura) — staff decide sem auto-liberação, e o aluno não ouve "confirmada" antes da
     * revisão real. Default `'OPTIONAL'` preserva o comportamento de sempre.
     */
    reviewUrgency: 'OPTIONAL' | 'MANDATORY' = 'OPTIONAL',
  ): Promise<ResponseDraft> {
    const applied = applySubstitution(active.content, target.id, chosen);
    const verdict = this.validation.validate({
      structure: applied.content,
      constraints: active.validationConstraints,
      parqFlags: active.parQFlags,
    });
    if (verdict.action !== 'PASS') {
      this.logger.warn(
        {
          userId,
          event: 'substitution_not_safe_to_apply',
          violations: verdict.violations.map((v) => v.rule),
        },
        'troca de exercício confirmada pelo aluno quebrou a validação do protocolo inteiro — não aplicada sozinha',
      );
      return { ...draftPass(SUBSTITUTION_NOT_SAFE_TO_APPLY_MESSAGE, null, 0), humanReview: true };
    }

    const diff: SubstitutionDiff = {
      type: 'EXERCISE_SUBSTITUTION',
      from: { id: target.id, name: target.name },
      to: { id: chosen.id, name: chosen.name },
      sessionsAffected: applied.sessionsAffected,
    };
    const created = await this.substitutionRepo.createPending({
      userId,
      protocolId: active.protocolId,
      baseVersion: active.version,
      fromExerciseId: target.id,
      fromExerciseName: target.name,
      toExerciseId: chosen.id,
      toExerciseName: chosen.name,
      proposedContent: applied.content,
      diff,
      changeReason: `Substituição solicitada pelo aluno via WhatsApp: ${target.name} → ${chosen.name}`,
      reviewUrgency,
    });
    if (!created.created) {
      // Corrida com uma segunda pendência criada entre a checagem `hasPending` e aqui.
      return draftPass(SUBSTITUTION_ALREADY_PENDING_MESSAGE, null, 0);
    }

    // Mandatory por origem PAR-Q bloqueante (achado 2026-09-03) OU porque o exercício pedido
    // não é uma opção segura padrão da base (achado 2026-09-09, `reviewUrgency` explícito) —
    // nos dois casos, sem job de auto-liberação (mesma regra de `protocols.reviewUrgency`:
    // "nenhum sai sozinho").
    const isMandatory = active.fromBlockingParq || reviewUrgency === 'MANDATORY';
    if (!isMandatory) {
      const releaseJob: ProtocolSubstitutionReleaseJob = { userId, requestId: created.id };
      await this.queues.enqueue(
        QUEUE.protocolSubstitutionRelease,
        'substitution-release',
        releaseJob,
        {
          delay: AI_SUBSTITUTION_REVIEW_WINDOW_MS,
          jobId: `substitution-auto-release-${created.id}`,
        },
      );
    }
    this.queueEvents.emit('protocol');
    this.logger.info(
      {
        userId,
        event: 'substitution_pending_created',
        requestId: created.id,
        mandatory: isMandatory,
      },
      isMandatory
        ? 'substituição de exercício confirmada — aguardando revisão humana obrigatória'
        : 'substituição de exercício confirmada — proposta em staging, aguardando revisão/liberação automática',
    );

    if (reviewUrgency === 'MANDATORY') {
      // Achado 2026-09-09: diferente do PAR-Q bloqueante (que segue confirmando via IA —
      // fora do escopo desta mudança), este exercício especificamente NÃO é uma opção segura
      // padrão da base pra este aluno — ele não deve ouvir "confirmada" antes da revisão real
      // acontecer. Resposta FIXA, sem LLM.
      return draftPass(SUBSTITUTION_NOT_SAFE_TO_APPLY_MESSAGE, null, 0);
    }

    const extra =
      `A troca foi CONFIRMADA e já está registrada: "${target.name}" vai virar "${chosen.name}". ` +
      'Confirme isso pro aluno de forma humanizada, avisando que a mudança passa por uma ' +
      'checagem rápida e ele recebe o protocolo atualizado em breve. NÃO ofereça nenhuma ' +
      'outra opção agora nem volte a perguntar qual exercício trocar.';
    // Achado 2026-09-08 (bug reproduzido ao vivo pelo fundador): `allowedExercises` só com
    // alvo+escolhido bloqueava qualquer confirmação humanizada que também mencionasse OUTRO
    // exercício já real do protocolo do aluno (ex.: o resto do treino do dia) — o validador
    // não distingue "citar contexto real" de "empurrar substituto não vetado", então qualquer
    // menção extra virava `EXERCISE_NOT_ALLOWED` e a confirmação inteira caía no fallback
    // padrão, mesmo com a troca já persistida com sucesso. Ampliado pra incluir todo o
    // protocolo ATUAL (antes da troca) + o escolhido — nunca um exercício fora do que já é
    // real pra este aluno ou do que acabou de ser vetado como seguro.
    const protocolExercises = collectProtocolExercises(active.content);
    return this.buildGenerative(userId, intent, message, scrubUser, personaCtx, operationId, {
      extraSystem: extra,
      allowedExercises: [
        ...protocolExercises.flatMap((ex) => [ex.id, ex.name]),
        chosen.name,
        chosen.id,
      ],
    });
  }

  /** Caminho generativo: contexto (+RAG) → LLM → validação da resposta. */
  private async buildGenerative(
    userId: string,
    intent: Intent,
    message: string,
    scrubUser: ScrubUser,
    personaCtx: PersonaContext,
    operationId: string,
    opts: { extraSystem?: string; allowedExercises?: string[] } | undefined,
  ): Promise<ResponseDraft> {
    const ctx = await this.context.build(userId, intent, message, personaCtx.persona.agentName);
    const runtime = await this.prompts.resolveRuntimeFor(intent, personaCtx.persona);
    let system = [runtime.system, opts?.extraSystem].filter(Boolean).join('\n\n');
    // Achado 2026-09-02 (correção do fundador): sinaliza quando DUVIDA_TECNICA cai do
    // caminho fundamentado (base de conhecimento) pro conhecimento geral do modelo — vira
    // `humanReview: true` no retorno compartilhado lá embaixo, sem duplicar a lógica de
    // formatação/validação que já existe pra todo outro intent.
    let ungroundedTechnicalFallback = false;

    const methodology = METHODOLOGY_AWARE_INTENTS.includes(intent)
      ? await this.methodology.current().catch((error: unknown) => {
          this.logger.warn(
            { event: 'methodology_context_unavailable', err: String(error) },
            'coach segue sem contexto metodológico',
          );
          return null;
        })
      : null;

    const messages = [
      {
        role: 'user' as const,
        content: untrustedDataEnvelope('ESTADO_E_MEMORIA', ctx.cacheablePrefix),
      },
      ...(methodology
        ? [
            {
              role: 'user' as const,
              content: untrustedDataEnvelope('METODOLOGIA_MOVIVO_APROVADA', {
                version: methodology.versionLabel,
                sha256: methodology.contentSha256,
                content: methodology.content,
              }),
            },
          ]
        : []),
      {
        role: 'user' as const,
        content: untrustedDataEnvelope('HISTORICO_RECENTE_E_MENSAGEM', ctx.volatileSuffix),
      },
    ];

    if (intent === 'DUVIDA_TECNICA') {
      const grounded =
        ctx.ragDocs.length > 0
          ? await this.grounding.answer({
              userId,
              operationId,
              user: scrubUser,
              question: message,
              authoritativeState: ctx.authoritativeState,
              system,
              contextMessages: messages,
              documents: ctx.ragDocs,
              maxClaims: { CURTO: 1, MEDIO: 2, LIVRE: 3 }[runtime.formatting.blockSize],
              personaSlot: personaCtx.slot,
            })
          : ({ status: 'INSUFFICIENT', latencyMs: 0 } as const);

      if (grounded.status === 'VERIFIED') {
        const groundedVerdict = this.validation.validateResponse(grounded.text);
        if (groundedVerdict.action === 'BLOCK_FALLBACK') {
          return {
            text: STANDARD_BLOCK_RESPONSE,
            modelUsed: grounded.model,
            latencyMs: grounded.latencyMs,
            validationPassed: false,
            humanReview: true,
            blocked: true,
            blockedViolations: groundedVerdict.violations.map((v) => v.rule),
          };
        }
        return {
          // Achado 2026-09-02 (correção do fundador): esta era a única saída generativa do
          // worker que devolvia o texto do modelo direto, sem passar por
          // `applyResponseFormatting` — o teto determinístico de travessão/negrito/lista
          // (mesmo raciocínio de "prompt sozinho nunca é teto" do resto do arquivo) nunca
          // rodava aqui. O caminho ungrounded logo abaixo sempre aplicou; agora os dois são
          // consistentes.
          text: applyResponseFormatting(grounded.text, runtime.formatting),
          modelUsed: grounded.model,
          latencyMs: grounded.latencyMs,
          validationPassed: true,
          humanReview: grounded.humanReview || groundedVerdict.humanReviewRequired,
          blocked: false,
          ragSources: grounded.sources.map((source) => ({
            ...source,
            verifierModel: grounded.verifierModel,
          })),
        };
      }

      // Achado 2026-09-02 (correção do fundador): "sem referência na base" deixou de ser
      // recusa automática — a MOVIVO é uma proposta CONVERSACIONAL, não um FAQ que só repete
      // o que está cadastrado. Só CONFLICT continua abstendo: é quando a evidência recuperada
      // contradiz o ESTADO_AUTORITATIVO do próprio aluno (ex.: uma restrição de PAR-Q/lesão) —
      // aí a IA responder por conta própria seria ignorar uma restrição de segurança já
      // registrada, e isso vale mais que soar natural. INSUFFICIENT (nada na base, ou a base
      // nem chegou a ser consultada por falta de documento) e UNVERIFIED (a base não sustentou
      // a alegação que o modelo tentou fazer) caem pro caminho generativo comum logo abaixo,
      // com uma instrução extra pra usar conhecimento geral de educação física com
      // responsabilidade — igual um personal trainer de verdade respondendo no WhatsApp.
      if (grounded.status === 'CONFLICT') {
        return {
          ...draftPass(TECHNICAL_NO_EVIDENCE_MESSAGE, null, grounded.latencyMs),
          humanReview: true,
        };
      }
      ungroundedTechnicalFallback = true;
      system = [
        system,
        'Você NÃO tem uma referência específica da Base de Conhecimento da MOVIVO pra esta ' +
          'pergunta. Responda mesmo assim, com conhecimento amplamente aceito de educação ' +
          'física/ciência do exercício — como um personal trainer experiente respondendo no ' +
          'WhatsApp, de forma natural e direta, nunca como um FAQ que só repete o que está ' +
          'cadastrado. NUNCA invente ou afirme com certeza um detalhe específico da ' +
          'metodologia proprietária da MOVIVO ou do protocolo deste aluno que você não tenha ' +
          'nas mensagens acima — nesse caso, diga que vai confirmar com o profissional ' +
          'responsável em vez de arriscar. Se a pergunta pedir avaliação clínica, diagnóstico ' +
          'ou algo que foge do que um treinador pode responder com segurança, encaminhe ao ' +
          'profissional de Educação Física responsável em vez de responder.',
      ].join('\n\n');
    }

    const startedAt = Date.now();
    const result = await this.llm.complete({
      purpose: 'AI_RESPONSE',
      userId,
      user: scrubUser,
      dataClass: 'HEALTH',
      system,
      messages,
      maxTokens: GENERATIVE_MAX_TOKENS,
      cache: true,
      intent: `coach_${intent}`,
      personaSlot: personaCtx.slot,
      operationId,
    });
    const latencyMs = Date.now() - startedAt;

    const rawVerdict = this.validation.validateResponse(result.text, {
      allowedExercises: opts?.allowedExercises,
    });
    if (rawVerdict.action === 'BLOCK_FALLBACK') {
      return {
        text: STANDARD_BLOCK_RESPONSE,
        modelUsed: result.model,
        latencyMs,
        validationPassed: false,
        humanReview: true,
        blocked: true,
        blockedViolations: rawVerdict.violations.map((v) => v.rule),
      };
    }
    const formatted = applyResponseFormatting(result.text, runtime.formatting);
    const verdict = this.validation.validateResponse(formatted, {
      allowedExercises: opts?.allowedExercises,
    });
    if (verdict.action === 'BLOCK_FALLBACK') {
      return {
        text: STANDARD_BLOCK_RESPONSE,
        modelUsed: result.model,
        latencyMs,
        validationPassed: false,
        humanReview: true,
        blocked: true,
        blockedViolations: verdict.violations.map((v) => v.rule),
      };
    }
    return {
      text: formatted,
      modelUsed: result.model,
      latencyMs,
      validationPassed: true,
      // `ungroundedTechnicalFallback`: resposta de DUVIDA_TECNICA sem base na Base de
      // Conhecimento continua visível pro profissional CREF acompanhar (alerta assíncrono,
      // não bloqueia a entrega — ver `humanReview` em `deliver()`), mesmo passando limpo
      // no validador de linguagem.
      humanReview:
        ungroundedTechnicalFallback ||
        rawVerdict.humanReviewRequired ||
        verdict.humanReviewRequired,
      blocked: false,
      ragSources: ctx.ragDocs.map((document) => ({
        chunkId: document.chunkId,
        documentId: document.documentId,
        title: document.title,
        ...(document.sourceUrl ? { sourceUrl: document.sourceUrl } : {}),
        ...(document.documentVersion ? { documentVersion: document.documentVersion } : {}),
        ...(document.documentSha256 ? { documentSha256: document.documentSha256 } : {}),
        ...(document.publicationEventId ? { publicationEventId: document.publicationEventId } : {}),
      })),
    };
  }

  // --- envio + persistência + SLA -------------------------------------------

  private async deliver(
    userId: string,
    correlationId: string,
    text: string,
    modelUsed: string | null,
    validationPassed: boolean,
    enqueuedAt: number,
    latencyMs: number | null = null,
    requestFeedback = false,
    ragSources?: ResponseDraft['ragSources'],
  ): Promise<void> {
    await this.repo.persistTurn({
      userId,
      direction: 'OUTBOUND',
      content: text,
      validationPassed,
      modelUsed,
      latencyMs,
      ragSources,
    });
    const job: WhatsappOutboundJob = {
      userId,
      type: 'COACH_MESSAGE',
      text,
      dedupeId: correlationId,
      // Thumbs (US-3.6): só respostas reais pedem feedback (não limite/segurança/DLQ).
      feedback: requestFeedback,
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'coach-message', job, {
      jobId: `coach-message_${correlationId}`,
    });
    // SLA msg→resposta (alvo ≤30s p95). ponytail: log estruturado; p95 é agregado na obs.
    this.logger.info(
      { event: 'ai_response_sent', userId, slaMs: Date.now() - enqueuedAt },
      'ai_response_sent',
    );
  }

  private async enqueueTyping(userId: string): Promise<void> {
    const job: WhatsappOutboundJob = { userId, type: 'TYPING' };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'coach-typing', job);
  }

  /** Drena e apaga o buffer numa única transação Redis (concatena a rajada). */
  private async drainBatch(batchKey: string): Promise<string> {
    const result = await this.redis.multi().lrange(batchKey, 0, -1).del(batchKey).exec();
    const items = (result?.[0]?.[1] ?? []) as string[];
    return items
      .map((raw) => {
        try {
          return (JSON.parse(raw) as { text?: string }).text ?? '';
        } catch {
          return '';
        }
      })
      .filter(Boolean)
      .join(' ')
      .slice(0, MAX_MESSAGE_CHARS);
  }

  /** DLQ: falha persistente → fallback "já te respondo" (guardrails), sem travar o usuário. */
  private async handleTerminalFailure(job: Job<AiResponseJob>, err: Error): Promise<void> {
    const { userId, correlationId } = job.data;
    this.logger.error(
      { userId, jobId: job.id, err: err.message, event: 'ai_response_dlq' },
      'resposta do Coach esgotou os retries — fallback',
    );
    const fallback: WhatsappOutboundJob = {
      userId,
      type: 'COACH_MESSAGE',
      text: DLQ_FALLBACK_MESSAGE,
      dedupeId: `dlq_${correlationId}`,
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'coach-message', fallback, {
      jobId: `coach-message_dlq_${correlationId}`,
    });
  }
}

/** Resposta enviável sem bloqueio (PASS). */
function draftPass(text: string, modelUsed: string | null, latencyMs: number): ResponseDraft {
  return { text, modelUsed, latencyMs, validationPassed: true, humanReview: false, blocked: false };
}

/**
 * Motivo do alerta ASSÍNCRONO ao painel (US-3.6 (a)), ou `null` se nada a alertar.
 * Pedido explícito de humano e fora-de-escopo pesam mais que a sinalização do validador.
 */
function handoffReason(intent: Intent, draft: ResponseDraft): string | null {
  if (intent === 'PEDIDO_HANDOFF') return 'PEDIDO_HANDOFF';
  if (intent === 'FORA_DE_ESCOPO') return 'FORA_DE_ESCOPO';
  if (draft.blocked) return 'VALIDATOR_BLOCK';
  if (draft.humanReview) return 'VALIDATOR_FLAG';
  return null;
}
