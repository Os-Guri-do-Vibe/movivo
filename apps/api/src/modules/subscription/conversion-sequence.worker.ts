/**
 * ConversionSequenceWorker (US-4.3) — sequência de nurturing do trial, dias 7/10/13/14.
 *
 * A conversão é uma SEQUÊNCIA, não um evento (Lucas §Épico 5): o link único no dia 14 é tarde
 * demais. No submit da anamnese, um job `trial-start` cria o trial e **agenda** os quatro
 * touchpoints (BullMQ `delay`, ancorados no fim persistido do trial). Cada touchpoint é
 * **idempotente** (job/guard por titular + touchpoint) e **checa o estado antes de enviar**:
 * quem já converteu (`ACTIVE`) ou saiu (`CANCELED`/`PAUSED`) para de receber. A fila retenta
 * falhas transitórias; o envio real segue pelo `whatsapp-outbound`, que também possui retries.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { AgentPersonaService } from '../../core/agent-config/agent-persona.service';
import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import { REDIS_KEY_BUILDER, RedisKeyBuilder } from '../../core/redis/redis-key.util';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { type ConversionTouchpoint, conversionMessage } from './subscription-messages';
import { TRIAL_DAYS, type SubscriptionPlan } from './subscription-model';
import { SubscriptionService } from './subscription.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Offsets do início do trial, convertidos abaixo para a âncora `trialEndsAt`. O win-back não é
 * agendado separadamente: ele coincidiria com o dia 10 e duplicaria mensagem/Checkout. */
const TOUCHPOINTS: readonly { key: ConversionTouchpoint; dayOffset: number }[] = [
  { key: 'day7', dayOffset: 7 },
  { key: 'day10', dayOffset: 10 },
  { key: 'day13', dayOffset: 13 },
  { key: 'day14', dayOffset: 14 },
];

/** TTL do guard de idempotência do touchpoint — folgado além da janela da sequência. */
const GUARD_TTL_SECONDS = 60 * 24 * 3600;

export interface TrialStartJob {
  userId: string;
  /** Opcional só para jobs legados já persistidos antes desta versão. */
  plan?: SubscriptionPlan;
}
export interface TouchpointJob {
  userId: string;
  key: ConversionTouchpoint;
}
type ConversionJob = TrialStartJob | TouchpointJob;

@Injectable()
export class ConversionSequenceWorker implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
    private readonly subs: SubscriptionService,
    private readonly agentPersona: AgentPersonaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ConversionSequenceWorker.name);
  }

  onModuleInit(): void {
    this.workers.create<ConversionJob>(QUEUE.conversionSequence, (job) => this.process(job));
  }

  async process(job: Job<ConversionJob>): Promise<{ status: string }> {
    if (job.name === 'trial-start') {
      return this.handleTrialStart(job.data as TrialStartJob);
    }
    return this.handleTouchpoint(job.data as TouchpointJob);
  }

  /** Cria o trial (idempotente) e agenda os quatro touchpoints pelo fim persistido. */
  private async handleTrialStart({ userId, plan }: TrialStartJob): Promise<{ status: string }> {
    const sub = await this.subs.startTrial(userId, plan ?? 'MONTHLY');
    for (const tp of TOUCHPOINTS) {
      const sendAt = sub.trialEndsAt
        ? sub.trialEndsAt.getTime() + (tp.dayOffset - TRIAL_DAYS) * DAY_MS
        : Date.now() + tp.dayOffset * DAY_MS;
      await this.queues.enqueue(
        QUEUE.conversionSequence,
        'touchpoint',
        { userId, key: tp.key },
        { jobId: `conv_${userId}_${tp.key}`, delay: Math.max(0, sendAt - Date.now()) },
      );
    }
    return { status: 'SCHEDULED' };
  }

  /** Roteia o touchpoint (nurture dias 7-14 ou win-back pós-trial). Idempotente por chave. */
  private async handleTouchpoint({ userId, key }: TouchpointJob): Promise<{ status: string }> {
    let sub = await this.subs.getForUser(userId);
    if (!sub) return { status: 'NO_SUBSCRIPTION' };

    // Para de nutrir quem já converteu (ACTIVE) ou saiu (CANCELED/PAUSED).
    if (sub.status === 'ACTIVE' || sub.status === 'CANCELED' || sub.status === 'PAUSED') {
      this.logger.info(
        { userId, touchpoint: key, status: sub.status },
        'sequência de conversão interrompida (fora do trial)',
      );
      return { status: `SKIP_${sub.status}` };
    }

    // O backend — e não o relógio do frontend — efetiva TRIALING → EXPIRED.
    const expiration = await this.subs.expireTrial(userId);
    if (expiration.status === 'TRIAL_NOT_ENDED') return expiration;
    if (expiration.status.startsWith('SKIP_')) return expiration;
    sub = await this.subs.getForUser(userId);
    if (!sub || sub.status !== 'EXPIRED') return { status: `SKIP_${sub?.status ?? 'NONE'}` };

    // Marca somente DEPOIS do enqueue; falha de Redis/WhatsApp continua reprocessável.
    const guard = this.keys.forUser(userId, 'conv-sent', key);
    if (await this.redis.get(guard)) return { status: 'ALREADY_SENT' };

    await this.sendMessage(userId, key);
    await this.redis.set(guard, '1', 'EX', GUARD_TTL_SECONDS, 'NX');
    this.logger.info(
      { event: 'conversion_message_sent', userId, touchpoint: key },
      'conversion_message_sent',
    );
    if (key === 'winback') this.logger.info({ event: 'winback_sent', userId }, 'winback_sent');
    return { status: 'SENT' };
  }

  /** Enfileira a mensagem no outbound com o link do plano pré-preenchido. */
  private async sendMessage(userId: string, key: ConversionTouchpoint): Promise<void> {
    const checkoutUrl = await this.subs.createCheckoutLink(userId);
    // Sprint 11: a copy de conversão cita o nome da agente, então precisa da persona do
    // slot do titular — não da persona global, que não existe mais.
    const agentName = await this.agentPersona.agentName(await this.subs.personaSlotFor(userId));
    await this.queues.enqueue(
      QUEUE.whatsappOutbound,
      'coach-message',
      {
        userId,
        type: 'COACH_MESSAGE',
        text: conversionMessage(key, checkoutUrl, agentName),
        dedupeId: `conv_${key}`,
      },
      { jobId: `conv-msg_${userId}_${key}` },
    );
  }
}
