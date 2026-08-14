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

import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import { FaqService } from '../../core/agent-config/faq.service';
import { L1GuardrailService } from '../../core/agent-config/l1-guardrail.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import { ContextService } from '../ai-coach/context/context.service';
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
import { findExerciseByMention, findSafeSubstitute } from '../protocol/exercise-substitution';
import { ValidationService } from '../protocol/validation/validation.service';
import type { AiResponseJob } from '../whatsapp/whatsapp-inbound.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { UserJobLock } from '../whatsapp/user-job-lock';
import {
  DAILY_LIMIT_MESSAGE,
  DLQ_FALLBACK_MESSAGE,
  SAFETY_HANDOFF_MESSAGE,
  STANDARD_BLOCK_RESPONSE,
  SUBSTITUTION_FALLBACK_MESSAGE,
} from './coach-messages';
import { ConversationRepository } from './conversation.repository';

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
  }>;
}

const MAX_MESSAGE_CHARS = 4000;

@Injectable()
export class AIResponseWorker implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
    private readonly lock: UserJobLock,
    private readonly classifier: IntentClassifier,
    private readonly prompts: PromptResolverService,
    private readonly faq: FaqService,
    private readonly l1Guardrails: L1GuardrailService,
    private readonly context: ContextService,
    private readonly llm: LlmRouter,
    private readonly abuse: LlmAbuseGuard,
    private readonly validation: ValidationService,
    private readonly repo: ConversationRepository,
    private readonly healthConsent: HealthConsentService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
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
    const { userId, batchKey, correlationId, enqueuedAt } = job.data;

    if (!(await this.healthConsent.hasActiveForUser(userId))) {
      await this.drainBatch(batchKey);
      this.logger.info(
        { event: 'ai_response_discarded_no_consent', userId },
        'batch descartado sem tratamento apos revogacao',
      );
      return { status: 'CONSENT_REVOKED' };
    }

    const message = await this.drainBatch(batchKey);
    if (!message) return { status: 'EMPTY' };

    // Lock por usuário: se outro job está em curso, ele já drena o mesmo batchKey.
    const token = await this.lock.acquire(userId);
    if (!token) {
      this.logger.info({ userId }, 'lock ocupado — job em curso drena o batch, nada a fazer');
      return { status: 'LOCKED' };
    }

    try {
      await this.repo.persistTurn({ userId, direction: 'INBOUND', content: message });
      await this.context.recordTurn(userId, 'user', message);
      await this.enqueueTyping(userId);

      // Teto operacional: acima de 50 msg/dia, aviso gentil SEM custo de LLM (Sato §9.4).
      if (await this.abuse.isOverDailyLimit(userId)) {
        await this.deliver(userId, correlationId, DAILY_LIMIT_MESSAGE, null, false, enqueuedAt);
        return { status: 'LIMIT' };
      }

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
      if (guardrail === 'SCOPE') {
        const response = await this.prompts.foraDeEscopoResponse();
        await this.deliver(userId, correlationId, response, null, true, enqueuedAt, 0, true);
        await this.context.recordTurn(userId, 'assistant', response);
        await this.context.summarizeIfNeeded(userId);
        await this.repo.persistHandoff(userId, 'ALERT', 'FORA_DE_ESCOPO');
        return { status: 'SENT' };
      }

      const faq = await this.faq.match(message);
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
        await this.context.summarizeIfNeeded(userId);
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

      const scrubUser = await this.repo.loadScrubUser(userId);
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

      const draft = await this.buildResponse(userId, intent.intent, message, scrubUser);
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
      await this.context.summarizeIfNeeded(userId);

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

  /** Roteia a intenção para a montagem certa (com ou sem LLM). */
  private async buildResponse(
    userId: string,
    intent: Intent,
    message: string,
    scrubUser: ScrubUser,
  ): Promise<ResponseDraft> {
    if (intent === 'FORA_DE_ESCOPO') {
      // Recusa honesta pré-aprovada — sem LLM generativo (US-3.4). O nome da agente vem
      // da configuração publicada (US-7.6), nunca de literal no código.
      return draftPass(await this.prompts.foraDeEscopoResponse(), null, 0);
    }
    if (intent === 'SUBSTITUICAO_EXERCICIO') {
      return this.buildSubstitution(userId, intent, message, scrubUser);
    }
    return this.buildGenerative(userId, intent, message, scrubUser, undefined);
  }

  /** Substituição segura: substituto SEMPRE da base; a IA só verbaliza; o validador confirma. */
  private async buildSubstitution(
    userId: string,
    intent: Intent,
    message: string,
    scrubUser: ScrubUser,
  ): Promise<ResponseDraft> {
    const constraints = await this.repo.loadConstraints(userId);
    const target = findExerciseByMention(message);
    const substitute = target && constraints ? findSafeSubstitute(target, constraints) : null;

    if (!target || !substitute) {
      // Nada seguro na base → honestidade + revisão humana, sem LLM.
      return { ...draftPass(SUBSTITUTION_FALLBACK_MESSAGE, null, 0), humanReview: true };
    }

    const extra =
      `SUBSTITUTO APROVADO DA BASE: no lugar de "${target.name}", oriente "${substitute.name}". ` +
      'Explique só essa troca; NÃO sugira nenhum outro exercício nem invente carga.';
    return this.buildGenerative(userId, intent, message, scrubUser, {
      extraSystem: extra,
      allowedExercises: [target.name, substitute.name, target.id, substitute.id],
    });
  }

  /** Caminho generativo: contexto (+RAG) → LLM → validação da resposta. */
  private async buildGenerative(
    userId: string,
    intent: Intent,
    message: string,
    scrubUser: ScrubUser,
    opts: { extraSystem?: string; allowedExercises?: string[] } | undefined,
  ): Promise<ResponseDraft> {
    const ctx = await this.context.build(userId, intent, message);
    const rag = ctx.ragDocs.length
      ? 'TRECHOS DE REFERÊNCIA (baseie a resposta técnica só nisto):\n' +
        ctx.ragDocs
          .map(
            (document) =>
              `[Fonte: ${document.title}${document.sourceUrl ? ` | ${document.sourceUrl}` : ''}]\n${document.snippet}`,
          )
          .join('\n---\n')
      : '';
    const system = [
      await this.prompts.resolvePrompt(intent),
      ctx.cacheablePrefix,
      rag,
      opts?.extraSystem,
    ]
      .filter(Boolean)
      .join('\n\n');

    const startedAt = Date.now();
    const result = await this.llm.complete({
      purpose: 'AI_RESPONSE',
      userId,
      user: scrubUser,
      dataClass: 'HEALTH',
      system,
      messages: [{ role: 'user', content: ctx.volatileSuffix }],
      maxTokens: 500,
      cache: true,
      intent: `coach_${intent}`,
    });
    const latencyMs = Date.now() - startedAt;

    const verdict = this.validation.validateResponse(result.text, {
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
      text: result.text,
      modelUsed: result.model,
      latencyMs,
      validationPassed: true,
      humanReview: verdict.humanReviewRequired,
      blocked: false,
      ragSources: ctx.ragDocs.map((document) => ({
        chunkId: document.chunkId,
        documentId: document.documentId,
        title: document.title,
        ...(document.sourceUrl ? { sourceUrl: document.sourceUrl } : {}),
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

  /** Drena o buffer LIST do batch (concatena a rajada) e o apaga. */
  private async drainBatch(batchKey: string): Promise<string> {
    const items = await this.redis.lrange(batchKey, 0, -1);
    await this.redis.del(batchKey);
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
