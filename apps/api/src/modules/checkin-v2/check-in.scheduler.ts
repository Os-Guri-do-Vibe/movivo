/**
 * Varredura por minuto: no domingo, às 18:00 do fuso de cada aluno, abre o check-in da semana e
 * manda o link por WhatsApp. Idempotente pela marca da semana (Redis) e pelo `jobId` do envio.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { TenantDatabase } from '../../core/database/tenant-database.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { WorkerFactory } from '../jobs/worker.factory';
import { mondayOf } from '../planning/calc/week-planner';
import { firstNameOf, loadEligibleStudents, localParts } from '../training/eligibility';
import { TrainingLinkService } from '../training/training-link.service';
import { CheckInService } from './check-in.service';

type CheckInJob = { kind: 'SCAN'; force?: boolean };
const SEND_TIME = '18:00';
const MARKER_TTL_SECONDS = 8 * 86_400;

@Injectable()
export class CheckInScheduler implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
    private readonly db: TenantDatabase,
    private readonly checkIns: CheckInService,
    private readonly links: TrainingLinkService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CheckInScheduler.name);
  }

  async onModuleInit(): Promise<void> {
    this.workers.create<CheckInJob>(QUEUE.checkIn, (job) =>
      this.scan(new Date(), { force: job.data.force === true }),
    );
    await this.queues
      .get(QUEUE.checkIn)
      .upsertJobScheduler(
        'weekly-check-in-scan',
        { pattern: '* * * * *', tz: 'UTC' },
        { name: 'weekly-check-in-scan', data: { kind: 'SCAN' } satisfies CheckInJob },
      );
  }

  async scan(now = new Date(), options: { force?: boolean } = {}) {
    const eligible = await loadEligibleStudents(this.db);
    let sent = 0;
    let failed = 0;
    for (const student of eligible) {
      const local = localParts(now, student.timezone);
      if (
        !local ||
        (!options.force &&
          (local.time !== SEND_TIME || new Date(`${local.date}T12:00:00Z`).getUTCDay() !== 0))
      ) {
        continue;
      }
      try {
        const marker = this.keys.forUser(student.userId, 'check-in', 'week', mondayOf(local.date));
        if ((await this.redis.exists(marker)) === 1) continue;
        await this.checkIns.open(student.userId, now);
        const link = await this.links.shortUrl(student.userId, { next: '/check-in' });
        const outbound: WhatsappOutboundJob = {
          userId: student.userId,
          type: 'CHECKIN_MESSAGE',
          dedupeId: `check-in-${mondayOf(local.date)}`,
          text: `${firstNameOf(student.name)}, hora do check-in da semana. Leva um minuto e ajuda a gente a ajustar o seu plano: ${link}`,
        };
        await this.queues.enqueue(QUEUE.whatsappOutbound, 'check-in-link', outbound, {
          jobId: `wa-check-in-${student.userId}-${mondayOf(local.date)}`,
        });
        await this.redis.set(marker, '1', 'EX', MARKER_TTL_SECONDS);
        sent += 1;
      } catch (err: unknown) {
        failed += 1;
        this.logger.warn(
          { event: 'check_in_failed', userId: student.userId, err },
          'falha ao abrir o check-in',
        );
      }
    }
    if (failed > 0) throw new Error(`${failed} aluno(s) sem check-in nesta varredura`);
    return { status: 'SCANNED', eligible: eligible.length, sent };
  }
}
