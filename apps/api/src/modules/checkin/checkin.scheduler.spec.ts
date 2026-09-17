import { PinoLogger } from 'nestjs-pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TenantDatabase } from '../../core/database/tenant-database.service';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { CheckinScheduler } from './checkin.scheduler';
import { CheckinService } from './checkin.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROTOCOL_ID = '22222222-2222-4222-8222-222222222222';

function makeSelectDistinctChain(eligible: unknown[]) {
  const chain = { from: () => chain, innerJoin: () => chain, where: async () => eligible };
  return chain;
}

function makeScan(eligible: unknown[]) {
  const db = {
    runAsSystem: vi.fn((callback: (value: unknown) => Promise<unknown>) =>
      callback({ selectDistinct: () => makeSelectDistinctChain(eligible) } as never),
    ),
  } as unknown as TenantDatabase;
  const createAndSend = vi.fn(async () => 'SENT' as const);
  const service = {
    weekNumber: vi.fn(() => 5),
    createAndSend,
    lastSentOrRespondedAt: vi.fn(async () => undefined),
  } as unknown as CheckinService;
  const logger = { setContext: vi.fn(), info: vi.fn() } as unknown as PinoLogger;
  const scheduler = new CheckinScheduler(
    {} as WorkerFactory,
    {} as QueueManager,
    db,
    service,
    logger,
  );
  return { scheduler, createAndSend, service };
}

afterEach(() => vi.useRealTimers());

describe('CheckinScheduler.scan', () => {
  it('envia domingo 18h no fuso local do aluno, com dedupe por titular e semana', async () => {
    const eligible = [
      {
        userId: USER_ID,
        name: 'Maria Silva',
        timezone: 'America/Sao_Paulo',
        protocolId: PROTOCOL_ID,
        createdAt: new Date('2026-07-01T12:00:00.000Z'),
        totalWeeks: 8,
      },
    ];
    const { scheduler, createAndSend } = makeScan(eligible);
    vi.spyOn(scheduler, 'enqueueNudgeIfDue').mockResolvedValue();

    // 2026-08-09 é domingo. 21:00 UTC == 18:00 em America/Sao_Paulo (UTC-3).
    const result = await scheduler.scan(new Date('2026-08-09T21:00:00.000Z'));

    expect(result).toEqual({ status: 'SCANNED', eligible: 1, sent: 1 });
    expect(createAndSend).toHaveBeenCalledWith(USER_ID, PROTOCOL_ID, 5, 'Maria');
    expect(scheduler.enqueueNudgeIfDue).toHaveBeenCalledWith(USER_ID);
  });

  it('nao envia fora do horario fixo (18h de domingo)', async () => {
    const eligible = [
      {
        userId: USER_ID,
        name: 'Maria Silva',
        timezone: 'America/Sao_Paulo',
        protocolId: PROTOCOL_ID,
        createdAt: new Date('2026-07-01T12:00:00.000Z'),
        totalWeeks: 8,
      },
    ];
    const { scheduler, createAndSend } = makeScan(eligible);
    vi.spyOn(scheduler, 'enqueueNudgeIfDue').mockResolvedValue();

    // 2026-08-09 é domingo, mas 19:00 local — não é 18:00.
    await scheduler.scan(new Date('2026-08-09T22:00:00.000Z'));
    expect(createAndSend).not.toHaveBeenCalled();
  });

  it('nao envia no horario certo se nao for domingo', async () => {
    const eligible = [
      {
        userId: USER_ID,
        name: 'Maria Silva',
        timezone: 'America/Sao_Paulo',
        protocolId: PROTOCOL_ID,
        createdAt: new Date('2026-07-01T12:00:00.000Z'),
        totalWeeks: 8,
      },
    ];
    const { scheduler, createAndSend } = makeScan(eligible);
    vi.spyOn(scheduler, 'enqueueNudgeIfDue').mockResolvedValue();

    // 2026-08-10 é segunda-feira, mesmo horário (18h local).
    await scheduler.scan(new Date('2026-08-10T21:00:00.000Z'));
    expect(createAndSend).not.toHaveBeenCalled();
  });
});

describe('CheckinScheduler reengajamento', () => {
  it('nao cria janela sem atividade anterior', async () => {
    const { scheduler, service } = makeScan([]);
    await scheduler.enqueueNudgeIfDue(USER_ID);
    expect(service.lastSentOrRespondedAt).toHaveBeenCalledWith(USER_ID);
  });

  it('nao enfileira nudge quando a atividade mais recente esta dentro de 14 dias', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T12:00:00.000Z'));
    const db = { runAsSystem: vi.fn() } as unknown as TenantDatabase;
    const service = {
      lastSentOrRespondedAt: vi.fn(async () => new Date('2026-07-31T12:00:00.000Z')),
    } as unknown as CheckinService;
    const enqueue = vi.fn(async () => 'job');
    const scheduler = new CheckinScheduler(
      {} as WorkerFactory,
      { enqueue } as unknown as QueueManager,
      db,
      service,
      { setContext: vi.fn(), info: vi.fn() } as unknown as PinoLogger,
    );
    await scheduler.enqueueNudgeIfDue(USER_ID);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('enfileira uma chave idempotente quando a atividade mais recente passou de 14 dias', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T12:00:00.000Z'));
    const windowStartedAt = new Date('2026-07-01T12:00:00.000Z');
    const db = { runAsSystem: vi.fn() } as unknown as TenantDatabase;
    const service = {
      lastSentOrRespondedAt: vi.fn(async () => windowStartedAt),
    } as unknown as CheckinService;
    const enqueue = vi.fn(async () => 'job');
    const scheduler = new CheckinScheduler(
      {} as WorkerFactory,
      { enqueue } as unknown as QueueManager,
      db,
      service,
      { setContext: vi.fn(), info: vi.fn() } as unknown as PinoLogger,
    );
    await scheduler.enqueueNudgeIfDue(USER_ID);
    expect(enqueue).toHaveBeenCalledWith(
      'checkin-weekly',
      'checkin-reengagement',
      expect.objectContaining({ kind: 'NUDGE', userId: USER_ID }),
      { jobId: `checkin-nudge-${USER_ID}-${windowStartedAt.getTime()}` },
    );
  });
});

describe('CheckinScheduler.onModuleInit', () => {
  it('registra o worker e o cron do scan em UTC, a cada minuto', async () => {
    const create = vi.fn();
    const upsertJobScheduler = vi.fn(async () => undefined);
    const workers = { create } as unknown as WorkerFactory;
    const queues = { get: vi.fn(() => ({ upsertJobScheduler })) } as unknown as QueueManager;
    const db = { runAsSystem: vi.fn() } as unknown as TenantDatabase;
    const scheduler = new CheckinScheduler(
      workers,
      queues,
      db,
      {} as CheckinService,
      { setContext: vi.fn(), info: vi.fn() } as unknown as PinoLogger,
    );

    await scheduler.onModuleInit();

    expect(create).toHaveBeenCalledWith('checkin-weekly', expect.any(Function));
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'weekly-checkin-scan',
      { pattern: '* * * * *', tz: 'UTC' },
      expect.any(Object),
    );
  });

  it('despacha SCAN e NUDGE pelo processor registrado', async () => {
    let processor: ((job: { data: Record<string, unknown> }) => Promise<unknown>) | undefined;
    const create = vi.fn((_queue, callback) => {
      processor = callback;
    });
    const workers = { create } as unknown as WorkerFactory;
    const queues = {
      get: vi.fn(() => ({ upsertJobScheduler: vi.fn(async () => undefined) })),
    } as unknown as QueueManager;
    const db = {
      runAsSystem: vi.fn((callback: (value: unknown) => Promise<unknown>) =>
        callback({ selectDistinct: () => makeSelectDistinctChain([]) } as never),
      ),
    } as unknown as TenantDatabase;
    const service = { weekNumber: vi.fn(() => 1) } as unknown as CheckinService;
    const scheduler = new CheckinScheduler(workers, queues, db, service, {
      setContext: vi.fn(),
      info: vi.fn(),
    } as unknown as PinoLogger);
    const scan = vi
      .spyOn(scheduler, 'scan')
      .mockResolvedValue({ status: 'SCANNED', eligible: 0, sent: 0 });

    await scheduler.onModuleInit();
    await processor?.({ data: { kind: 'SCAN' } });
    expect(scan).toHaveBeenCalledOnce();
  });
});

describe('CheckinScheduler nudge (envio)', () => {
  it('reenvia o check-in do protocolo ativo do aluno, marcado como NUDGE', async () => {
    let processor: ((job: { data: Record<string, unknown> }) => Promise<unknown>) | undefined;
    const create = vi.fn((_queue, callback) => {
      processor = callback;
    });
    const eligibleRow = [
      {
        userId: USER_ID,
        name: 'Maria Silva',
        protocolId: PROTOCOL_ID,
        createdAt: new Date('2026-07-01T12:00:00.000Z'),
        totalWeeks: 8,
      },
    ];
    const db = {
      runAsSystem: vi.fn((callback: (value: unknown) => Promise<unknown>) =>
        callback({
          select: () => ({
            from: () => ({
              innerJoin: () => ({
                innerJoin: () => ({ where: () => ({ limit: async () => eligibleRow }) }),
              }),
            }),
          }),
        } as never),
      ),
    } as unknown as TenantDatabase;
    const createAndSend = vi.fn(async () => 'SENT' as const);
    const service = { weekNumber: vi.fn(() => 3), createAndSend } as unknown as CheckinService;
    const scheduler = new CheckinScheduler(
      { create } as unknown as WorkerFactory,
      {
        get: vi.fn(() => ({ upsertJobScheduler: vi.fn(async () => undefined) })),
      } as unknown as QueueManager,
      db,
      service,
      { setContext: vi.fn(), info: vi.fn() } as unknown as PinoLogger,
    );
    await scheduler.onModuleInit();

    const data = { kind: 'NUDGE', userId: USER_ID, windowStartedAt: new Date().toISOString() };
    await expect(processor?.({ data })).resolves.toBe('SENT');
    expect(createAndSend).toHaveBeenCalledWith(USER_ID, PROTOCOL_ID, 3, 'Maria', 'NUDGE');
  });
});
