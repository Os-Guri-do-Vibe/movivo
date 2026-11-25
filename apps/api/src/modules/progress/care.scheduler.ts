/**
 * Varredura por minuto do cuidado diário, no relógio local de cada aluno:
 * 11:00 escada de silêncio e lembrete do combinado; 21:00 estudo da noite dos especialistas;
 * 23:50 fecha o estudo do dia (só código). Cada trabalho roda no worker do acompanhamento, uma
 * vez por aluno e dia (marca no Redis).
 */
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { TenantDatabase } from '../../core/database/tenant-database.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import type { FollowUpJob } from '../jobs/follow-up.contract';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { loadEligibleStudents, localParts } from '../training/eligibility';

export const CARE_TIMES = { DAILY: '11:00', NIGHTLY: '21:00', DIGEST_CLOSE: '23:50' } as const;
const MARKER_TTL_SECONDS = 48 * 3_600;

@Injectable()
export class CareScheduler {
  constructor(
    private readonly db: TenantDatabase,
    private readonly queues: QueueManager,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CareScheduler.name);
  }

  async scan(now = new Date(), options: { force?: boolean } = {}) {
    const eligible = await loadEligibleStudents(this.db);
    let scheduled = 0;
    for (const student of eligible) {
      const local = localParts(now, student.timezone);
      if (!local) continue;
      const tasks = (Object.keys(CARE_TIMES) as Array<keyof typeof CARE_TIMES>).filter(
        (task) => options.force === true || local.time === CARE_TIMES[task],
      );
      for (const task of tasks) {
        const marker = this.keys.forUser(student.userId, 'care', task, local.date);
        if (!options.force && (await this.redis.exists(marker)) === 1) continue;
        try {
          const job: FollowUpJob = { kind: 'CARE', userId: student.userId, task };
          await this.queues.enqueue(QUEUE.studentFollowUp, `care-${task.toLowerCase()}`, job, {
            jobId: `care_${task.toLowerCase()}_${student.userId}_${local.date}`,
          });
          await this.redis.set(marker, '1', 'EX', MARKER_TTL_SECONDS);
          scheduled += 1;
        } catch (err: unknown) {
          this.logger.warn(
            { event: 'care_enqueue_failed', task, userId: student.userId, err },
            'falha ao enfileirar o cuidado diário; segue com os demais',
          );
        }
      }
    }
    return { status: 'SCANNED', eligible: eligible.length, scheduled };
  }
}
