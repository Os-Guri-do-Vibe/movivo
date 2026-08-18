/**
 * `QueueManager` — registro e produção de jobs (US-1.7 / TASK-1.7.1).
 *
 * Cria uma `Queue` BullMQ para cada entrada de `QUEUE_REGISTRY` (as 5 filas de negócio
 * de §6 + `sanity` + `dead-letter`), todas sobre a MESMA conexão via Sentinel e sob o
 * prefixo namespaced por `REDIS_KEY_PREFIX`. Nenhum processor de negócio nasce aqui —
 * só as definições (produtores). O enqueue aplica os defaults centrais de `jobs.config`.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type ConnectionOptions, type JobsOptions, Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';

import { AppConfigService } from '../../core/config';
import {
  buildBullConnection,
  bullPrefix,
  QUEUE,
  QUEUE_REGISTRY,
  type QueueName,
  resolveJobOptions,
} from './jobs.config';

@Injectable()
export class QueueManager implements OnModuleInit {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(QueueManager.name);
  }

  onModuleInit(): void {
    // Cast: `RedisOptions` do ioredis não tem a assinatura de índice que o `RedisOptions`
    // PRÓPRIO do bullmq 6.x exige — mesma opção de conexão em runtime, só divergência de
    // declaração de tipos entre os dois pacotes (achado 2026-08-18, migração do bullmq 6.x).
    const connection = buildBullConnection(this.config) as ConnectionOptions;
    const prefix = bullPrefix(this.config);
    for (const name of Object.keys(QUEUE_REGISTRY) as QueueName[]) {
      this.queues.set(name, new Queue(name, { connection, prefix }));
    }
    this.logger.info({ queues: [...this.queues.keys()] }, 'filas BullMQ registradas');
  }

  get(name: QueueName): Queue {
    const queue = this.queues.get(name);
    if (!queue) throw new Error(`fila não registrada: ${name}`);
    return queue;
  }

  /** Enfileira um job aplicando os defaults centrais da fila (retry/backoff/limpeza). */
  async enqueue(
    name: QueueName,
    jobName: string,
    data: unknown,
    overrides: JobsOptions = {},
  ): Promise<string> {
    const job = await this.get(name).add(jobName, data, {
      ...resolveJobOptions(name),
      ...overrides,
    });
    return job.id ?? 'unknown';
  }

  /** Fecha todas as filas (produtores). Chamado após os workers drenarem. */
  async closeAll(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.queues.clear();
  }

  /** Exposto para health check e testes. */
  registeredNames(): QueueName[] {
    return [...this.queues.keys()];
  }

  /** Atalho tipado para a DLQ, usada pelo `WorkerFactory`. */
  deadLetterQueue(): Queue {
    return this.get(QUEUE.deadLetter);
  }
}
