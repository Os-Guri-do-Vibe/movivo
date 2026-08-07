import { PinoLogger } from 'nestjs-pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TenantDatabase } from '../../core/database/tenant-database.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { CheckinScheduler } from './checkin.scheduler';
import { CheckinService } from './checkin.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-08-03T12:00:00.000Z');

function makeScheduler(latest: { sentAt: Date | null; respondedAt: Date | null } | undefined) {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => (latest ? [latest] : []),
  };
  const tx = { select: () => chain } as never;
  const db = {
    runAsSystem: vi.fn((callback: (value: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as TenantDatabase;
  const enqueue = vi.fn(async () => 'job');
  const queues = { enqueue } as unknown as QueueManager;
  const logger = { setContext: vi.fn(), info: vi.fn() } as unknown as PinoLogger;
  const scheduler = new CheckinScheduler(
    {} as WorkerFactory,
    queues,
    db,
    { hasActiveForUser: vi.fn(async () => true) } as unknown as HealthConsentService,
    {} as CheckinService,
    logger,
  );
  return { scheduler, enqueue };
}

afterEach(() => vi.useRealTimers());

describe('CheckinScheduler reengagement', () => {
  it('nao cria janela sem atividade anterior', async () => {
    const { scheduler, enqueue } = makeScheduler(undefined);
    await scheduler.enqueueNudgeIfDue(USER_ID);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('nao usa check-in antigo quando o mais recente ainda esta dentro de 14 dias', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { scheduler, enqueue } = makeScheduler({
      sentAt: new Date('2026-07-30T12:00:00.000Z'),
      respondedAt: new Date('2026-07-31T12:00:00.000Z'),
    });
    await scheduler.enqueueNudgeIfDue(USER_ID);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('enfileira uma chave idempotente quando a atividade mais recente passou de 14 dias', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const windowStartedAt = new Date('2026-07-01T12:00:00.000Z');
    const { scheduler, enqueue } = makeScheduler({ sentAt: windowStartedAt, respondedAt: null });
    await scheduler.enqueueNudgeIfDue(USER_ID);
    expect(enqueue).toHaveBeenCalledWith(
      'checkin-weekly',
      'checkin-reengagement',
      expect.objectContaining({ kind: 'NUDGE', userId: USER_ID }),
      { jobId: `checkin-nudge-${USER_ID}-${windowStartedAt.getTime()}` },
    );
  });
});

describe('CheckinScheduler processamento', () => {
  it('registra scheduler em America/Sao_Paulo e despacha SCAN e SEND', async () => {
    let processor: ((job: { data: Record<string, unknown> }) => Promise<unknown>) | undefined;
    const create = vi.fn((_queue, callback) => {
      processor = callback;
    });
    const upsertJobScheduler = vi.fn(async () => undefined);
    const workers = { create } as unknown as WorkerFactory;
    const queues = {
      get: vi.fn(() => ({ upsertJobScheduler })),
      enqueue: vi.fn(async () => 'job'),
    } as unknown as QueueManager;
    const createAndSend = vi.fn(async () => 'SENT');
    const service = { createAndSend, weekNumber: vi.fn(() => 1) } as unknown as CheckinService;
    const db = { runAsSystem: vi.fn() } as unknown as TenantDatabase;
    const logger = { setContext: vi.fn(), info: vi.fn() } as unknown as PinoLogger;
    const scheduler = new CheckinScheduler(
      workers,
      queues,
      db,
      { hasActiveForUser: vi.fn(async () => true) } as unknown as HealthConsentService,
      service,
      logger,
    );
    const scan = vi.spyOn(scheduler, 'scan').mockResolvedValue({ status: 'SCANNED', eligible: 0 });

    await scheduler.onModuleInit();
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'weekly-checkin-scan',
      { pattern: '0 8 * * 1', tz: 'America/Sao_Paulo' },
      expect.any(Object),
    );
    await processor?.({ data: { kind: 'SCAN' } });
    await processor?.({
      data: { kind: 'SEND', userId: USER_ID, protocolId: 'p', weekNumber: 2 },
    });
    expect(scan).toHaveBeenCalledOnce();
    expect(createAndSend).toHaveBeenCalledWith(USER_ID, 'p', 2);
  });

  it('varre elegiveis, distribui atraso deterministico e avalia reengajamento', async () => {
    const eligible = [
      {
        userId: USER_ID,
        protocolId: '22222222-2222-4222-8222-222222222222',
        createdAt: new Date('2026-07-01T12:00:00.000Z'),
        totalWeeks: 8,
      },
    ];
    const selectDistinct = () => {
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        where: async () => eligible,
      };
      return chain;
    };
    const db = {
      runAsSystem: vi.fn((callback: (value: unknown) => Promise<unknown>) =>
        callback({ selectDistinct } as never),
      ),
    } as unknown as TenantDatabase;
    const enqueue = vi.fn(async () => 'job');
    const service = { weekNumber: vi.fn(() => 5) } as unknown as CheckinService;
    const logger = { setContext: vi.fn(), info: vi.fn() } as unknown as PinoLogger;
    const scheduler = new CheckinScheduler(
      {} as WorkerFactory,
      { enqueue } as unknown as QueueManager,
      db,
      { hasActiveForUser: vi.fn(async () => true) } as unknown as HealthConsentService,
      service,
      logger,
    );
    vi.spyOn(scheduler, 'enqueueNudgeIfDue').mockResolvedValue();

    await expect(scheduler.scan()).resolves.toEqual({ status: 'SCANNED', eligible: 1 });
    expect(enqueue).toHaveBeenCalledWith(
      'checkin-weekly',
      'weekly-checkin-send',
      expect.objectContaining({ kind: 'SEND', weekNumber: 5 }),
      expect.objectContaining({ delay: expect.any(Number) }),
    );
    expect(scheduler.enqueueNudgeIfDue).toHaveBeenCalledWith(USER_ID);
  });

  it('envia nudge uma unica vez e retorna EXISTS no conflito', async () => {
    const createdId = '55555555-5555-4555-8555-555555555555';
    let processor: ((job: { data: Record<string, unknown> }) => Promise<unknown>) | undefined;
    const create = vi.fn((_queue, callback) => {
      processor = callback;
    });
    const returning = vi
      .fn()
      .mockResolvedValueOnce([{ id: createdId }])
      .mockResolvedValueOnce([]);
    const updateWhere = vi.fn(async () => []);
    const tx = {
      insert: () => ({
        values: () => ({ onConflictDoNothing: () => ({ returning }) }),
      }),
      update: () => ({ set: () => ({ where: updateWhere }) }),
    } as never;
    const db = {
      runAsSystem: vi.fn((callback: (value: unknown) => Promise<unknown>) => callback(tx)),
    } as unknown as TenantDatabase;
    const enqueue = vi.fn(async () => 'job');
    const queues = {
      get: () => ({ upsertJobScheduler: vi.fn(async () => undefined) }),
      enqueue,
    } as unknown as QueueManager;
    const scheduler = new CheckinScheduler(
      { create } as unknown as WorkerFactory,
      queues,
      db,
      { hasActiveForUser: vi.fn(async () => true) } as unknown as HealthConsentService,
      {} as CheckinService,
      { setContext: vi.fn(), info: vi.fn() } as unknown as PinoLogger,
    );
    await scheduler.onModuleInit();
    const data = { kind: 'NUDGE', userId: USER_ID, windowStartedAt: NOW.toISOString() };
    await expect(processor?.({ data })).resolves.toBe('SENT');
    await expect(processor?.({ data })).resolves.toBe('EXISTS');
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'checkin-reengagement',
      expect.objectContaining({ type: 'REENGAGEMENT', dedupeId: createdId }),
      { jobId: `wa-nudge-${createdId}` },
    );
    expect(updateWhere).toHaveBeenCalledOnce();
  });
});
