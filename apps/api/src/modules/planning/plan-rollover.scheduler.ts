/**
 * Varredura por minuto: às 03:00 do fuso de cada aluno com plano ativo, completa a agenda do
 * horizonte (semana corrente e seguinte). A marca do dia (Redis) torna o disparo idempotente.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { TenantDatabase } from '../../core/database/tenant-database.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { loadEligibleStudents, localParts } from '../training/eligibility';
import { PlanRolloverService } from './plan-rollover.service';

type RolloverJob = { kind: 'SCAN'; force?: boolean };
const RUN_TIME = '03:00';
const MARKER_TTL_SECONDS = 48 * 3_600;

@Injectable()
export class PlanRolloverScheduler implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
    private readonly db: TenantDatabase,
    private readonly rollover: PlanRolloverService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PlanRolloverScheduler.name);
  }

  async onModuleInit(): Promise<void> {
    this.workers.create<RolloverJob>(QUEUE.planRollover, (job) =>
      this.scan(new Date(), { force: job.data.force === true }),
    );
    await this.queues
      .get(QUEUE.planRollover)
      .upsertJobScheduler(
        'plan-rollover-scan',
        { pattern: '* * * * *', tz: 'UTC' },
        { name: 'plan-rollover-scan', data: { kind: 'SCAN' } satisfies RolloverJob },
      );
  }

  async scan(now = new Date(), options: { force?: boolean } = {}) {
    const eligible = await loadEligibleStudents(this.db);
    let scheduled = 0;
    let failed = 0;
    for (const student of eligible) {
      const local = localParts(now, student.timezone);
      if (!local || (!options.force && local.time !== RUN_TIME)) continue;
      const marker = this.keys.forUser(student.userId, 'plan-rollover', 'day', local.date);
      if (!options.force && (await this.redis.exists(marker)) === 1) continue;
      try {
        scheduled += (await this.rollover.ensureHorizon(student.userId, now)).scheduled;
        await this.redis.set(marker, '1', 'EX', MARKER_TTL_SECONDS);
      } catch (err: unknown) {
        failed += 1;
        this.logger.warn(
          { event: 'plan_rollover_failed', userId: student.userId, err },
          'falha ao completar a agenda; segue com os demais',
        );
      }
    }
    if (scheduled > 0) {
      this.logger.info({ event: 'plan_rollover', scheduled }, 'agenda completada');
    }
    if (failed > 0) throw new Error(`${failed} aluno(s) sem a agenda completada nesta varredura`);
    return { status: 'SCANNED', eligible: eligible.length, scheduled };
  }
}
