/**
 * ConversionSequenceWorker (US-4.3) — sequência de nurturing do trial, dias 7/10/13/14.
 *
 * A conversão é uma SEQUÊNCIA, não um evento (Lucas §Épico 5): o link único no dia 14 é tarde
 * demais. No submit da anamnese, um job `trial-start` cria o trial e **agenda** os quatro
 * touchpoints (BullMQ `delay`, ancorados no início do trial). Cada touchpoint é **idempotente**
 * (guard Redis `user_id + touchpoint`) e **checa o estado antes de enviar**: quem já converteu
 * (`ACTIVE`) ou saiu (`CANCELED`/`PAUSED`) **para de receber**. Fila `attempts: 1` (US-1.7): um
 * touchpoint que falha não reenvia fora da janela. As mensagens saem pelo `whatsapp-outbound`.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { AppConfigService } from '../../core/config';
import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import { REDIS_KEY_BUILDER, RedisKeyBuilder } from '../../core/redis/redis-key.util';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { type ConversionTouchpoint, conversionMessage } from './subscription-messages';
import { SubscriptionService } from './subscription.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Offsets ancorados no início do trial. ponytail: com trial de 7 dias, 10/13/14 são últimos
 *  empurrões pós-expiração; reconciliar as âncoras se o comprimento do trial mudar. */
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
    private readonly config: AppConfigService,
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

  /** Cria o trial (idempotente) e agenda os quatro touchpoints ancorados no início. */
  private async handleTrialStart({ userId }: TrialStartJob): Promise<{ status: string }> {
    await this.subs.startTrial(userId);
    for (const tp of TOUCHPOINTS) {
      await this.queues.enqueue(
        QUEUE.conversionSequence,
        'touchpoint',
        { userId, key: tp.key },
        { jobId: `conv_${userId}_${tp.key}`, delay: tp.dayOffset * DAY_MS },
      );
    }
    return { status: 'SCHEDULED' };
  }

  /** Envia um touchpoint se o titular ainda está no trial; para para convertidos/saídos. */
  private async handleTouchpoint({ userId, key }: TouchpointJob): Promise<{ status: string }> {
    // Idempotência: um touchpoint dispara uma única vez por usuário.
    const guard = this.keys.forUser(userId, 'conv-sent', key);
    if ((await this.redis.set(guard, '1', 'EX', GUARD_TTL_SECONDS, 'NX')) !== 'OK') {
      return { status: 'ALREADY_SENT' };
    }

    const sub = await this.subs.getForUser(userId);
    if (!sub) return { status: 'NO_SUBSCRIPTION' };

    // Para de nutrir quem já converteu (ACTIVE) ou saiu (CANCELED/PAUSED).
    if (sub.status === 'ACTIVE' || sub.status === 'CANCELED' || sub.status === 'PAUSED') {
      this.logger.info(
        { userId, touchpoint: key, status: sub.status },
        'sequência de conversão interrompida (fora do trial)',
      );
      return { status: `SKIP_${sub.status}` };
    }

    const link = `${this.config.whatsapp.publicSiteUrl}/assinar?plano=${sub.plan}`;
    await this.queues.enqueue(
      QUEUE.whatsappOutbound,
      'coach-message',
      {
        userId,
        type: 'COACH_MESSAGE',
        text: conversionMessage(key, link),
        dedupeId: `conv_${key}`,
      },
      { jobId: `conv-msg_${userId}_${key}` },
    );
    this.logger.info(
      { event: 'conversion_message_sent', userId, touchpoint: key },
      'conversion_message_sent',
    );
    return { status: 'SENT' };
  }
}
