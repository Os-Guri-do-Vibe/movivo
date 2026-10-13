import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { DashboardNotificationsService } from './dashboard-notifications.service';
import type { DashboardService, QueueItem } from './dashboard.service';

const ACTOR = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'PROFESSIONAL',
  jti: 'j1',
} as const as AuthenticatedUser;
const ID_A = '33333333-3333-4333-8333-333333333333';
const ID_B = '44444444-4444-4444-8444-444444444444';
const ID_C = '55555555-5555-4555-8555-555555555555';

function alert(id: string, createdAt: string, level: 'SAFETY' | 'ALERT' = 'ALERT', read = false) {
  return {
    id,
    read,
    studentName: 'Pessoa Teste',
    level,
    reason: 'FORA_DE_ESCOPO',
    sourceType: null,
    status: 'OPEN' as const,
    createdAt,
    updatedAt: createdAt,
  };
}

function queueItem(
  id: string,
  kind: QueueItem['kind'],
  createdAt: string,
  read = false,
): QueueItem {
  return {
    id,
    read,
    kind,
    severity: 'ROUTINE',
    createdAt,
    ageMinutes: 0,
    title: 'Protocolo para Revisão: Pessoa Teste',
    summary: 'PENDING_REVIEW',
    status: 'PENDING_REVIEW',
    autoReleaseAt: null,
    origin: null,
  };
}

function build(opts: { readAlerts?: string[] } = {}) {
  const readAlerts = new Set(opts.readAlerts ?? []);
  const execute = vi.fn(async () => []);
  const onConflictDoUpdate = vi.fn(async () => []);
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const tx = { insert: () => ({ values }), execute };
  const db = {
    runAsUser: vi.fn((_id: string, _role: string, cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as TenantDatabase;
  const dashboard = {
    alerts: vi.fn(async () => ({
      open: [
        alert(ID_A, '2026-10-12T10:00:00.000Z', 'SAFETY', readAlerts.has(ID_A)),
        alert(ID_B, '2026-10-12T11:00:00.000Z', 'ALERT', readAlerts.has(ID_B)),
      ],
      resolved: [],
    })),
    queue: vi.fn(async () => ({
      mandatory: [queueItem(ID_C, 'PROTOCOL', '2026-10-12T09:00:00.000Z')],
      optional: [],
      substitutionMandatory: [],
      substitutionOptional: [],
    })),
  } as unknown as DashboardService;
  return {
    service: new DashboardNotificationsService(db, dashboard),
    db,
    values,
    onConflictDoUpdate,
    execute,
  };
}

describe('DashboardNotificationsService', () => {
  it('lista não lidas primeiro e depois as lidas, cada grupo da mais nova para a mais antiga', async () => {
    const { service } = build({ readAlerts: [ID_B] });
    const result = await service.list(ACTOR);
    expect(result.items.map((item) => item.id)).toEqual([ID_A, ID_C, ID_B]);
    expect(result.items.map((item) => item.read)).toEqual([false, false, true]);
    expect(result).toMatchObject({ totalPending: 3, unread: 2, openSafety: 1 });
  });

  it('o alerta de segurança continua contado em openSafety mesmo depois de lido', async () => {
    const { service } = build({ readAlerts: [ID_A] });
    const result = await service.list(ACTOR);
    expect(result.items.find((item) => item.id === ID_A)?.read).toBe(true);
    expect(result.openSafety).toBe(1);
  });

  it('mapeia protocolo da fila com seção obrigatória e sem nível', async () => {
    const { service } = build();
    const result = await service.list(ACTOR);
    const protocol = result.items.find((item) => item.id === ID_C);
    expect(protocol).toMatchObject({ type: 'protocol', section: 'MANDATORY', level: null });
  });

  it('registra a leitura do próprio profissional, de forma idempotente', async () => {
    const { service, values, onConflictDoUpdate } = build();
    await expect(service.markRead(ACTOR, { type: 'alert', id: ID_A })).resolves.toEqual({
      ok: true,
    });
    expect(values).toHaveBeenCalledWith({ userId: ACTOR.userId, kind: 'alert', refId: ID_A });
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it('rejeita leitura com tipo ou id inválidos', async () => {
    const { service } = build();
    await expect(service.markRead(ACTOR, { type: 'outro', id: ID_A })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.markRead(ACTOR, { type: 'alert', id: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('marca tudo como lido nas três origens e limita o `until` ao instante atual', async () => {
    const { service, execute } = build();
    await service.markAllRead(ACTOR, { until: '2999-01-01T00:00:00.000Z' });
    expect(execute).toHaveBeenCalledTimes(3);
    await expect(service.markAllRead(ACTOR, { until: 'ontem' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('recusa papéis que não são do dashboard', async () => {
    const { service } = build();
    const student = { ...ACTOR, role: 'USER' } as AuthenticatedUser;
    await expect(service.summary(student)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.markRead(student, { type: 'alert', id: ID_A })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
