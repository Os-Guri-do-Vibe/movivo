/**
 * Revisão semanal dos especialistas, no domingo à noite (junto da revisão semanal do progresso):
 * às 19:15 do fuso de cada aluno o treinador lê a semana de treino e ajusta o protocolo; às 19:30
 * a nutricionista faz o mesmo com a alimentação. Os horários são espaçados para o aluno receber
 * uma conversa de cada vez. A marca do dia (Redis) torna o disparo idempotente; o trabalho em si
 * roda no worker do acompanhamento.
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

/** Domingo (0), um horário local por especialista. */
const WEEKDAY = 0;
const RUN_TIMES = { TRAINING_FOLLOW_UP: '19:15', NUTRITION_FOLLOW_UP: '19:30' } as const;
const MARKER_TTL_SECONDS = 48 * 3_600;

@Injectable()
export class SpecialistFollowUpScheduler {
  constructor(
    private readonly db: TenantDatabase,
    private readonly queues: QueueManager,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SpecialistFollowUpScheduler.name);
  }

  async scan(now = new Date(), options: { force?: boolean } = {}) {
    const eligible = await loadEligibleStudents(this.db);
    let scheduled = 0;
    for (const student of eligible) {
      const local = localParts(now, student.timezone);
      if (!local) continue;
      const weekday = new Date(`${local.date}T00:00:00Z`).getUTCDay();
      const kinds = (Object.keys(RUN_TIMES) as Array<keyof typeof RUN_TIMES>).filter(
        (kind) => options.force || (weekday === WEEKDAY && local.time === RUN_TIMES[kind]),
      );
      for (const kind of kinds) {
        const marker = this.keys.forUser(student.userId, 'specialist-follow-up', kind, local.date);
        if (!options.force && (await this.redis.exists(marker)) === 1) continue;
        try {
          const job: FollowUpJob = { kind, userId: student.userId };
          await this.queues.enqueue(
            QUEUE.studentFollowUp,
            kind.toLowerCase().replaceAll('_', '-'),
            job,
            {
              jobId: `${kind.toLowerCase().replaceAll('_', '-')}_${student.userId}_${local.date}`,
            },
          );
          await this.redis.set(marker, '1', 'EX', MARKER_TTL_SECONDS);
          scheduled += 1;
        } catch (err: unknown) {
          this.logger.warn(
            { event: 'specialist_follow_up_enqueue_failed', kind, userId: student.userId, err },
            'falha ao enfileirar o acompanhamento; segue com os demais',
          );
        }
      }
    }
    return { status: 'SCANNED', eligible: eligible.length, scheduled };
  }
}
