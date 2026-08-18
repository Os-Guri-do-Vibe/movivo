/**
 * `WorkerFactory` — criação padronizada de workers (US-1.7 / TASK-1.7.2).
 *
 * Todo worker de fila nasce por aqui, herdando: concorrência/lock/rate-limit de §6, o
 * backoff customizado da fila, log estruturado por job (com correlation id), o hook de
 * DLQ na falha terminal e o registro para drenagem graciosa no shutdown. As sprints
 * futuras só fornecem o processor (a lógica de negócio) — nunca reconfiguram isto.
 */
import { Inject, Injectable } from '@nestjs/common';
import { type ConnectionOptions, type Job, type Processor, Worker } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';

import { AppConfigService } from '../../core/config';
import {
  DEAD_LETTER_HANDLER,
  type DeadLetterHandler,
  isFinalFailure,
  toDeadLetterRecord,
} from './dlq.handler';
import {
  backoffDelay,
  buildBullConnection,
  bullPrefix,
  QUEUE_REGISTRY,
  type QueueName,
} from './jobs.config';
import { QueueManager } from './queue-manager.service';

@Injectable()
export class WorkerFactory {
  private readonly workers: Worker[] = [];

  constructor(
    private readonly config: AppConfigService,
    private readonly queues: QueueManager,
    @Inject(DEAD_LETTER_HANDLER) private readonly dlq: DeadLetterHandler,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WorkerFactory.name);
  }

  create<T = unknown>(name: QueueName, processor: Processor<T>): Worker<T> {
    const spec = QUEUE_REGISTRY[name];
    const worker = new Worker<T>(name, processor, {
      // Cast: `RedisOptions` do ioredis não tem a assinatura de índice que o `RedisOptions`
      // PRÓPRIO do bullmq 6.x exige — mesma opção de conexão em runtime, só divergência de
      // declaração de tipos entre os dois pacotes (achado 2026-08-18, migração do bullmq 6.x).
      connection: buildBullConnection(this.config) as ConnectionOptions,
      prefix: bullPrefix(this.config),
      concurrency: spec.concurrency,
      ...(spec.lockMs ? { lockDuration: spec.lockMs } : {}),
      ...(spec.rateLimit
        ? { limiter: { max: spec.rateLimit.max, duration: spec.rateLimit.durationMs } }
        : {}),
      settings: { backoffStrategy: (attemptsMade: number) => backoffDelay(name, attemptsMade) },
    });

    // Sem um listener de 'error', um erro da conexão (ex.: blip do Redis, ou o fecho da
    // conexão bloqueante no shutdown) vira unhandled rejection e derruba o processo.
    worker.on('error', (err) => {
      this.logger.warn({ queue: name, err: err.message }, 'erro de conexão do worker');
    });

    worker.on('completed', (job) => {
      this.logger.info(
        { queue: name, jobId: job.id, correlationId: correlationId(job) },
        'job concluído',
      );
    });

    worker.on('failed', (job, err) => {
      if (!job) return;
      this.logger.warn(
        { queue: name, jobId: job.id, attemptsMade: job.attemptsMade, err: err.message },
        'job falhou',
      );
      if (isFinalFailure(job)) {
        void this.deadLetter(name, job, err).catch((dlqErr: unknown) => {
          this.logger.error(
            { queue: name, jobId: job.id, err: dlqErr },
            'falha ao rotear para DLQ',
          );
        });
      }
    });

    this.workers.push(worker);
    return worker;
  }

  private async deadLetter(name: QueueName, job: Job, err: Error): Promise<void> {
    const record = toDeadLetterRecord(name, job, err.message);
    await this.queues.deadLetterQueue().add('dead-letter', record, { attempts: 1 });
    await this.dlq.handle(record);
  }

  /** Fecha os workers, drenando os jobs em voo antes de encerrar (SIGTERM). */
  async closeAll(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    this.workers.length = 0;
  }
}

function correlationId(job: Job): string | undefined {
  const value = (job.data as { correlationId?: unknown })?.correlationId;
  return typeof value === 'string' ? value : undefined;
}
