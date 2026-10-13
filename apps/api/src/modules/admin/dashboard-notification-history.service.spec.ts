import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { DashboardNotificationHistoryService } from './dashboard-notification-history.service';
import type { DashboardNotificationsService } from './dashboard-notifications.service';
import type { DashboardService } from './dashboard.service';

const ACTOR = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'PROFESSIONAL',
  jti: 'j1',
} as const as AuthenticatedUser;
const USER_ID = '99999999-9999-4999-8999-999999999999';
const ALERT_ID = '33333333-3333-4333-8333-333333333333';
const PROTOCOL_ID = '44444444-4444-4444-8444-444444444444';
const SUBSTITUTION_ID = '55555555-5555-4555-8555-555555555555';

const T = (iso: string) => new Date(iso);

interface Rows {
  alerts?: unknown[];
  protocols?: unknown[];
  substitutions?: unknown[];
}

function build(rows: Rows = {}, read: string[] = []) {
  // `history()` consulta alertas, protocolos e substituições, nessa ordem.
  const queue = [rows.alerts ?? [], rows.protocols ?? [], rows.substitutions ?? []];
  const select = vi.fn(() => {
    const result = queue.shift() ?? [];
    const chain: Record<string, unknown> = {};
    for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit']) {
      chain[method] = () => chain;
    }
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return chain;
  });
  const db = {
    runAsUser: vi.fn((_id: string, _role: string, cb: (tx: unknown) => Promise<unknown>) =>
      cb({ select }),
    ),
  } as unknown as TenantDatabase;
  const dashboard = {
    readKeys: vi.fn(async () => new Set(read)),
    auditRead: vi.fn(async () => undefined),
  } as unknown as DashboardService;
  const notifications = {
    summary: vi.fn(async () => ({ unread: 3, openSafety: 1 })),
  } as unknown as DashboardNotificationsService;
  return {
    service: new DashboardNotificationHistoryService(db, dashboard, notifications),
    select,
    dashboard,
  };
}

const alertRow = (overrides = {}) => ({
  id: ALERT_ID,
  userId: USER_ID,
  studentName: 'Ana',
  level: 'SAFETY',
  reason: 'DOR_APOS_TREINO',
  sourceType: 'WORKOUT',
  status: 'OPEN',
  createdAt: T('2026-10-12T14:00:00.000Z'),
  updatedAt: T('2026-10-12T14:00:00.000Z'),
  ...overrides,
});
const protocolRow = (overrides = {}) => ({
  id: PROTOCOL_ID,
  userId: USER_ID,
  name: 'Bruno',
  createdAt: T('2026-10-12T15:00:00.000Z'),
  updatedAt: T('2026-10-12T16:00:00.000Z'),
  signedAt: T('2026-10-12T16:30:00.000Z'),
  approvalStatus: 'HUMAN_APPROVED',
  reviewUrgency: 'MANDATORY',
  generatedBy: null,
  parqState: null,
  ...overrides,
});
const substitutionRow = (overrides = {}) => ({
  id: SUBSTITUTION_ID,
  userId: USER_ID,
  name: 'Carla',
  createdAt: T('2026-10-12T13:00:00.000Z'),
  updatedAt: T('2026-10-12T13:20:00.000Z'),
  decidedAt: T('2026-10-12T13:10:00.000Z'),
  status: 'DISCARDED',
  reviewUrgency: 'OPTIONAL',
  catalogGap: false,
  parqState: null,
  ...overrides,
});

describe('DashboardNotificationHistoryService', () => {
  it('junta as três origens em ordem cronológica decrescente com o resultado de cada uma', async () => {
    const { service } = build(
      { alerts: [alertRow()], protocols: [protocolRow()], substitutions: [substitutionRow()] },
      [`alert:${ALERT_ID}`],
    );
    const result = await service.history(ACTOR, {});

    expect(result.items.map((item) => item.type)).toEqual(['protocol', 'alert', 'substitution']);
    expect(result.items[0]).toMatchObject({
      status: 'SETTLED',
      outcome: 'SIGNED',
      settledAt: '2026-10-12T16:30:00.000Z',
      title: 'Protocolo para Revisão: Bruno',
      read: true,
    });
    expect(result.items[1]).toMatchObject({
      status: 'PENDING',
      outcome: null,
      level: 'SAFETY',
      read: true,
    });
    expect(result.items[2]).toMatchObject({ outcome: 'DISCARDED', read: true });
    expect(result).toMatchObject({ unread: 3, openSafety: 1, nextCursor: null });
  });

  it('item pendente sem leitura registrada é não lido; decidido nunca é', async () => {
    const { service } = build({
      alerts: [
        alertRow(),
        alertRow({ id: 'x', status: 'RESOLVED', createdAt: T('2026-10-12T10:00:00.000Z') }),
      ],
    });
    const { items } = await service.history(ACTOR, {});
    expect(items.map((item) => [item.status, item.read])).toEqual([
      ['PENDING', false],
      ['SETTLED', true],
    ]);
  });

  it('classifica protocolo automático e substituição liberada', async () => {
    const { service } = build({
      protocols: [protocolRow({ approvalStatus: 'AUTO_APPROVED', reviewUrgency: 'OPTIONAL' })],
      substitutions: [substitutionRow({ status: 'RELEASED' })],
    });
    const { items } = await service.history(ACTOR, {});
    expect(items.find((item) => item.type === 'protocol')?.outcome).toBe('AUTO_RELEASED');
    expect(items.find((item) => item.type === 'substitution')?.outcome).toBe('RELEASED');
  });

  it('protocolo pendente carrega a seção, a origem e o prazo do envio automático', async () => {
    const { service } = build({
      protocols: [
        protocolRow({
          id: 'p-mandatory',
          approvalStatus: 'PENDING_REVIEW',
          parqState: 'BLOQUEADO_AGUARDANDO_CLEARANCE',
        }),
        protocolRow({
          id: 'p-optional',
          approvalStatus: 'PENDING_REVIEW',
          reviewUrgency: 'OPTIONAL',
          createdAt: T('2026-10-12T14:00:00.000Z'),
        }),
      ],
    });
    const { items } = await service.history(ACTOR, {});
    expect(items[0]).toMatchObject({ section: 'MANDATORY', origin: 'PARQ', autoReleaseAt: null });
    expect(items[1]?.section).toBe('OPTIONAL');
    expect(items[1]?.autoReleaseAt).toEqual(expect.any(String));
    expect(items[1]?.origin).toBeNull();
  });

  it('pagina por cursor: devolve só `limit` itens e o cursor do último', async () => {
    const { service } = build({
      alerts: [
        alertRow({ id: 'a1' }),
        alertRow({ id: 'a2', createdAt: T('2026-10-12T12:00:00Z') }),
      ],
    });
    const first = await service.history(ACTOR, { limit: '1' });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    const decoded = JSON.parse(Buffer.from(first.nextCursor ?? '', 'base64url').toString());
    expect(decoded).toMatchObject({ c: '2026-10-12T14:00:00.000Z', t: 'alert', i: 'a1' });
  });

  it('audita a leitura de cada item devolvido', async () => {
    const { service, dashboard } = build({ alerts: [alertRow()], protocols: [protocolRow()] });
    await service.history(ACTOR, {});
    expect(dashboard.auditRead).toHaveBeenCalledTimes(2);
    expect(dashboard.auditRead).toHaveBeenCalledWith(
      expect.anything(),
      ACTOR,
      USER_ID,
      'handoff_alert',
      ALERT_ID,
    );
  });

  it('o filtro de tipo consulta só as origens pedidas', async () => {
    const alerts = build({ alerts: [alertRow()] });
    await alerts.service.history(ACTOR, { type: 'alert' });
    expect(alerts.select).toHaveBeenCalledTimes(1);

    const queue = build({ protocols: [protocolRow()] });
    await queue.service.history(ACTOR, { type: 'queue' });
    expect(queue.select).toHaveBeenCalledTimes(2);
  });

  it('rejeita parâmetros e cursor inválidos e papéis fora do dashboard', async () => {
    const { service } = build();
    await expect(service.history(ACTOR, { state: 'lidas' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.history(ACTOR, { limit: '500' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.history(ACTOR, { cursor: 'lixo' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.history({ ...ACTOR, role: 'USER' } as AuthenticatedUser, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
