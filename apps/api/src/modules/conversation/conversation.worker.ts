/**
 * Consumidor da fila `ai-response`: drena a rajada do aluno, aplica as travas (consentimento,
 * lock por aluno, atendimento pausado, confirmações sem pergunta) e entrega o resultado do
 * orquestrador pelo WhatsApp.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { AttendanceService } from '../../core/database/attendance.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { isFinalFailure } from '../jobs/dlq.handler';
import { QUEUE } from '../jobs/jobs.config';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { UserJobLock } from '../whatsapp/user-job-lock';
import type { AiResponseJob } from '../whatsapp/whatsapp-inbound.service';
import { ConversationStore } from './conversation-store';
import { isOnlyAcknowledgements, withoutAcknowledgements } from './inbound-acknowledgement';
import { FALLBACK_MESSAGE } from './messages';
import { ConversationOrchestrator } from './orchestrator.service';

const MAX_MESSAGE_CHARS = 4000;
/** Espera antes de reprocessar mensagem que chegou durante a resposta anterior. */
const ORPHAN_BATCH_RETRIGGER_MS = 5_000;

interface BatchEntry {
  text: string;
  messageId?: string;
}

@Injectable()
export class ConversationWorker implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
    private readonly lock: UserJobLock,
    private readonly consent: HealthConsentService,
    private readonly attendance: AttendanceService,
    private readonly store: ConversationStore,
    private readonly orchestrator: ConversationOrchestrator,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ConversationWorker.name);
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
    const { userId, correlationId } = job.data;
    // O lote é sempre o do titular do job — a chave vem do namespace dele, nunca do payload.
    const batchKey = this.keys.forUser(userId, 'ai-response', 'batch');

    // O lock vem antes do drain: um job concorrente nunca consome o lote do outro.
    const token = await this.lock.acquire(userId);
    if (!token) return { status: 'LOCKED' };

    try {
      const entries = await this.drain(batchKey);
      if (!(await this.consent.hasActiveForUser(userId))) {
        this.logger.info(
          { event: 'conversation_discarded_no_consent', userId },
          'lote descartado: sem consentimento',
        );
        return { status: 'CONSENT_REVOKED' };
      }
      const texts = entries.map((e) => e.text);
      const raw = texts.join(' ').slice(0, MAX_MESSAGE_CHARS);

      // Pausa ligada depois de o job entrar na fila: a IA não responde, mas o texto vai ao histórico.
      if (await this.attendance.isPaused(userId)) {
        if (raw) await this.store.persistTurn({ userId, direction: 'INBOUND', content: raw });
        return { status: 'PAUSED' };
      }

      if (!raw) {
        // Lote vazio numa nova tentativa: a anterior drenou a mensagem e travou antes de responder.
        if (job.attemptsMade > 0)
          await this.deliver(userId, `${correlationId}_retry`, FALLBACK_MESSAGE);
        return { status: 'EMPTY' };
      }

      // "ok", "👌": registra e não responde.
      if (isOnlyAcknowledgements(texts)) {
        await this.store.persistTurn({ userId, direction: 'INBOUND', content: raw });
        return { status: 'ACK_SILENT' };
      }
      const kept = withoutAcknowledgements(texts);
      const message = kept.join(' ').slice(0, MAX_MESSAGE_CHARS);

      await this.store.persistTurn({ userId, direction: 'INBOUND', content: message });
      await this.queues.enqueue(QUEUE.whatsappOutbound, 'agent-typing', {
        userId,
        type: 'TYPING',
      } satisfies WhatsappOutboundJob);

      const result = await this.orchestrator.handle({
        userId,
        text: message,
        messageIds: entries.flatMap((e) => (e.messageId ? [e.messageId] : [])),
        correlationId,
      });
      if (result.reply) {
        await this.store.persistTurn({
          userId,
          direction: 'OUTBOUND',
          content: result.reply,
          validationPassed: true,
        });
        await this.deliver(userId, correlationId, result.reply);
      }
      return { status: result.status };
    } finally {
      await this.lock.release(userId, token);
      await this.requeueOrphanedBatch(userId, batchKey, correlationId);
    }
  }

  private async deliver(userId: string, correlationId: string, text: string): Promise<void> {
    const job: WhatsappOutboundJob = {
      userId,
      type: 'CONVERSATION_MESSAGE',
      text,
      dedupeId: correlationId,
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'agent-message', job, {
      jobId: `agent-message_${correlationId}`,
    });
  }

  /** Drena e apaga o buffer numa única transação Redis, uma entrada por mensagem do aluno. */
  private async drain(batchKey: string): Promise<BatchEntry[]> {
    const result = await this.redis.multi().lrange(batchKey, 0, -1).del(batchKey).exec();
    const items = (result?.[0]?.[1] ?? []) as string[];
    return items.flatMap((raw) => {
      try {
        const parsed = JSON.parse(raw) as { text?: string; messageId?: string };
        return parsed.text ? [{ text: parsed.text, messageId: parsed.messageId }] : [];
      } catch {
        return [];
      }
    });
  }

  /** Mensagem que chegou durante a resposta anterior não pode ficar presa no buffer. */
  private async requeueOrphanedBatch(
    userId: string,
    batchKey: string,
    correlationId: string,
  ): Promise<void> {
    try {
      if ((await this.redis.llen(batchKey)) === 0) return;
      const followUp: AiResponseJob = { userId, batchKey, correlationId, enqueuedAt: Date.now() };
      await this.queues.enqueue(QUEUE.aiResponse, 'agent-response', followUp, {
        delay: ORPHAN_BATCH_RETRIGGER_MS,
      });
    } catch (err: unknown) {
      this.logger.warn(
        { userId, err, event: 'conversation_orphan_requeue_failed' },
        'não foi possível reenfileirar o lote',
      );
    }
  }

  /** Falha persistente → "já te respondo", sem deixar o aluno no silêncio. */
  private async handleTerminalFailure(job: Job<AiResponseJob>, err: Error): Promise<void> {
    const { userId, correlationId } = job.data;
    this.logger.error(
      { userId, jobId: job.id, err: err.message, event: 'conversation_dlq' },
      'resposta esgotou os retries',
    );
    const fallback: WhatsappOutboundJob = {
      userId,
      type: 'CONVERSATION_MESSAGE',
      text: FALLBACK_MESSAGE,
      dedupeId: `dlq_${correlationId}`,
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'agent-message', fallback, {
      jobId: `agent-message_dlq_${correlationId}`,
    });
  }
}
