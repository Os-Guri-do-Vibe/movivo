/**
 * Varredura por minuto: às 16:00 do fuso de cada aluno com plano ativo, abre a reavaliação de
 * quem teve o ciclo vencido. A mesma fila executa a análise e o próximo ciclo quando o aluno
 * responde, e retoma respostas que ficaram paradas.
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
import { CycleRenewalService } from './cycle-renewal.service';
import { ReassessmentService, type ReassessmentJob } from './reassessment.service';

const RUN_TIME = '16:00';
const MARKER_TTL_SECONDS = 48 * 3_600;
/** Resposta sem análise depois disto é retomada pela varredura. */
const STUCK_AFTER_MS = 15 * 60_000;

@Injectable()
export class ReassessmentWorker implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
    private readonly db: TenantDatabase,
    private readonly reassessments: ReassessmentService,
    private readonly renewal: CycleRenewalService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ReassessmentWorker.name);
  }

  async onModuleInit(): Promise<void> {
    this.workers.create<ReassessmentJob & { force?: boolean }>(QUEUE.cycleReassessment, (job) =>
      job.data.kind === 'RENEW' && job.data.userId && job.data.reassessmentId
        ? this.renewal.handle(job.data.userId, job.data.reassessmentId)
        : this.scan(new Date(), { force: job.data.force === true }),
    );
    await this.queues
      .get(QUEUE.cycleReassessment)
      .upsertJobScheduler(
        'cycle-reassessment-scan',
        { pattern: '* * * * *', tz: 'UTC' },
        { name: 'cycle-reassessment-scan', data: { kind: 'SCAN' } satisfies ReassessmentJob },
      );
  }

  async scan(now = new Date(), options: { force?: boolean } = {}) {
    const eligible = await loadEligibleStudents(this.db);
    let opened = 0;
    for (const student of eligible) {
      const local = localParts(now, student.timezone);
      if (!local || (!options.force && local.time !== RUN_TIME)) continue;
      const marker = this.keys.forUser(student.userId, 'cycle-reassessment', 'day', local.date);
      if (!options.force && (await this.redis.exists(marker)) === 1) continue;
      try {
        const result = await this.reassessments.openDue(student.userId, student.timezone, now);
        if (result.status === 'OPENED') opened += 1;
        await this.redis.set(marker, '1', 'EX', MARKER_TTL_SECONDS);
      } catch (err: unknown) {
        this.logger.warn(
          { event: 'cycle_reassessment_failed', userId: student.userId, err },
          'falha ao abrir a reavaliação; segue com os demais',
        );
      }
    }
    let resumed = 0;
    for (const stuck of await this.reassessments.stuckSubmissions(STUCK_AFTER_MS, now)) {
      await this.reassessments.enqueueRenewal(stuck.userId, stuck.id);
      resumed += 1;
    }
    return { status: 'SCANNED', eligible: eligible.length, opened, resumed };
  }
}
