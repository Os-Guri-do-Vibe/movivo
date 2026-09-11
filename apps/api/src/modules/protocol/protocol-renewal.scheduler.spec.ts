import { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

import { AppConfigService } from '../../core/config';
import { protocolRenewalSessions } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { ProtocolRenewalScheduler } from './protocol-renewal.scheduler';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROTOCOL_ID = '22222222-2222-4222-8222-222222222222';
const CONFIG = { whatsapp: { publicSiteUrl: 'https://movivo.app' } } as unknown as AppConfigService;
const LOGGER = { setContext: vi.fn(), info: vi.fn() } as unknown as PinoLogger;

function makeInsertTx(created: { id: string } | undefined) {
  const onConflictDoNothing = vi.fn(() => ({ returning: async () => (created ? [created] : []) }));
  const values = vi.fn(() => ({ onConflictDoNothing }));
  const insert = vi.fn((table: unknown) =>
    table === protocolRenewalSessions ? { values } : { values: () => ({}) },
  );
  return { insert, values, onConflictDoNothing };
}

describe('ProtocolRenewalScheduler.scan', () => {
  it('varre protocolos ACTIVE vencidos, cria a sessão de renovação e enfileira o convite', async () => {
    const eligible = [{ userId: USER_ID, protocolId: PROTOCOL_ID, name: 'Maria Silva' }];
    const selectChain = {
      from: () => selectChain,
      innerJoin: () => selectChain,
      where: async () => eligible,
    };
    const { insert, values } = makeInsertTx({ id: 'renewal-1' });
    const db = {
      runAsSystem: vi.fn((callback: (tx: unknown) => Promise<unknown>) =>
        callback({ selectDistinct: () => selectChain, insert } as never),
      ),
    } as unknown as TenantDatabase;
    const enqueue = vi.fn((_q: string, _name: string, _data: unknown, _opts?: unknown) =>
      Promise.resolve('job'),
    );
    const scheduler = new ProtocolRenewalScheduler(
      {} as WorkerFactory,
      { enqueue } as unknown as QueueManager,
      db,
      CONFIG,
      LOGGER,
    );

    await expect(scheduler.scan()).resolves.toEqual({ status: 'SCANNED', created: 1 });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, previousProtocolId: PROTOCOL_ID }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'mesocycle-renewal-invite',
      expect.objectContaining({
        userId: USER_ID,
        type: 'MESOCYCLE_RENEWAL_INVITE',
        dedupeId: 'renewal-invite-renewal-1',
        text: expect.stringContaining('Maria'),
      }),
      { jobId: 'wa-renewal-invite-renewal-1' },
    );
    const sentPayload = enqueue.mock.calls[0]?.[2] as { text: string };
    expect(sentPayload.text).toContain('https://movivo.app/mesociclo/');
  });

  it('idempotente: se a sessão já existe (conflito no índice único), não enfileira de novo', async () => {
    const eligible = [{ userId: USER_ID, protocolId: PROTOCOL_ID, name: 'Maria Silva' }];
    const selectChain = {
      from: () => selectChain,
      innerJoin: () => selectChain,
      where: async () => eligible,
    };
    const { insert } = makeInsertTx(undefined);
    const db = {
      runAsSystem: vi.fn((callback: (tx: unknown) => Promise<unknown>) =>
        callback({ selectDistinct: () => selectChain, insert } as never),
      ),
    } as unknown as TenantDatabase;
    const enqueue = vi.fn(async () => 'job');
    const scheduler = new ProtocolRenewalScheduler(
      {} as WorkerFactory,
      { enqueue } as unknown as QueueManager,
      db,
      CONFIG,
      LOGGER,
    );

    await expect(scheduler.scan()).resolves.toEqual({ status: 'SCANNED', created: 0 });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('sem elegíveis: não cria nem enfileira nada', async () => {
    const selectChain = {
      from: () => selectChain,
      innerJoin: () => selectChain,
      where: async () => [],
    };
    const db = {
      runAsSystem: vi.fn((callback: (tx: unknown) => Promise<unknown>) =>
        callback({ selectDistinct: () => selectChain } as never),
      ),
    } as unknown as TenantDatabase;
    const enqueue = vi.fn(async () => 'job');
    const scheduler = new ProtocolRenewalScheduler(
      {} as WorkerFactory,
      { enqueue } as unknown as QueueManager,
      db,
      CONFIG,
      LOGGER,
    );

    await expect(scheduler.scan()).resolves.toEqual({ status: 'SCANNED', created: 0 });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('ProtocolRenewalScheduler.onModuleInit', () => {
  it('registra o worker e o cron diário em America/Sao_Paulo', async () => {
    const create = vi.fn();
    const upsertJobScheduler = vi.fn(async () => undefined);
    const workers = { create } as unknown as WorkerFactory;
    const queues = { get: vi.fn(() => ({ upsertJobScheduler })) } as unknown as QueueManager;
    const db = { runAsSystem: vi.fn() } as unknown as TenantDatabase;
    const scheduler = new ProtocolRenewalScheduler(workers, queues, db, CONFIG, LOGGER);

    await scheduler.onModuleInit();

    expect(create).toHaveBeenCalledWith('protocol-renewal-scan', expect.any(Function));
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'protocol-renewal-scan',
      { pattern: '0 9 * * *', tz: 'America/Sao_Paulo' },
      expect.any(Object),
    );
  });
});
