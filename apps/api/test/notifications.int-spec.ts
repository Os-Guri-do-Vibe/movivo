/**
 * Integração — notificações do sino e tela "Notificações" (estado de leitura por profissional).
 * Pré-requisito: `pnpm run infra:up` + `db:migrate`.
 *
 * Prova, com SQL real: o "lido" é por conta de staff, ler não altera o alerta, o filtro de não
 * lidas e o "marcar todas" respeitam o corte, e a paginação por cursor não repete nem perde
 * itens. O banco compartilhado tem outros alertas, então as asserções olham só os ids criados aqui.
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { dashboardNotificationReads, handoffAlerts, users } from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import type { AuthenticatedUser } from '../src/modules/auth/jwt.strategy';
import { DashboardNotificationHistoryService } from '../src/modules/admin/dashboard-notification-history.service';
import { DashboardNotificationsService } from '../src/modules/admin/dashboard-notifications.service';

const RUN = `${Date.now()}`.slice(-8);

let app: INestApplication;
let db: TenantDatabase;
let notifications: DashboardNotificationsService;
let history: DashboardNotificationHistoryService;
let actor: AuthenticatedUser;
let studentId = '';
let staffId = '';
const alertIds: { open: string; second: string; resolved: string } = {
  open: '',
  second: '',
  resolved: '',
};

async function pageThrough(query: Record<string, string>) {
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 200; page += 1) {
    const result: Awaited<ReturnType<typeof history.history>> = await history.history(actor, {
      ...query,
      ...(cursor ? { cursor } : {}),
    });
    seen.push(...result.items.map((item) => `${item.type}:${item.id}`));
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return seen;
}

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  db = app.get(TenantDatabase);
  notifications = app.get(DashboardNotificationsService);
  history = app.get(DashboardNotificationHistoryService);

  await db.runAsSystem(async (tx) => {
    const [student] = await tx
      .insert(users)
      .values({ phoneNumber: `+5511${RUN}1`, email: `notif-${RUN}@example.invalid` })
      .returning({ id: users.id });
    studentId = student?.id ?? '';
    const staffRows = (await tx.execute(
      sql`INSERT INTO staff (phone_number, email, name, role, password_hash)
          VALUES (${`+5511${RUN}2`}, ${`notif-staff-${RUN}@movivo.test`}, 'Teste notificações', 'ADMIN', 'x')
          RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    staffId = staffRows[0]?.id ?? '';
    const inserted = await tx
      .insert(handoffAlerts)
      .values([
        { userId: studentId, level: 'SAFETY', reason: 'RED_FLAG' },
        { userId: studentId, level: 'ALERT', reason: 'FORA_DE_ESCOPO' },
        { userId: studentId, level: 'ALERT', reason: 'PEDIDO_HANDOFF', status: 'RESOLVED' },
      ])
      .returning({ id: handoffAlerts.id, reason: handoffAlerts.reason });
    alertIds.open = inserted.find((row) => row.reason === 'RED_FLAG')?.id ?? '';
    alertIds.second = inserted.find((row) => row.reason === 'FORA_DE_ESCOPO')?.id ?? '';
    alertIds.resolved = inserted.find((row) => row.reason === 'PEDIDO_HANDOFF')?.id ?? '';
  });
  actor = { userId: staffId, role: 'ADMIN', jti: 'int-notifications' } as AuthenticatedUser;
}, 60_000);

afterAll(async () => {
  if (db && staffId) {
    // A trilha de auditoria é append-only e referencia aluno e conta de staff: esses dois
    // registros sintéticos ficam, como nos demais testes de integração que auditam.
    await db.runAsSystem(async (tx) => {
      await tx
        .delete(dashboardNotificationReads)
        .where(inArray(dashboardNotificationReads.refId, Object.values(alertIds)));
      await tx.delete(handoffAlerts).where(inArray(handoffAlerts.userId, [studentId]));
      return undefined;
    });
  }
  await app?.close();
});

describe('notificações do dashboard', () => {
  it('lista pendentes e decididos; só o pendente sem leitura é não lido', async () => {
    const result = await history.history(actor, {});
    const byId = new Map(result.items.map((item) => [item.id, item]));
    expect(byId.get(alertIds.open)).toMatchObject({
      status: 'PENDING',
      read: false,
      level: 'SAFETY',
    });
    expect(byId.get(alertIds.resolved)).toMatchObject({
      status: 'SETTLED',
      outcome: 'RESOLVED',
      read: true,
    });
    expect(result.openSafety).toBeGreaterThanOrEqual(1);
  });

  it('ler grava só para esta conta, tira o item do filtro "não lidas" e não resolve o alerta', async () => {
    const before = await notifications.summary(actor);
    await notifications.markRead(actor, { type: 'alert', id: alertIds.open });

    const after = await notifications.summary(actor);
    expect(after.unread).toBe(before.unread - 1);
    const unread = await pageThrough({ state: 'unread' });
    expect(unread).not.toContain(`alert:${alertIds.open}`);
    expect(unread).toContain(`alert:${alertIds.second}`);

    const all = await history.history(actor, {});
    expect(all.items.find((item) => item.id === alertIds.open)).toMatchObject({
      status: 'PENDING',
      read: true,
    });
    // Ler não resolve: o alerta de segurança continua contado como aberto.
    expect(after.openSafety).toBe(before.openSafety);
  });

  it('o filtro de tipo separa alertas da fila', async () => {
    const alerts = await pageThrough({ type: 'alert' });
    expect(alerts.every((key) => key.startsWith('alert:'))).toBe(true);
    const queue = await pageThrough({ type: 'queue' });
    expect(queue.some((key) => key.startsWith('alert:'))).toBe(false);
  });

  it('a paginação por cursor percorre tudo sem repetir nem perder os itens do teste', async () => {
    const seen = await pageThrough({ limit: '1' });
    expect(new Set(seen).size).toBe(seen.length);
    for (const id of Object.values(alertIds)) expect(seen).toContain(`alert:${id}`);
  });

  it('"marcar todas" zera as não lidas existentes até o corte', async () => {
    await notifications.markAllRead(actor, { until: new Date().toISOString() });
    const summary = await notifications.summary(actor);
    expect(summary.unread).toBe(0);
    const unread = await pageThrough({ state: 'unread' });
    expect(unread).toHaveLength(0);
  });
});
