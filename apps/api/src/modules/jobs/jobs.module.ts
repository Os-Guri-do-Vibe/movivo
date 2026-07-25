/**
 * `JobsModule` — fundação BullMQ (US-1.7).
 *
 * Preenche o esqueleto da Sprint 0 com o SETUP BASE das filas (Rafael §6): `QueueManager`
 * (registro das 5 filas de negócio + `sanity` + `dead-letter`), `WorkerFactory`
 * padronizado, DLQ handler genérico e drenagem graciosa no shutdown. Nenhuma lógica de
 * negócio de fila nasce aqui — só a fundação, provada pelo `SanityWorker`.
 *
 * # Conexão
 * Reusa a descoberta de master via Sentinel do `RedisModule` (CORE global) — `jobs.config`
 * deriva as opções de `buildRedisOptions`. Não há segunda descoberta de master.
 *
 * # Drenagem (ADR / §12.6)
 * O `enableShutdownHooks` (main.ts, Sprint 0) dispara `onApplicationShutdown`: fecham-se
 * primeiro os WORKERS (drenam o job em voo, param de puxar) e só então as QUEUES. AOF do
 * Redis (Sprint 0) garante durabilidade em restart.
 */
import { Module, type OnApplicationShutdown } from '@nestjs/common';

import { DEAD_LETTER_HANDLER, LoggingDeadLetterHandler } from './dlq.handler';
import { QueueManager } from './queue-manager.service';
import { SanityWorker } from './sanity.worker';
import { WorkerFactory } from './worker.factory';

@Module({
  providers: [
    QueueManager,
    WorkerFactory,
    SanityWorker,
    { provide: DEAD_LETTER_HANDLER, useClass: LoggingDeadLetterHandler },
  ],
  exports: [QueueManager, WorkerFactory],
})
export class JobsModule implements OnApplicationShutdown {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.workers.closeAll();
    await this.queues.closeAll();
  }
}
