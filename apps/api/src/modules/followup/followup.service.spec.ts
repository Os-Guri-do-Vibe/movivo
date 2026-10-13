import { describe, expect, it, vi } from 'vitest';

import type { TenantDatabase } from '../../core/database/tenant-database.service';
import {
  FOLLOWUP_OPEN_TTL_MS,
  FOLLOWUP_RESERVATION_TTL_MS,
  FollowupService,
  type ReserveFollowupInput,
} from './followup.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const FOLLOWUP_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-10-13T02:30:00.000Z');

const INPUT: ReserveFollowupInput = {
  kind: 'MISSED_WORKOUT',
  subjectDate: '2026-10-12',
  sessionKey: 'Dia A',
  workoutSessionId: null,
  protocolId: '33333333-3333-4333-8333-333333333333',
  topicLabel: 'Costas e Bíceps',
};

/** Cadeia mínima do Drizzle: registra valores/sets e devolve as linhas programadas. */
function makeService(options: { selects?: unknown[][]; returning?: unknown[][] } = {}) {
  const selects = [...(options.selects ?? [])];
  const returning = [...(options.returning ?? [])];
  const inserted: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const query = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {};
    for (const name of ['from', 'where', 'orderBy', 'limit']) chain[name] = () => chain;
    chain.then = (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject);
    return chain;
  };
  const tx = {
    select: () => query(selects.shift() ?? []),
    insert: () => {
      const chain = {
        values: (value: Record<string, unknown>) => {
          inserted.push(value);
          return chain;
        },
        onConflictDoNothing: () => Promise.resolve(),
      };
      return chain;
    },
    update: () => {
      const chain = {
        set: (value: Record<string, unknown>) => {
          updates.push(value);
          return chain;
        },
        where: () => chain,
        returning: async () => returning.shift() ?? [],
      };
      return chain;
    },
  };
  const db = {
    runAsUser: vi.fn((_u: string, _r: string, cb: (value: typeof tx) => unknown) => cb(tx)),
    runAsSystem: vi.fn((cb: (value: typeof tx) => unknown) => cb(tx)),
  } as unknown as TenantDatabase;
  return { service: new FollowupService(db), inserted, updates };
}

describe('FollowupService', () => {
  it('reserve: grava PENDING_SEND com validade de 24h e devolve a linha existente', async () => {
    const { service, inserted } = makeService({
      selects: [[{ id: FOLLOWUP_ID, status: 'PENDING_SEND' }]],
    });
    await expect(service.reserve(USER_ID, INPUT, NOW)).resolves.toMatchObject({
      id: FOLLOWUP_ID,
    });
    expect(inserted[0]).toMatchObject({
      userId: USER_ID,
      subjectDate: '2026-10-12',
      topicLabel: 'Costas e Bíceps',
      expiresAt: new Date(NOW.getTime() + FOLLOWUP_RESERVATION_TTL_MS),
    });
  });

  it('reserve: falha alto se a linha não existe depois do insert', async () => {
    const { service } = makeService({ selects: [[]] });
    await expect(service.reserve(USER_ID, INPUT, NOW)).rejects.toThrow(/linha não encontrada/);
  });

  it('isSendable lê o estado atual da reserva', async () => {
    expect(
      await makeService({ selects: [[{ status: 'PENDING_SEND' }]] }).service.isSendable(
        USER_ID,
        FOLLOWUP_ID,
      ),
    ).toBe(true);
    expect(
      await makeService({ selects: [[{ status: 'CANCELLED' }]] }).service.isSendable(
        USER_ID,
        FOLLOWUP_ID,
      ),
    ).toBe(false);
    expect(await makeService({ selects: [[]] }).service.isSendable(USER_ID, FOLLOWUP_ID)).toBe(
      false,
    );
  });

  describe('recentSummary', () => {
    const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);
    const row = (
      status: string,
      deliveredHoursAgo: number | null,
      expiresInHours = 72,
    ): Record<string, unknown> => ({
      status,
      deliveredAt: deliveredHoursAgo === null ? null : hours(-deliveredHoursAgo),
      expiresAt: hours(expiresInHours),
    });

    it('sem nenhuma pergunta recente', async () => {
      const { service } = makeService({ selects: [[]] });
      await expect(service.recentSummary(USER_ID, 'MISSED_WORKOUT', NOW)).resolves.toEqual({
        hasOpen: false,
        deliveredLast7d: 0,
        lastDeliveredAt: null,
      });
    });

    it('conta só as entregues na última semana e devolve a mais recente', async () => {
      const { service } = makeService({
        selects: [
          [
            row('ANSWERED', 24 * 2, -1),
            row('EXPIRED', 24 * 6, -1),
            row('EXPIRED', 24 * 7.5, -1), // fora da semana
            row('NOT_SENT', null, -1), // nunca entregue
          ],
        ],
      });
      const summary = await service.recentSummary(USER_ID, 'MISSED_WORKOUT', NOW);
      expect(summary.deliveredLast7d).toBe(2);
      expect(summary.lastDeliveredAt).toEqual(hours(-24 * 2));
      expect(summary.hasOpen).toBe(false);
    });

    it('OPEN dentro da validade é pergunta aberta; OPEN vencida (sem cron) não é', async () => {
      const open = makeService({ selects: [[row('OPEN', 5, 67)]] });
      expect((await open.service.recentSummary(USER_ID, 'MISSED_WORKOUT', NOW)).hasOpen).toBe(true);
      const stale = makeService({ selects: [[row('OPEN', 80, -8)]] });
      expect((await stale.service.recentSummary(USER_ID, 'MISSED_WORKOUT', NOW)).hasOpen).toBe(
        false,
      );
    });
  });

  it('markDelivered: abre a pendência e estende a validade para 72h a partir da entrega', async () => {
    const { service, updates } = makeService({ returning: [[{ id: FOLLOWUP_ID }]] });
    await expect(service.markDelivered(USER_ID, FOLLOWUP_ID, NOW)).resolves.toBe(true);
    expect(updates[0]).toEqual({
      status: 'OPEN',
      deliveredAt: NOW,
      expiresAt: new Date(NOW.getTime() + FOLLOWUP_OPEN_TTL_MS),
    });
  });

  it('transições são idempotentes: sem linha na origem devolvem false', async () => {
    const { service } = makeService({ returning: [[], [], []] });
    expect(await service.markDelivered(USER_ID, FOLLOWUP_ID, NOW)).toBe(false);
    expect(await service.markAnswered(USER_ID, FOLLOWUP_ID, NOW)).toBe(false);
    expect(await service.markNotSent(USER_ID, FOLLOWUP_ID, NOW)).toBe(false);
  });

  it('markAnswered e markNotSent gravam o estado final com resolvedAt', async () => {
    const { service, updates } = makeService({
      returning: [[{ id: FOLLOWUP_ID }], [{ id: FOLLOWUP_ID }]],
    });
    await service.markAnswered(USER_ID, FOLLOWUP_ID, NOW);
    await service.markNotSent(USER_ID, FOLLOWUP_ID, NOW);
    expect(updates).toEqual([
      { status: 'ANSWERED', resolvedAt: NOW },
      { status: 'NOT_SENT', resolvedAt: NOW },
    ]);
  });

  it('resolveForWorkout: cancela a reserva e marca a entregue como retomada', async () => {
    const { service, updates } = makeService({
      returning: [[{ id: 'a' }], [{ id: 'b' }, { id: 'c' }]],
    });
    await expect(service.resolveForWorkout(USER_ID, '2026-10-13', NOW)).resolves.toEqual({
      cancelled: 1,
      resumed: 2,
    });
    expect(updates).toEqual([
      { status: 'CANCELLED', resolvedAt: NOW },
      { status: 'RESUMED', resolvedAt: NOW },
    ]);
  });

  it('listForContext devolve as pendências abertas', async () => {
    const rows = [{ id: FOLLOWUP_ID, status: 'OPEN' }];
    const { service } = makeService({ selects: [rows] });
    await expect(service.listForContext(USER_ID, NOW)).resolves.toEqual(rows);
  });

  it('sweep materializa expiradas e reservas velhas como contadores', async () => {
    const { service, updates } = makeService({
      returning: [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }]],
    });
    await expect(service.sweep(NOW)).resolves.toEqual({ expired: 2, notSent: 1 });
    expect(updates).toEqual([
      { status: 'EXPIRED', resolvedAt: NOW },
      { status: 'NOT_SENT', resolvedAt: NOW },
    ]);
  });
});
