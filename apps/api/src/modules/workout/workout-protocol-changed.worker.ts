/**
 * `WorkoutProtocolChangedWorker` — consome `QUEUE.workoutProtocolChanged`: o protocolo do aluno
 * ganhou uma versão nova e o treino de hoje pode ter ficado desatualizado. A lógica (atualizar o
 * treino que ainda não começou e oferecer o link novo) é de `WorkoutRefreshOfferService`.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type Job } from 'bullmq';

import { QUEUE } from '../jobs/jobs.config';
import type { WorkoutProtocolChangedJob } from '../jobs/workout-protocol-changed.contract';
import { WorkerFactory } from '../jobs/worker.factory';
import { WorkoutRefreshOfferService } from './workout-refresh-offer.service';

@Injectable()
export class WorkoutProtocolChangedWorker implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly offers: WorkoutRefreshOfferService,
  ) {}

  onModuleInit(): void {
    this.workers.create<WorkoutProtocolChangedJob>(QUEUE.workoutProtocolChanged, (job) =>
      this.process(job),
    );
  }

  async process(job: Job<WorkoutProtocolChangedJob>): Promise<{ status: string }> {
    const result = await this.offers.onProtocolChanged(job.data.userId, job.data.reason);
    return { status: result };
  }
}
