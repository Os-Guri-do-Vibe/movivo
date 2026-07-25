import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QUEUE, QUEUE_REGISTRY } from './jobs.config';
import { QueueManager } from './queue-manager.service';
import { SanityWorker } from './sanity.worker';
import { WorkerFactory } from './worker.factory';

interface FakeQueue {
  name: string;
  opts: unknown;
  add: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}
interface FakeWorker {
  name: string;
  processor: unknown;
  opts: unknown;
  close: ReturnType<typeof vi.fn>;
  emit(event: string, ...args: unknown[]): void;
}

const { queueInstances, workerInstances } = vi.hoisted(() => ({
  queueInstances: [] as FakeQueue[],
  workerInstances: [] as FakeWorker[],
}));

// Definido DENTRO da factory: `vi.mock` é hoisted acima das declarações do arquivo.
vi.mock('../../core/redis', () => ({
  buildRedisOptions: () => ({ sentinels: [{ host: 'h', port: 1 }], maxRetriesPerRequest: 3 }),
}));

vi.mock('bullmq', () => {
  class FakeQueueImpl {
    add = vi.fn(async (name: string) => ({ id: `id-${name}` }));
    close = vi.fn(async () => undefined);
    constructor(
      public name: string,
      public opts: unknown,
    ) {
      queueInstances.push(this);
    }
  }
  class FakeWorkerImpl {
    private readonly handlers = new Map<string, (...args: unknown[]) => void>();
    close = vi.fn(async () => undefined);
    on = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      this.handlers.set(event, cb);
      return this;
    });
    emit(event: string, ...args: unknown[]): void {
      const cb = this.handlers.get(event);
      if (!cb) throw new Error(`sem handler para ${event}`);
      cb(...args);
    }
    constructor(
      public name: string,
      public processor: unknown,
      public opts: unknown,
    ) {
      workerInstances.push(this);
    }
  }
  return { Queue: FakeQueueImpl, Worker: FakeWorkerImpl };
});

function only<T>(arr: readonly T[]): T {
  const [first] = arr;
  if (first === undefined) throw new Error('array vazio');
  return first;
}

const config = { redis: { keyPrefix: 'movivo' } } as never;
const logger = () => ({ setContext: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

beforeEach(() => {
  queueInstances.length = 0;
  workerInstances.length = 0;
});

describe('QueueManager', () => {
  it('registra uma fila por entrada do registry no onModuleInit', () => {
    const qm = new QueueManager(config, logger() as never);
    qm.onModuleInit();
    expect(qm.registeredNames().sort()).toEqual(Object.keys(QUEUE_REGISTRY).sort());
    expect((only(queueInstances).opts as { prefix: string }).prefix).toBe('movivo:bull');
  });

  it('enqueue aplica os defaults da fila e retorna o id', async () => {
    const qm = new QueueManager(config, logger() as never);
    qm.onModuleInit();
    const id = await qm.enqueue(QUEUE.sanity, 'echo', { echo: 'hi' });
    expect(id).toBe('id-echo');
    const q = queueInstances.find((x) => x.name === QUEUE.sanity);
    expect(q?.add).toHaveBeenCalledWith(
      'echo',
      { echo: 'hi' },
      expect.objectContaining({ attempts: 3 }),
    );
  });

  it('get lança para fila não registrada', () => {
    const qm = new QueueManager(config, logger() as never);
    qm.onModuleInit();
    expect(() => qm.get('nope' as never)).toThrow(/não registrada/);
  });

  it('closeAll fecha todas as filas', async () => {
    const qm = new QueueManager(config, logger() as never);
    qm.onModuleInit();
    await qm.closeAll();
    expect(queueInstances.every((q) => q.close.mock.calls.length === 1)).toBe(true);
    expect(qm.registeredNames()).toHaveLength(0);
  });
});

describe('WorkerFactory', () => {
  function make() {
    const qm = new QueueManager(config, logger() as never);
    qm.onModuleInit();
    const dlq = { handle: vi.fn(async () => undefined) };
    const wf = new WorkerFactory(config, qm, dlq as never, logger() as never);
    return { qm, dlq, wf };
  }

  it('cria worker com concorrência/lock/rate da fila', () => {
    const { wf } = make();
    wf.create(QUEUE.aiResponse, async () => undefined);
    const opts = only(workerInstances).opts as { concurrency: number; limiter: unknown };
    expect(opts.concurrency).toBe(QUEUE_REGISTRY[QUEUE.aiResponse].concurrency);
    expect(opts.limiter).toEqual({ max: 80, duration: 1_000 });
  });

  it('roteia para DLQ e chama o hook na falha terminal', async () => {
    const { qm, dlq, wf } = make();
    wf.create(QUEUE.sanity, async () => undefined);
    const dlqQueue = qm.deadLetterQueue() as unknown as FakeQueue;
    const job = { id: 'j1', name: 'sanity', attemptsMade: 3, opts: { attempts: 3 }, data: {} };
    only(workerInstances).emit('failed', job, new Error('boom'));
    await new Promise((r) => setImmediate(r));
    expect(dlqQueue.add).toHaveBeenCalledWith(
      'dead-letter',
      expect.objectContaining({ jobId: 'j1' }),
      {
        attempts: 1,
      },
    );
    expect(dlq.handle).toHaveBeenCalledOnce();
  });

  it('NÃO roteia para DLQ enquanto há retries restantes', async () => {
    const { dlq, wf } = make();
    wf.create(QUEUE.sanity, async () => undefined);
    only(workerInstances).emit(
      'failed',
      { id: 'j1', attemptsMade: 1, opts: { attempts: 3 }, data: {} },
      new Error('x'),
    );
    await new Promise((r) => setImmediate(r));
    expect(dlq.handle).not.toHaveBeenCalled();
  });

  it('completed loga sem quebrar', () => {
    const { wf } = make();
    wf.create(QUEUE.sanity, async () => undefined);
    expect(() => only(workerInstances).emit('completed', { id: 'j1', data: {} })).not.toThrow();
  });

  it('erro de conexão do worker é capturado (não vira unhandled rejection)', () => {
    const { wf } = make();
    wf.create(QUEUE.sanity, async () => undefined);
    expect(() => only(workerInstances).emit('error', new Error('conn closed'))).not.toThrow();
  });

  it('failed sem job (undefined) é ignorado', () => {
    const { dlq, wf } = make();
    wf.create(QUEUE.sanity, async () => undefined);
    expect(() => only(workerInstances).emit('failed', undefined, new Error('x'))).not.toThrow();
    expect(dlq.handle).not.toHaveBeenCalled();
  });

  it('closeAll fecha os workers (drenagem)', async () => {
    const { wf } = make();
    wf.create(QUEUE.sanity, async () => undefined);
    await wf.closeAll();
    expect(only(workerInstances).close).toHaveBeenCalledOnce();
  });
});

describe('SanityWorker', () => {
  it('registra o processor: echo no feliz, throw quando fail', async () => {
    const qm = new QueueManager(config, logger() as never);
    qm.onModuleInit();
    const wf = new WorkerFactory(config, qm, { handle: vi.fn() } as never, logger() as never);
    new SanityWorker(wf).onModuleInit();
    const processor = only(workerInstances).processor as (job: {
      data: unknown;
    }) => Promise<unknown>;
    await expect(processor({ data: { echo: 'hi' } })).resolves.toEqual({ echo: 'hi' });
    await expect(processor({ data: { fail: true } })).rejects.toThrow(/falhar/);
  });
});
