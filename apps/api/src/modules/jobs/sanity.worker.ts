/**
 * Worker de sanidade (US-1.7 / TASK-1.7.3).
 *
 * Prova a fundação de filas ponta a ponta: enqueue→process→complete, retry/backoff e
 * roteamento para DLQ na falha terminal. NÃO é lógica de negócio — é o único worker
 * que esta sprint liga; os processadores reais nascem nas Sprints 2-5.
 *
 * Contrato do job `sanity`:
 *   · `{ echo: string }`            → retorna `{ echo }` (caminho feliz);
 *   · `{ fail: true }`              → lança (exercita retry/backoff e, no fim, DLQ).
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';

import { QUEUE } from './jobs.config';
import { WorkerFactory } from './worker.factory';

interface SanityJob {
  echo?: string;
  fail?: boolean;
  correlationId?: string;
}

@Injectable()
export class SanityWorker implements OnModuleInit {
  constructor(private readonly workers: WorkerFactory) {}

  onModuleInit(): void {
    this.workers.create<SanityJob>(QUEUE.sanity, async (job) => {
      if (job.data.fail) throw new Error('sanity job configurado para falhar');
      return { echo: job.data.echo ?? '' };
    });
  }
}
