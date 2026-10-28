/**
 * Varredura por minuto: na segunda-feira, às 06:00 do fuso de cada aluno, enfileira a revisão
 * da semana que fechou (uma por aluno, para o custo de modelo não bloquear a varredura).
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { TenantDatabase } from '../../core/database/tenant-database.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { mondayOf } from '../planning/calc/week-planner';
import { todayIn } from '../planning/plan-generation.service';
import { loadEligibleStudents, localParts } from '../training/eligibility';
import { GoalProgressService } from './goal-progress.service';
import { PreferenceExtractionService } from './preference-extraction.service';
import { WeeklyReviewService } from './weekly-review.service';

type ReviewJob = { kind: 'SCAN'; force?: boolean } | { kind: 'STUDENT'; userId: string };
const RUN_TIME = '06:00';
const MARKER_TTL_SECONDS = 8 * 86_400;

@Injectable()
export class WeeklyReviewScheduler implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
    private readonly db: TenantDatabase,
    private readonly reviews: WeeklyReviewService,
    private readonly preferences: PreferenceExtractionService,
    private readonly goals: GoalProgressService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WeeklyReviewScheduler.name);
  }

  async onModuleInit(): Promise<void> {
    this.workers.create<ReviewJob>(QUEUE.weeklyReview, async (job) => {
      if (job.data.kind === 'STUDENT') return this.reviewStudent(job.data.userId);
      return this.scan(new Date(), { force: job.data.force === true });
    });
    await this.queues
      .get(QUEUE.weeklyReview)
      .upsertJobScheduler(
        'weekly-review-scan',
        { pattern: '* * * * *', tz: 'UTC' },
        { name: 'weekly-review-scan', data: { kind: 'SCAN' } satisfies ReviewJob },
      );
  }

  async scan(now = new Date(), options: { force?: boolean } = {}) {
    const eligible = await loadEligibleStudents(this.db);
    let queued = 0;
    for (const student of eligible) {
      const local = localParts(now, student.timezone);
      if (
        !local ||
        (!options.force &&
          (local.time !== RUN_TIME || new Date(`${local.date}T12:00:00Z`).getUTCDay() !== 1))
      ) {
        continue;
      }
      const week = mondayOf(local.date);
      const marker = this.keys.forUser(student.userId, 'weekly-review', 'week', week);
      if ((await this.redis.exists(marker)) === 1) continue;
      await this.queues.enqueue(
        QUEUE.weeklyReview,
        'weekly-review-student',
        { kind: 'STUDENT', userId: student.userId } satisfies ReviewJob,
        { jobId: `weekly-review_${student.userId}_${week}` },
      );
      await this.redis.set(marker, '1', 'EX', MARKER_TTL_SECONDS);
      queued += 1;
    }
    return { eligible: eligible.length, queued };
  }

  /** Metas + revisão da semana + preferências (cada etapa falha sem derrubar as outras). */
  async reviewStudent(userId: string, now = new Date()) {
    const today = todayIn(null, now);
    try {
      await this.goals.sync(userId, today);
    } catch (err: unknown) {
      this.logger.warn(
        { userId, err, event: 'goal_progress_failed' },
        'progresso das metas falhou',
      );
    }
    const review = await this.reviews.review(userId, { now });
    let preferences = 0;
    try {
      preferences = await this.preferences.extract(userId, today, now);
    } catch (err: unknown) {
      this.logger.warn(
        { userId, err, event: 'preference_extraction_failed' },
        'extração de preferências falhou',
      );
    }
    return { review: review.status, preferences };
  }
}
