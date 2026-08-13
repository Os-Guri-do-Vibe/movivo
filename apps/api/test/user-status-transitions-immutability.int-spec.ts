/**
 * Teste de integração da imutabilidade de `user_status_transitions` (US-8.3/TASK-8.3.1).
 *
 * Espelha literalmente `agent-config-immutability.int-spec.ts` — o padrão foi provado contra
 * Postgres real na Sprint 7 e não há razão para inventar um mecanismo novo. Prova as duas
 * barreiras de `buildStatusTransitionsImmutabilitySql` **separadamente, contra a role certa**:
 *
 *   (a) REVOKE UPDATE/DELETE/TRUNCATE da role de runtime (`movivo_app`) — é a barreira que a
 *       aplicação encontra de verdade. O Postgres checa privilégio ANTES do trigger, então
 *       para essa role o erro é sempre 42501 ("permission denied"), nunca 55000;
 *   (b) trigger `trg_user_status_transitions_immutable` — vale até para quem tem grant (defesa
 *       em profundidade se o REVOKE for revertido por engano). Só é observável por uma role
 *       que ainda detém o privilégio, por isso a parte (b) usa `movivo_migrator`, e nela o
 *       erro é 55000 com o UPDATE de fato nunca aplicado.
 *
 * Sem teardown de DELETE: a própria garantia provada aqui (append-only) torna a linha
 * impossível de apagar por SQL comum — mesmo padrão já aceito em `audit_logs` e `agent_config`.
 * O titular é sintético (`+5555…`, ver `seed.ts`) e nunca entra em funil/coorte real de dev
 * além de somar 1 em `TRIAL_STARTED`.
 *
 * Pré-requisito: `pnpm run infra:up` + `db:migrate`.
 */
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/core/config/load-env';
import { type DrizzleClient } from '../src/core/database/database.module';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { recordLifecycleTransition } from '../src/modules/subscription/subscription-lifecycle';

const { env } = loadEnv();
const RUN = Date.now().toString().slice(-8);

// --- Cliente de APLICAÇÃO: exatamente o caminho de runtime (movivo_app @ 5433) ---
const appClient = postgres({
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
    /* notices podem conter valores — nunca vão para o log do teste. */
  },
});
const db = drizzle(appClient) as unknown as DrizzleClient;
const tenant = new TenantDatabase(db);

// --- Cliente de MIGRATION: única role que ainda tem grant de UPDATE/DELETE,
// necessário para observar o trigger isoladamente (ver cabeçalho). ---
const migratorClient = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
  user: env.MIGRATION_DATABASE_USER ?? 'movivo_migrator',
  password: env.MIGRATION_DATABASE_PASSWORD,
  database: env.DATABASE_NAME ?? 'movivo',
  ssl: false,
  max: 1,
  prepare: false,
  idle_timeout: 5,
  onnotice: () => {
    /* notices podem conter valores — nunca vão para o log do teste. */
  },
});

let userId = '';
let transitionId = '';

beforeAll(async () => {
  userId = await tenant.runAsSystem(async (tx) => {
    const rows = (await tx.execute(
      sql`INSERT INTO users (phone_number, name) VALUES (${`+5555${RUN}8`}, 'Titular (teste US-8.3)') RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    return rows[0].id;
  });
}, 30_000);

afterAll(async () => {
  await appClient.end({ timeout: 5 });
  await migratorClient.end({ timeout: 5 });
});

describe('user_status_transitions — append-only imposto no banco (US-8.3)', () => {
  it('INSERT funciona pela role de runtime (a via legítima de emissão)', async () => {
    // GUCs de tenant e INSERT precisam da MESMA transação (SET LOCAL) — o pool pode
    // servir conexões diferentes a duas chamadas soltas, e a RLS é fail-closed.
    const rows = await appClient.begin(async (tx) => {
      await tx`SELECT set_config('app.current_role', 'SYSTEM', true)`;
      return tx<{ id: string }[]>`
        INSERT INTO user_status_transitions (user_id, to_status, actor, reason)
        VALUES (${userId}::uuid, 'TRIAL_STARTED', 'SYSTEM', 'teste de integração US-8.3')
        RETURNING id
      `;
    });
    const [row] = rows as unknown as Array<{ id: string }>;
    expect(row?.id).toBeTruthy();
    transitionId = row.id;
  });

  it('UPDATE pela role de runtime é barrado por falta de privilégio (42501)', async () => {
    await expect(
      appClient`UPDATE user_status_transitions SET to_status = 'CONVERTED' WHERE id = ${transitionId}::uuid`,
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('DELETE pela role de runtime é barrado por falta de privilégio (42501)', async () => {
    await expect(
      appClient`DELETE FROM user_status_transitions WHERE id = ${transitionId}::uuid`,
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('TRUNCATE pela role de runtime é barrado por falta de privilégio (42501)', async () => {
    await expect(appClient`TRUNCATE user_status_transitions`).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('UPDATE pela role de migration (que ainda tem grant) é barrado pelo trigger (55000)', async () => {
    await expect(
      migratorClient`UPDATE user_status_transitions SET to_status = 'CONVERTED' WHERE id = ${transitionId}::uuid`,
    ).rejects.toMatchObject({ code: '55000', message: expect.stringContaining('append-only') });

    const [row] = await migratorClient<{ to_status: string }[]>`
      SELECT to_status FROM user_status_transitions WHERE id = ${transitionId}::uuid
    `;
    expect(row?.to_status).toBe('TRIAL_STARTED');
  });

  it('DELETE pela role de migration é barrado pelo trigger (55000)', async () => {
    await expect(
      migratorClient`DELETE FROM user_status_transitions WHERE id = ${transitionId}::uuid`,
    ).rejects.toMatchObject({ code: '55000' });
  });

  it('a role de runtime não tem o privilégio de UPDATE/DELETE mesmo sem a trigger (segunda barreira)', async () => {
    const rows = await appClient<{ privilege_type: string }[]>`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_name = 'user_status_transitions'
        AND grantee = current_user
        AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')
    `;
    expect(rows).toEqual([]);
  });

  it('`from_status` encadeia com o último marco do titular (subconsulta escalar no INSERT)', async () => {
    await tenant.runAsSystem((tx) =>
      recordLifecycleTransition(tx, { userId, toStatus: 'CONVERTED', actor: 'SYSTEM' }),
    );
    const [row] = await migratorClient<{ from_status: string | null }[]>`
      SELECT from_status FROM user_status_transitions
      WHERE user_id = ${userId}::uuid AND to_status = 'CONVERTED' AND actor = 'SYSTEM'
    `;
    expect(row?.from_status).toBe('TRIAL_STARTED');
  });

  it('o backfill é idempotente: o mesmo marco no mesmo instante não duplica linha', async () => {
    const occurredAt = new Date('2026-01-15T12:00:00.000Z');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await migratorClient`
        INSERT INTO user_status_transitions (user_id, to_status, occurred_at, actor)
        VALUES (${userId}::uuid, 'CONVERTED', ${occurredAt}, 'BACKFILL')
        ON CONFLICT DO NOTHING
      `;
    }
    const [row] = await migratorClient<{ total: number }[]>`
      SELECT count(*)::int AS total FROM user_status_transitions
      WHERE user_id = ${userId}::uuid AND to_status = 'CONVERTED' AND actor = 'BACKFILL'
    `;
    expect(row?.total).toBe(1);
  });
});
