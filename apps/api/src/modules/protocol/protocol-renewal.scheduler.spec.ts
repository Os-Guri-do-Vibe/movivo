import { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

import { AppConfigService } from '../../core/config';
import { protocolRenewalSessions } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import type { ShortLinkService } from '../short-link/short-link.service';
import { ProtocolRenewalScheduler } from './protocol-renewal.scheduler';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROTOCOL_ID = '22222222-2222-4222-8222-222222222222';
const CONFIG = { whatsapp: { publicSiteUrl: 'https://movivo.app' } } as unknown as AppConfigService;
const LOGGER = { setContext: vi.fn(), info: vi.fn() } as unknown as PinoLogger;
// Código fixo: os testes de conteúdo da mensagem verificam a URL final composta em
// `/renovacao/<código>` — a geração do código em si tem teste próprio em
// `short-link.service.spec.ts`.
const SHORT_LINKS = { create: vi.fn(async () => 'fakeCode1') } as unknown as ShortLinkService;

function eligibleRow(
  over: Partial<{
    renewalSessionId: string | null;
    renewalStatus: string | null;
    renewalExpiresAt: Date | null;
  }> = {},
) {
  return {
    userId: USER_ID,
    protocolId: PROTOCOL_ID,
    name: 'Maria Silva',
    renewalSessionId: null,
    renewalStatus: null,
    renewalExpiresAt: null,
    ...over,
  };
}

function makeSelectChain(eligible: unknown[]) {
  const selectChain = {
    from: () => selectChain,
    innerJoin: () => selectChain,
    leftJoin: () => selectChain,
    where: async () => eligible,
  };
  return selectChain;
}

function makeInsertTx(created: { id: string } | undefined) {
  const onConflictDoNothing = vi.fn(() => ({ returning: async () => (created ? [created] : []) }));
  const values = vi.fn(() => ({ onConflictDoNothing }));
  const insert = vi.fn((table: unknown) =>
    table === protocolRenewalSessions ? { values } : { values: () => ({}) },
  );
  return { insert, values, onConflictDoNothing };
}

function makeUpdateTx(updated: { id: string } | undefined) {
  const where = vi.fn(() => ({ returning: async () => (updated ? [updated] : []) }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn((table: unknown) =>
    table === protocolRenewalSessions ? { set } : { set: () => ({ where: async () => [] }) },
  );
  return { update, set, where };
}

function makeScheduler(
  db: TenantDatabase,
  enqueue: (q: string, name: string, data: unknown, opts?: unknown) => Promise<unknown>,
) {
  return new ProtocolRenewalScheduler(
    {} as WorkerFactory,
    { enqueue } as unknown as QueueManager,
    db,
    CONFIG,
    SHORT_LINKS,
    LOGGER,
  );
}

describe('ProtocolRenewalScheduler.scan', () => {
  it('varre protocolos ACTIVE vencidos sem sessão nenhuma, cria a sessão e enfileira o convite', async () => {
    const eligible = [eligibleRow()];
    const selectChain = makeSelectChain(eligible);
    const { insert, values } = makeInsertTx({ id: 'renewal-1' });
    const db = {
      runAsSystem: vi.fn((callback: (tx: unknown) => Promise<unknown>) =>
        callback({ selectDistinct: () => selectChain, insert } as never),
      ),
    } as unknown as TenantDatabase;
    const enqueue = vi.fn((_q: string, _name: string, _data: unknown, _opts?: unknown) =>
      Promise.resolve('job'),
    );
    const scheduler = makeScheduler(db, enqueue);

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
        dedupeId: expect.stringContaining('renewal-invite-renewal-1-'),
        text: expect.stringContaining('Maria'),
      }),
      { jobId: expect.stringContaining('wa-renewal-invite-renewal-1-') },
    );
    const sentPayload = enqueue.mock.calls[0]?.[2] as { text: string };
    expect(sentPayload.text).toContain('https://movivo.app/renovacao/fakeCode1');
  });

  it('encurta o link do convite para /renovacao/<código>, sem expor o token cru (achado 2026-09-12)', async () => {
    const eligible = [eligibleRow()];
    const selectChain = makeSelectChain(eligible);
    const { insert } = makeInsertTx({ id: 'renewal-1' });
    const db = {
      runAsSystem: vi.fn((callback: (tx: unknown) => Promise<unknown>) =>
        callback({ selectDistinct: () => selectChain, insert } as never),
      ),
    } as unknown as TenantDatabase;
    const enqueue = vi.fn((_q: string, _name: string, _data: unknown, _opts?: unknown) =>
      Promise.resolve('job'),
    );
    const create = vi.fn(async () => 'xY7bQ2aB');
    const scheduler = new ProtocolRenewalScheduler(
      {} as WorkerFactory,
      { enqueue } as unknown as QueueManager,
      db,
      CONFIG,
      { create } as unknown as ShortLinkService,
      LOGGER,
    );

    await scheduler.scan();

    expect(create).toHaveBeenCalledWith(
      expect.stringContaining('https://movivo.app/mesociclo/'),
      expect.any(Date),
    );
    const sentPayload = enqueue.mock.calls[0]?.[2] as { text: string };
    expect(sentPayload.text).toContain('https://movivo.app/renovacao/xY7bQ2aB');
    expect(sentPayload.text).not.toContain('/mesociclo/');
  });

  it('idempotente na mesma passagem: se a sessão já existe (conflito no índice único), não enfileira de novo', async () => {
    const eligible = [eligibleRow()];
    const selectChain = makeSelectChain(eligible);
    const { insert } = makeInsertTx(undefined);
    const db = {
      runAsSystem: vi.fn((callback: (tx: unknown) => Promise<unknown>) =>
        callback({ selectDistinct: () => selectChain, insert } as never),
      ),
    } as unknown as TenantDatabase;
    const enqueue = vi.fn(async () => 'job');
    const scheduler = makeScheduler(db, enqueue);

    await expect(scheduler.scan()).resolves.toEqual({ status: 'SCANNED', created: 0 });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('sem elegíveis: não cria nem enfileira nada', async () => {
    const selectChain = makeSelectChain([]);
    const db = {
      runAsSystem: vi.fn((callback: (tx: unknown) => Promise<unknown>) =>
        callback({ selectDistinct: () => selectChain } as never),
      ),
    } as unknown as TenantDatabase;
    const enqueue = vi.fn(async () => 'job');
    const scheduler = makeScheduler(db, enqueue);

    await expect(scheduler.scan()).resolves.toEqual({ status: 'SCANNED', created: 0 });
    expect(enqueue).not.toHaveBeenCalled();
  });

  // ADR-008 §8.1 — bug de ciclo de vida: antes desta correção, uma sessão expirada
  // travava `onConflictDoNothing` para sempre e o titular nunca recebia um novo convite.
  describe('reconvite (sessão anterior expirada)', () => {
    it('sessão EXPIRED: reconvida sobre a MESMA linha (update, não insert) e enfileira de novo', async () => {
      const eligible = [
        eligibleRow({
          renewalSessionId: 'renewal-1',
          renewalStatus: 'EXPIRED',
          renewalExpiresAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        }),
      ];
      const selectChain = makeSelectChain(eligible);
      const { update, set, where } = makeUpdateTx({ id: 'renewal-1' });
      const db = {
        runAsSystem: vi.fn((callback: (tx: unknown) => Promise<unknown>) =>
          callback({ selectDistinct: () => selectChain, update } as never),
        ),
      } as unknown as TenantDatabase;
      const enqueue = vi.fn(async () => 'job');
      const scheduler = makeScheduler(db, enqueue);

      await expect(scheduler.scan()).resolves.toEqual({ status: 'SCANNED', created: 1 });
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'IN_PROGRESS', token: expect.any(String) }),
      );
      expect(where).toHaveBeenCalledOnce();
      expect(enqueue).toHaveBeenCalledOnce();
    });

    it('IN_PROGRESS mas com TTL já vencido (expiração ainda não marcada no banco): reconvida do mesmo jeito', async () => {
      const eligible = [
        eligibleRow({
          renewalSessionId: 'renewal-1',
          renewalStatus: 'IN_PROGRESS',
          renewalExpiresAt: new Date(Date.now() - 60 * 60 * 1000), // venceu há 1h
        }),
      ];
      const selectChain = makeSelectChain(eligible);
      const { update } = makeUpdateTx({ id: 'renewal-1' });
      const db = {
        runAsSystem: vi.fn((callback: (tx: unknown) => Promise<unknown>) =>
          callback({ selectDistinct: () => selectChain, update } as never),
        ),
      } as unknown as TenantDatabase;
      const enqueue = vi.fn(async () => 'job');
      const scheduler = makeScheduler(db, enqueue);

      await expect(scheduler.scan()).resolves.toEqual({ status: 'SCANNED', created: 1 });
      expect(enqueue).toHaveBeenCalledOnce();
    });

    it('IN_PROGRESS dentro do TTL: não reconvida (aluno ainda pode estar respondendo)', async () => {
      const eligible = [
        eligibleRow({
          renewalSessionId: 'renewal-1',
          renewalStatus: 'IN_PROGRESS',
          renewalExpiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        }),
      ];
      const selectChain = makeSelectChain(eligible);
      const db = {
        runAsSystem: vi.fn((callback: (tx: unknown) => Promise<unknown>) =>
          callback({ selectDistinct: () => selectChain } as never),
        ),
      } as unknown as TenantDatabase;
      const enqueue = vi.fn(async () => 'job');
      const scheduler = makeScheduler(db, enqueue);

      await expect(scheduler.scan()).resolves.toEqual({ status: 'SCANNED', created: 0 });
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('SUBMITTED: não reconvida (já respondeu — o protocolo novo é que está pendente)', async () => {
      const eligible = [
        eligibleRow({
          renewalSessionId: 'renewal-1',
          renewalStatus: 'SUBMITTED',
          renewalExpiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        }),
      ];
      const selectChain = makeSelectChain(eligible);
      const db = {
        runAsSystem: vi.fn((callback: (tx: unknown) => Promise<unknown>) =>
          callback({ selectDistinct: () => selectChain } as never),
        ),
      } as unknown as TenantDatabase;
      const enqueue = vi.fn(async () => 'job');
      const scheduler = makeScheduler(db, enqueue);

      await expect(scheduler.scan()).resolves.toEqual({ status: 'SCANNED', created: 0 });
      expect(enqueue).not.toHaveBeenCalled();
    });
  });
});

describe('ProtocolRenewalScheduler.onModuleInit', () => {
  it('registra o worker e o cron diário em America/Sao_Paulo', async () => {
    const create = vi.fn();
    const upsertJobScheduler = vi.fn(async () => undefined);
    const workers = { create } as unknown as WorkerFactory;
    const queues = { get: vi.fn(() => ({ upsertJobScheduler })) } as unknown as QueueManager;
    const db = { runAsSystem: vi.fn() } as unknown as TenantDatabase;
    const scheduler = new ProtocolRenewalScheduler(
      workers,
      queues,
      db,
      CONFIG,
      SHORT_LINKS,
      LOGGER,
    );

    await scheduler.onModuleInit();

    expect(create).toHaveBeenCalledWith('protocol-renewal-scan', expect.any(Function));
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'protocol-renewal-scan',
      { pattern: '0 9 * * *', tz: 'America/Sao_Paulo' },
      expect.any(Object),
    );
  });
});
