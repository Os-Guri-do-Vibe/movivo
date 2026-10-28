/**
 * Varredura por minuto: às 04:00 do fuso de cada aluno envia o link do dia (só quando há
 * sessão agendada) e fecha o que ficou para trás. A marca do dia (Redis) e o `jobId` do envio
 * tornam o disparo idempotente, inclusive num retry da varredura inteira.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { planSessions, scheduledSessions } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { firstNameOf, loadEligibleStudents, localParts } from './eligibility';
import { ScheduleService } from './schedule.service';
import { TrainingLinkService } from './training-link.service';

type TrainingDailyJob = { kind: 'SCAN'; force?: boolean };
const SCAN_CRON = '* * * * *';
const SEND_TIME = '04:00';
const MARKER_TTL_SECONDS = 48 * 3_600;

@Injectable()
export class TrainingDailyScheduler implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
    private readonly db: TenantDatabase,
    private readonly links: TrainingLinkService,
    private readonly schedule: ScheduleService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TrainingDailyScheduler.name);
  }

  async onModuleInit(): Promise<void> {
    this.workers.create<TrainingDailyJob>(QUEUE.trainingDaily, (job) =>
      this.scan(new Date(), { force: job.data.force === true }),
    );
    await this.queues
      .get(QUEUE.trainingDaily)
      .upsertJobScheduler(
        'daily-training-scan',
        { pattern: SCAN_CRON, tz: 'UTC' },
        { name: 'daily-training-scan', data: { kind: 'SCAN' } satisfies TrainingDailyJob },
      );
  }

  async scan(now = new Date(), options: { force?: boolean } = {}) {
    const missed = await this.schedule.markMissed(now);
    const eligible = await loadEligibleStudents(this.db);
    let sent = 0;
    let failed = 0;
    for (const student of eligible) {
      const local = localParts(now, student.timezone);
      if (!local || (!options.force && local.time !== SEND_TIME)) continue;
      try {
        if (await this.sendDay(student, local.date, local.time)) sent += 1;
      } catch (err: unknown) {
        failed += 1;
        this.logger.warn(
          { event: 'training_daily_failed', userId: student.userId, err },
          'falha ao enviar o link do dia; segue com os demais',
        );
      }
    }
    this.logger.info(
      { event: 'training_daily_scan', eligible: eligible.length, sent, failed, missed },
      'varredura do link diário concluída',
    );
    if (failed > 0) throw new Error(`${failed} aluno(s) sem o link do dia nesta varredura`);
    return { status: 'SCANNED', eligible: eligible.length, sent, missed };
  }

  private async sendDay(
    student: { userId: string; name: string | null },
    date: string,
    localTime: string,
  ): Promise<boolean> {
    const marker = this.keys.forUser(student.userId, 'training-daily', 'decided', date);
    if ((await this.redis.exists(marker)) === 1) return false;
    const titles = await this.db.runAsUser(student.userId, 'USER', async (tx) => {
      const rows = await tx
        .select({ title: planSessions.title, status: scheduledSessions.status })
        .from(scheduledSessions)
        .innerJoin(planSessions, eq(planSessions.id, scheduledSessions.planSessionId))
        .where(
          and(
            eq(scheduledSessions.userId, student.userId),
            eq(scheduledSessions.scheduledOn, date),
          ),
        )
        .orderBy(asc(scheduledSessions.createdAt));
      return rows.filter((r) => r.status === 'PLANNED').map((r) => r.title);
    });
    if (titles.length === 0) return false;
    await this.links.sendDaily({
      userId: student.userId,
      firstName: firstNameOf(student.name),
      titles,
      date,
      localTime,
    });
    await this.redis.set(marker, '1', 'EX', MARKER_TTL_SECONDS);
    return true;
  }
}
