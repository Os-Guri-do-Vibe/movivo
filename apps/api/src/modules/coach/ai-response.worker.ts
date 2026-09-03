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
import { findSafeCandidates } from '../protocol/exercise-substitution';
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
import { WorkoutJournalService } from '../workout/workout-journal.service';
import {
  DAILY_LIMIT_MESSAGE,
  DLQ_FALLBACK_MESSAGE,
  FORBIDDEN_TOPIC_RESPONSE,
  SAFETY_HANDOFF_MESSAGE,
  STANDARD_BLOCK_RESPONSE,
  SUBSTITUTION_ALREADY_PENDING_MESSAGE,
  SUBSTITUTION_FALLBACK_MESSAGE,
  SUBSTITUTION_NOT_SAFE_TO_APPLY_MESSAGE,
  TECHNICAL_NO_EVIDENCE_MESSAGE,
} from './coach-messages';
import { ConversationRepository } from './conversation.repository';
import { applyResponseFormatting } from './response-formatter';
import { SubstitutionResolutionService } from './substitution-resolution.service';
import { SubstitutionTargetService } from './substitution-target.service';
import { WorkoutReminderResolutionService } from './workout-reminder-resolution.service';
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
    private readonly workoutReminderResolution: WorkoutReminderResolutionService,
    private readonly workoutJournal: WorkoutJournalService,
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
          { userId, event: 'ai_response_blocked', intent: intent.intent },
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
    if (intent === 'AJUSTE_LEMBRETE_TREINO') {
      return this.buildWorkoutReminderUpdate(userId, message, scrubUser, personaCtx, operationId);
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

  private async buildWorkoutReminderUpdate(
    userId: string,
    message: string,
    scrubUser: ScrubUser,
    personaCtx: PersonaContext,
    operationId: string,
  ): Promise<ResponseDraft> {
    const resolution = await this.workoutReminderResolution.resolve({
      userId,
      operationId,
      user: scrubUser,
      message,
      personaSlot: personaCtx.slot,
    });
    if (!resolution.resolved) {
      return draftPass(
        'Claro. Qual horario voce prefere receber o link do treino? Pode me dizer, por exemplo, 16h ou quatro da tarde.',
        resolution.model,
        resolution.latencyMs,
      );
    }
    await this.workoutJournal.preferences(userId, { reminderTime: resolution.time });
    return draftPass(
      `Beleza! Vou enviar o link dos seus treinos as ${resolution.time}, no seu horario local.`,
      resolution.model,
      resolution.latencyMs,
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

    const safeCandidates = findSafeCandidates(target, active.constraints, catalog);
    if (safeCandidates.length === 0) {
      // Nada seguro na base para este aluno → honestidade + revisão humana, sem LLM.
      return { ...draftPass(SUBSTITUTION_FALLBACK_MESSAGE, null, 0), humanReview: true };
    }

    const resolution = await this.substitutionResolution.resolve({
      userId,
      operationId,
      user: scrubUser,
      recentConversation: ctx.volatileSuffix,
      targetExerciseName: target.name,
      candidates: safeCandidates,
      personaSlot: personaCtx.slot,
    });

    if (resolution.resolved) {
      // Recomputa do zero — nunca confia no cálculo de cima, que já pode estar obsoleto no
      // instante em que a confirmação chega (dupla checagem, defesa em profundidade).
      const freshCandidates = findSafeCandidates(target, active.constraints, catalog);
      const chosen = freshCandidates.find((c) => c.id === resolution.chosenExerciseId);
      if (chosen) {
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
      // Confirmou algo que não está mais no conjunto seguro (estado mudou entre o cálculo e
      // a confirmação) — cai pra reoferecer os candidatos atuais abaixo, sem persistir.
    }

    const names = safeCandidates.map((candidate) => candidate.name);
    const extra =
      `OPÇÕES SEGURAS DA BASE para substituir "${target.name}": ${names.join(', ')}. ` +
      'Apresente essas opções de forma humanizada (não uma lista técnica) e pergunte qual o ' +
      'aluno prefere. NÃO sugira nenhum exercício fora desta lista nem invente carga.';
    return this.buildGenerative(userId, intent, message, scrubUser, personaCtx, operationId, {
      extraSystem: extra,
      allowedExercises: [
        target.name,
        target.id,
        ...safeCandidates.flatMap((candidate) => [candidate.name, candidate.id]),
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
    });
    if (!created.created) {
      // Corrida com uma segunda pendência criada entre a checagem `hasPending` e aqui.
      return draftPass(SUBSTITUTION_ALREADY_PENDING_MESSAGE, null, 0);
    }

    // Aluno com protocolo de origem em PAR-Q bloqueante (achado 2026-09-03, a pedido do
    // fundador): a substituição nasce MANDATORY, sem job de auto-liberação — mesma regra
    // de segurança de `protocols.reviewUrgency` (alerta clínico, "nenhum sai sozinho").
    if (!active.fromBlockingParq) {
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
        mandatory: active.fromBlockingParq,
      },
      active.fromBlockingParq
        ? 'substituição de exercício confirmada — origem PAR-Q bloqueante, aguardando revisão humana obrigatória'
        : 'substituição de exercício confirmada — proposta em staging, aguardando revisão/liberação automática',
    );

    const extra =
      `A troca foi CONFIRMADA e já está registrada: "${target.name}" vai virar "${chosen.name}". ` +
      'Confirme isso pro aluno de forma humanizada, avisando que a mudança passa por uma ' +
      'checagem rápida e ele recebe o protocolo atualizado em breve. NÃO ofereça nenhuma ' +
      'outra opção agora nem volte a perguntar qual exercício trocar.';
    return this.buildGenerative(userId, intent, message, scrubUser, personaCtx, operationId, {
      extraSystem: extra,
      allowedExercises: [target.name, target.id, chosen.name, chosen.id],
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
      maxTokens: { CURTO: 96, MEDIO: 192, LIVRE: 384 }[runtime.formatting.blockSize],
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
