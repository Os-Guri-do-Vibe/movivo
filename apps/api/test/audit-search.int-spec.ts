/** Busca real e paginada sobre a trilha append-only, incluindo auditoria da própria leitura. */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/core/config/load-env';
import type { DrizzleClient } from '../src/core/database/database.module';
import { auditLogs, users } from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { AuditQueryService } from '../src/modules/admin/audit-query.service';
import { AuditService } from '../src/modules/admin/audit.service';
import type { AuthenticatedUser } from '../src/modules/auth/jwt.strategy';

const { env } = loadEnv();
const RUN = Date.now().toString().slice(-8);
const ACTION = `AUDIT_SEARCH_TEST_${RUN}`;
const client = postgres({
  host: env.DATABASE_HOST ?? 'localhost',
  port: Number(env.DATABASE_PORT ?? 5433),
  user: env.DATABASE_USER ?? 'movivo_app',
  password: env.DATABASE_PASSWORD,
  database: env.DATABASE_NAME ?? 'movivo',
  ssl: false,
  max: 3,
  prepare: false,
  idle_timeout: 5,
  onnotice: () => {
    /* Notices não entram no log do teste. */
  },
});
const tenant = new TenantDatabase(drizzle(client) as unknown as DrizzleClient);
const audit = new AuditService();
const service = new AuditQueryService(tenant, audit);
let actor: AuthenticatedUser;

beforeAll(async () => {
  const actorId = await tenant.runAsSystem(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values({ phoneNumber: `+5552${RUN}6`, name: 'Auditor de integração' })
      .returning({ id: users.id });
    if (!created) throw new Error('ator não criado');
    for (let index = 0; index < 11; index++) {
      await audit.append(tx, {
        actorId: created.id,
        userId: created.id,
        action: ACTION,
        entityType: 'audit_search_test',
        entityId: randomUUID(),
        changes: { index },
      });
    }
    return created.id;
  });
  actor = { userId: actorId, role: 'ADMIN', jti: 'integration' };
}, 30_000);

afterAll(async () => client.end({ timeout: 5 }));

describe('AuditQueryService — Postgres real', () => {
  it('filtra por ator/tipo/período e pagina com conferência exata', async () => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const first = await service.search(actor, {
      actorId: actor.userId,
      action: ACTION,
      from: today,
      to: today,
      page: '1',
      pageSize: '10',
    });
    expect(first.data.events).toHaveLength(10);
    expect(first.data.pagination).toEqual({ page: 1, pageSize: 10, total: 11, totalPages: 2 });
    expect(first.data.events.every((event) => event.action === ACTION)).toBe(true);

    const second = await service.search(actor, { action: ACTION, page: '2', pageSize: '10' });
    expect(second.data.events).toHaveLength(1);
  });

  it('registra a própria consulta na trilha', async () => {
    const rows = await tenant.runAsSystem((tx) =>
      tx
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(eq(auditLogs.action, 'AUDIT_LOG_VIEWED')),
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});
