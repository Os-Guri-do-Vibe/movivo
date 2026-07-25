/**
 * Integração da fundação BullMQ (US-1.7 / TASK-1.7.3) contra o stack Docker (US-0.2):
 * Redis via Sentinel (26379). Pré-requisito: `pnpm run infra:up`.
 *
 * Prova, com I/O real:
 *   · o AppModule boota com o JobsModule registrado e o worker de sanidade ligado;
 *   · enqueue→process→complete (echo);
 *   · job que falha respeita retry (attemptsMade cresce) e, na falha terminal, cai na
 *     dead-letter queue e dispara o hook;
 *   · workers/filas fecham limpo no afterAll (senão o fork único fica vivo).
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type Job } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { QUEUE, resolveJobOptions } from '../src/modules/jobs/jobs.config';
import { QueueManager } from '../src/modules/jobs/queue-manager.service';

let app: INestApplication;
let queues: QueueManager;

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 15_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new Error('timeout aguardando condição');
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  queues = app.get(QueueManager);
  // Limpa resíduo de execuções anteriores para o assert de contagem da DLQ ser estável.
  await queues.deadLetterQueue().obliterate({ force: true });
  await queues.get(QUEUE.sanity).obliterate({ force: true });
});

afterAll(async () => {
  await app?.close(); // dispara onApplicationShutdown → drena workers e fecha filas
});

describe('BullMQ — fundação de filas', () => {
  it('registra as 5 filas de §6 + sanity + dead-letter', () => {
    expect(queues.registeredNames()).toEqual(
      expect.arrayContaining([
        QUEUE.protocolGeneration,
        QUEUE.aiResponse,
        QUEUE.whatsappOutbound,
        QUEUE.checkinWeekly,
        QUEUE.conversionSequence,
        QUEUE.sanity,
        QUEUE.deadLetter,
      ]),
    );
  });

  it('processa um job de sanidade (enqueue→process→complete)', async () => {
    const job = await queues
      .get(QUEUE.sanity)
      .add('echo', { echo: 'pong' }, resolveJobOptions(QUEUE.sanity));
    const jobId = job.id ?? '';

    await waitFor(async () => {
      const fresh = (await queues.get(QUEUE.sanity).getJob(jobId)) as Job | undefined;
      return (await fresh?.getState()) === 'completed' ? true : undefined;
    });
    // Re-busca após confirmar o estado: getState() e o snapshot do getJob são queries
    // distintas; sem re-buscar, returnvalue pode vir do snapshot anterior à conclusão.
    const done = (await queues.get(QUEUE.sanity).getJob(jobId)) as Job | undefined;
    expect(done?.returnvalue).toEqual({ echo: 'pong' });
  });

  it('respeita retry/backoff e roteia a falha terminal para a DLQ', async () => {
    const job = await queues
      .get(QUEUE.sanity)
      .add(
        'fail',
        { fail: true, correlationId: 'int-1' },
        { ...resolveJobOptions(QUEUE.sanity), attempts: 2 },
      );
    const jobId = job.id ?? '';

    // Falha terminal: attemptsMade chega a 2 (todas as tentativas consumidas).
    await waitFor(async () => {
      const fresh = (await queues.get(QUEUE.sanity).getJob(jobId)) as Job | undefined;
      return (await fresh?.getState()) === 'failed' ? true : undefined;
    });
    const failed = (await queues.get(QUEUE.sanity).getJob(jobId)) as Job | undefined;
    expect(failed?.attemptsMade).toBe(2);

    // O record caiu na dead-letter queue (o mesmo caminho que chama o hook de DLQ).
    const dlqJob = await waitFor(async () => {
      const [waiting] = await queues.deadLetterQueue().getJobs(['wait', 'waiting'], 0, 10);
      return waiting;
    });
    expect((dlqJob.data as { jobId: string }).jobId).toBe(job.id);
    expect((dlqJob.data as { correlationId: string }).correlationId).toBe('int-1');
  });
});
