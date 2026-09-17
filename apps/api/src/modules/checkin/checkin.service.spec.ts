import {
  ForbiddenException,
  GoneException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../../core/config';
import type { HealthCipherService } from '../../core/database/health-cipher.service';
import type { HealthConsentService } from '../../core/database/health-consent.service';
import { users } from '../../core/database/schema';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import type { QueueManager } from '../jobs/queue-manager.service';
import type { ShortLinkService } from '../short-link/short-link.service';
import { CheckinService } from './checkin.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROTOCOL_ID = '22222222-2222-4222-8222-222222222222';
const CHECKIN_ID = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'a'.repeat(64);

const CONFIG = {
  whatsapp: { publicSiteUrl: 'https://movivo.test' },
} as unknown as AppConfigService;

function makeDeps(opts: { hasConsent?: boolean } = {}) {
  const enqueue = vi.fn(async () => 'job');
  const queues = { enqueue } as unknown as QueueManager;
  const queueEvents = { emit: vi.fn() } as unknown as DashboardQueueEventsService;
  const shorten = vi.fn(async () => 'aB3xK9pQ');
  const shortLinks = { create: shorten } as unknown as ShortLinkService;
  const cipher = {
    encryptHealth: vi.fn(async (s: string) => Buffer.from(s)),
    decryptHealth: vi.fn(async (b: Buffer) => b.toString()),
  } as unknown as HealthCipherService;
  const healthConsent = {
    hasActiveForUser: vi.fn(async () => opts.hasConsent ?? true),
  } as unknown as HealthConsentService;
  const logger = { setContext: vi.fn(), info: vi.fn() } as unknown as PinoLogger;
  return { enqueue, queues, queueEvents, shorten, shortLinks, cipher, healthConsent, logger };
}

describe('CheckinService.createAndSend', () => {
  it('cria o check-in, encurta o link e enfileira o convite', async () => {
    const deps = makeDeps();
    const insertReturning = vi.fn(async () => [{ id: CHECKIN_ID }]);
    const tx = {
      insert: () => ({
        values: () => ({ onConflictDoNothing: () => ({ returning: insertReturning }) }),
      }),
      update: () => ({ set: () => ({ where: async () => [] }) }),
    } as never;
    const db = {
      runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
    } as unknown as TenantDatabase;
    const service = new CheckinService(
      db,
      CONFIG,
      deps.cipher,
      deps.healthConsent,
      deps.queues,
      deps.queueEvents,
      deps.shortLinks,
      deps.logger,
    );

    await expect(service.createAndSend(USER_ID, PROTOCOL_ID, 3, 'Maria')).resolves.toBe('SENT');

    expect(deps.shorten).toHaveBeenCalledWith(
      expect.stringContaining('/checkin-semanal/'),
      expect.any(Date),
    );
    expect(deps.enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'checkin-message',
      expect.objectContaining({
        userId: USER_ID,
        type: 'CHECKIN_MESSAGE',
        text: expect.stringContaining('https://movivo.test/semana/aB3xK9pQ'),
      }),
      expect.any(Object),
    );
  });

  it('devolve NO_CONSENT sem gravar nada quando o consentimento de saude nao esta ativo', async () => {
    const deps = makeDeps({ hasConsent: false });
    const db = { runAsSystem: vi.fn() } as unknown as TenantDatabase;
    const service = new CheckinService(
      db,
      CONFIG,
      deps.cipher,
      deps.healthConsent,
      deps.queues,
      deps.queueEvents,
      deps.shortLinks,
      deps.logger,
    );

    await expect(service.createAndSend(USER_ID, PROTOCOL_ID, 3, 'Maria')).resolves.toBe(
      'NO_CONSENT',
    );
    expect(db.runAsSystem).not.toHaveBeenCalled();
  });

  it('reenvia com token novo (NUDGE) quando o check-in da semana ja existe e segue PENDING', async () => {
    const deps = makeDeps();
    const existingSelect = vi.fn(async () => [{ id: CHECKIN_ID, status: 'PENDING' }]);
    const updateSet = vi.fn(() => ({ where: async () => [] }));
    const tx = {
      insert: () => ({
        values: () => ({ onConflictDoNothing: () => ({ returning: async () => [] }) }),
      }),
      select: () => ({ from: () => ({ where: () => ({ limit: existingSelect }) }) }),
      update: () => ({ set: updateSet }),
    } as never;
    const db = {
      runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
    } as unknown as TenantDatabase;
    const service = new CheckinService(
      db,
      CONFIG,
      deps.cipher,
      deps.healthConsent,
      deps.queues,
      deps.queueEvents,
      deps.shortLinks,
      deps.logger,
    );

    await expect(service.createAndSend(USER_ID, PROTOCOL_ID, 3, 'Maria', 'NUDGE')).resolves.toBe(
      'SENT',
    );
    // Token novo => update do token/expiresAt aconteceu antes do envio.
    expect(updateSet).toHaveBeenCalled();
    expect(deps.enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'checkin-message',
      expect.objectContaining({ text: expect.not.stringContaining('mais uma semana') }),
      expect.any(Object),
    );
  });

  it('devolve EXISTS quando o check-in da semana ja foi enviado e nao esta mais PENDING', async () => {
    const deps = makeDeps();
    const tx = {
      insert: () => ({
        values: () => ({ onConflictDoNothing: () => ({ returning: async () => [] }) }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [{ id: CHECKIN_ID, status: 'SUBMITTED' }] }),
        }),
      }),
    } as never;
    const db = {
      runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
    } as unknown as TenantDatabase;
    const service = new CheckinService(
      db,
      CONFIG,
      deps.cipher,
      deps.healthConsent,
      deps.queues,
      deps.queueEvents,
      deps.shortLinks,
      deps.logger,
    );

    await expect(service.createAndSend(USER_ID, PROTOCOL_ID, 3, 'Maria')).resolves.toBe('EXISTS');
    expect(deps.enqueue).not.toHaveBeenCalled();
  });
});

function makeSessionTx(
  row: Record<string, unknown> | undefined,
  selfRow?: { name: string | null },
) {
  let table: unknown;
  const chain: Record<string, unknown> = {
    select: () => chain,
    from: (t: unknown) => {
      table = t;
      return chain;
    },
    where: () => chain,
    limit: () => Promise.resolve(table === users ? (selfRow ? [selfRow] : []) : row ? [row] : []),
    update: () => ({ set: () => ({ where: async () => [] }) }),
  };
  return chain;
}

describe('CheckinService.getByToken', () => {
  it('lanca NotFoundException quando o token nao existe', async () => {
    const deps = makeDeps();
    const db = {
      runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(makeSessionTx(undefined))),
    } as unknown as TenantDatabase;
    const service = new CheckinService(
      db,
      CONFIG,
      deps.cipher,
      deps.healthConsent,
      deps.queues,
      deps.queueEvents,
      deps.shortLinks,
      deps.logger,
    );
    await expect(service.getByToken(TOKEN)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('devolve status e semana quando o token e valido', async () => {
    const deps = makeDeps();
    const row = {
      id: CHECKIN_ID,
      userId: USER_ID,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
      weekNumber: 4,
    };
    const db = {
      runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(makeSessionTx(row))),
      runAsUser: vi.fn((_u: string, _r: string, cb: (tx: unknown) => Promise<unknown>) =>
        cb(makeSessionTx(row, { name: 'Maria Silva' })),
      ),
    } as unknown as TenantDatabase;
    const service = new CheckinService(
      db,
      CONFIG,
      deps.cipher,
      deps.healthConsent,
      deps.queues,
      deps.queueEvents,
      deps.shortLinks,
      deps.logger,
    );
    await expect(service.getByToken(TOKEN)).resolves.toEqual({
      status: 'PENDING',
      firstName: 'Maria',
      weekNumber: 4,
    });
  });

  it('titular sem nome cadastrado: firstName vem null', async () => {
    const deps = makeDeps();
    const row = {
      id: CHECKIN_ID,
      userId: USER_ID,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
      weekNumber: 4,
    };
    const db = {
      runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(makeSessionTx(row))),
      runAsUser: vi.fn((_u: string, _r: string, cb: (tx: unknown) => Promise<unknown>) =>
        cb(makeSessionTx(row, { name: null })),
      ),
    } as unknown as TenantDatabase;
    const service = new CheckinService(
      db,
      CONFIG,
      deps.cipher,
      deps.healthConsent,
      deps.queues,
      deps.queueEvents,
      deps.shortLinks,
      deps.logger,
    );
    await expect(service.getByToken(TOKEN)).resolves.toEqual({
      status: 'PENDING',
      firstName: null,
      weekNumber: 4,
    });
  });

  it('token vencido: expira, devolve status EXPIRED (sem lancar exceção)', async () => {
    const deps = makeDeps();
    const row = {
      id: CHECKIN_ID,
      userId: USER_ID,
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 60_000),
      weekNumber: 4,
    };
    const updateSet = vi.fn(() => ({ where: async () => [] }));
    const db = {
      runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(makeSessionTx(row))),
      runAsUser: vi.fn((_u: string, _r: string, cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          update: () => ({ set: updateSet }),
          select: () => makeSessionTx(row, { name: null }),
        }),
      ),
    } as unknown as TenantDatabase;
    const service = new CheckinService(
      db,
      CONFIG,
      deps.cipher,
      deps.healthConsent,
      deps.queues,
      deps.queueEvents,
      deps.shortLinks,
      deps.logger,
    );
    await expect(service.getByToken(TOKEN)).resolves.toEqual({
      status: 'EXPIRED',
      firstName: null,
      weekNumber: 4,
    });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'EXPIRED' }));
  });
});

describe('CheckinService.lastSentOrRespondedAt', () => {
  function makeQueryTx(row: Record<string, unknown> | undefined) {
    return {
      select: () => ({
        from: () => ({
          where: () => ({ orderBy: () => ({ limit: async () => (row ? [row] : []) }) }),
        }),
      }),
    };
  }

  it('sem nenhum check-in enviado para o titular: undefined', async () => {
    const deps = makeDeps();
    const db = {
      runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(makeQueryTx(undefined))),
    } as unknown as TenantDatabase;
    const service = new CheckinService(
      db,
      CONFIG,
      deps.cipher,
      deps.healthConsent,
      deps.queues,
      deps.queueEvents,
      deps.shortLinks,
      deps.logger,
    );
    await expect(service.lastSentOrRespondedAt(USER_ID)).resolves.toBeUndefined();
  });

  it('check-in enviado mas ainda nao respondido: usa sentAt', async () => {
    const deps = makeDeps();
    const sentAt = new Date('2026-08-01T08:00:00Z');
    const db = {
      runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) =>
        cb(makeQueryTx({ sentAt, submittedAt: null })),
      ),
    } as unknown as TenantDatabase;
    const service = new CheckinService(
      db,
      CONFIG,
      deps.cipher,
      deps.healthConsent,
      deps.queues,
      deps.queueEvents,
      deps.shortLinks,
      deps.logger,
    );
    await expect(service.lastSentOrRespondedAt(USER_ID)).resolves.toBe(sentAt);
  });

  it('check-in ja respondido: usa submittedAt em vez de sentAt', async () => {
    const deps = makeDeps();
    const sentAt = new Date('2026-08-01T08:00:00Z');
    const submittedAt = new Date('2026-08-01T09:00:00Z');
    const db = {
      runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) =>
        cb(makeQueryTx({ sentAt, submittedAt })),
      ),
    } as unknown as TenantDatabase;
    const service = new CheckinService(
      db,
      CONFIG,
      deps.cipher,
      deps.healthConsent,
      deps.queues,
      deps.queueEvents,
      deps.shortLinks,
      deps.logger,
    );
    await expect(service.lastSentOrRespondedAt(USER_ID)).resolves.toBe(submittedAt);
  });
});

const VALID_PAYLOAD = {
  sleepQuality: 'BOA',
  mood: 'FELIZ',
  nutritionScore: 8,
  adherenceScore: 9,
  changesNoticed: ['FORCA'],
  durationFit: 'ADEQUADA',
};

describe('CheckinService.submit', () => {
  it('valida, cifra os textos livres, grava e enfileira o worker de comentario', async () => {
    const deps = makeDeps();
    const row = {
      id: CHECKIN_ID,
      userId: USER_ID,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
      weekNumber: 4,
    };
    const updateSet = vi.fn(() => ({ where: async () => [] }));
    const db = {
      runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(makeSessionTx(row))),
      runAsUser: vi.fn((_u: string, _r: string, cb: (tx: unknown) => Promise<unknown>) =>
        cb({ update: () => ({ set: updateSet }) }),
      ),
    } as unknown as TenantDatabase;
    const service = new CheckinService(
      db,
      CONFIG,
      deps.cipher,
      deps.healthConsent,
      deps.queues,
      deps.queueEvents,
      deps.shortLinks,
      deps.logger,
    );

    await expect(service.submit(TOKEN, VALID_PAYLOAD)).resolves.toEqual({ status: 'SUBMITTED' });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'SUBMITTED',
        answers: expect.objectContaining({ mood: 'FELIZ' }),
      }),
    );
    expect(deps.enqueue).toHaveBeenCalledWith(
      'checkin-weekly-feedback',
      'checkin-weekly-feedback',
      {
        userId: USER_ID,
        checkinId: CHECKIN_ID,
      },
    );
  });

  it('lanca NotFoundException quando o token nao existe', async () => {
    const deps = makeDeps();
    const db = {
      runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(makeSessionTx(undefined))),
    } as unknown as TenantDatabase;
    const service = new CheckinService(
      db,
      CONFIG,
      deps.cipher,
      deps.healthConsent,
      deps.queues,
      deps.queueEvents,
      deps.shortLinks,
      deps.logger,
    );
    await expect(service.submit(TOKEN, VALID_PAYLOAD)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lanca ForbiddenException quando o consentimento de saude foi revogado', async () => {
    const deps = makeDeps({ hasConsent: false });
    const row = {
      id: CHECKIN_ID,
      userId: USER_ID,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
      weekNumber: 4,
    };
    const db = {
      runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(makeSessionTx(row))),
    } as unknown as TenantDatabase;
    const service = new CheckinService(
      db,
      CONFIG,
      deps.cipher,
      deps.healthConsent,
      deps.queues,
      deps.queueEvents,
      deps.shortLinks,
      deps.logger,
    );
    await expect(service.submit(TOKEN, VALID_PAYLOAD)).rejects.toBeInstanceOf(ForbiddenException);
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it('rejeita payload invalido com BadRequestException', async () => {
    const deps = makeDeps();
    const row = {
      id: CHECKIN_ID,
      userId: USER_ID,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
      weekNumber: 4,
    };
    const db = {
      runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(makeSessionTx(row))),
    } as unknown as TenantDatabase;
    const service = new CheckinService(
      db,
      CONFIG,
      deps.cipher,
      deps.healthConsent,
      deps.queues,
      deps.queueEvents,
      deps.shortLinks,
      deps.logger,
    );
    await expect(service.submit(TOKEN, { sleepQuality: 'BOA' })).rejects.toThrow();
  });

  it('lanca ConflictException quando o check-in ja foi enviado', async () => {
    const deps = makeDeps();
    const row = {
      id: CHECKIN_ID,
      userId: USER_ID,
      status: 'SUBMITTED',
      expiresAt: new Date(Date.now() + 60_000),
      weekNumber: 4,
    };
    const db = {
      runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(makeSessionTx(row))),
    } as unknown as TenantDatabase;
    const service = new CheckinService(
      db,
      CONFIG,
      deps.cipher,
      deps.healthConsent,
      deps.queues,
      deps.queueEvents,
      deps.shortLinks,
      deps.logger,
    );
    await expect(service.submit(TOKEN, VALID_PAYLOAD)).rejects.toBeInstanceOf(ConflictException);
  });

  it('lanca GoneException e expira quando o token esta vencido', async () => {
    const deps = makeDeps();
    const row = {
      id: CHECKIN_ID,
      userId: USER_ID,
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 60_000),
      weekNumber: 4,
    };
    const updateSet = vi.fn(() => ({ where: async () => [] }));
    const db = {
      runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(makeSessionTx(row))),
      runAsUser: vi.fn((_u: string, _r: string, cb: (tx: unknown) => Promise<unknown>) =>
        cb({ update: () => ({ set: updateSet }) }),
      ),
    } as unknown as TenantDatabase;
    const service = new CheckinService(
      db,
      CONFIG,
      deps.cipher,
      deps.healthConsent,
      deps.queues,
      deps.queueEvents,
      deps.shortLinks,
      deps.logger,
    );
    await expect(service.submit(TOKEN, VALID_PAYLOAD)).rejects.toBeInstanceOf(GoneException);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'EXPIRED' }));
  });
});
