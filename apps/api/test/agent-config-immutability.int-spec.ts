/**
 * Teste de integração da imutabilidade de `agent_config` (US-7.6/TASK-7.6.2, gate
 * bloqueante da US-7.9). Exerce I/O real contra o Postgres e prova as duas barreiras
 * independentes descritas em `security-policies.ts` (`buildAgentConfigImmutabilitySql`)
 * **separadamente, contra a role certa para cada uma**:
 *
 *   (a) REVOKE UPDATE/DELETE/TRUNCATE da role de runtime (`movivo_app`) — é a barreira
 *       que a aplicação encontra de verdade. O Postgres checa privilégio ANTES de sequer
 *       considerar o trigger, então para essa role o erro observado é sempre 42501
 *       ("permission denied"), nunca 55000;
 *   (b) trigger `agent_config_reject_mutation` — vale até para quem tem grant (defesa em
 *       profundidade caso o REVOKE seja revertido por engano). Só é observável usando uma
 *       role que ainda detém o privilégio, por isso este teste usa `movivo_migrator` (o
 *       runner de migration, que nunca teve o REVOKE aplicado) para essa parte — e nela
 *       o erro é 55000 ("agent_config is append-only"), com o UPDATE de fato nunca
 *       aplicado (a barreira funciona mesmo com o privilégio presente).
 *
 * Sem teardown de DELETE: a própria garantia que este teste prova (append-only) torna
 * a linha inserida impossível de apagar por SQL comum — mesmo padrão já aceito em
 * `audit_logs` (ver `security-foundation.int-spec.ts`). A linha de teste nasce
 * `status: 'DRAFT'`, então nunca é lida por `AgentConfigRepository.activePayload()`
 * (que filtra `WHERE status = 'PUBLISHED'`) e não afeta a persona servida em dev.
 *
 * Pré-requisito: `pnpm run infra:up` + `db:migrate` (aplica a trigger/REVOKE via runner).
 */
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AgentConfigRepository } from '../src/core/agent-config/agent-config.repository';
import { loadEnv } from '../src/core/config/load-env';
import { type DrizzleClient } from '../src/core/database/database.module';
import { TenantDatabase } from '../src/core/database/tenant-database.service';

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
const repo = new AgentConfigRepository(db);

// --- Cliente de MIGRATION: única role que ainda tem grant de UPDATE/DELETE,
// necessário para observar o trigger isoladamente (ver comentário do arquivo). ---
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

let authorId = '';
// Version alta e única a cada execução — nunca colide com uma publicação real.
const TEST_VERSION = 900_000 + Number(RUN.slice(-5));

beforeAll(async () => {
  authorId = await tenant.runAsSystem(async (tx) => {
    const rows = (await tx.execute(
      sql`INSERT INTO users (phone_number, name) VALUES (${`+5555${RUN}9`}, 'Autor (teste US-7.9)') RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    return rows[0].id;
  });
}, 30_000);

afterAll(async () => {
  await appClient.end({ timeout: 5 });
  await migratorClient.end({ timeout: 5 });
});

describe('agent_config — append-only imposto no banco (US-7.6/US-7.9)', () => {
  it('INSERT funciona pela role de runtime (a via legítima de publicação)', async () => {
    await appClient`
      INSERT INTO agent_config (target_sex, version, status, payload, change_note, created_by)
      VALUES (
        'MALE', ${TEST_VERSION}, 'DRAFT', ${JSON.stringify({})}::jsonb,
        'teste de integração US-7.9 — nunca publicado', ${authorId}::uuid
      )
    `;
    const [row] = await appClient<{ version: number }[]>`
      SELECT version FROM agent_config WHERE version = ${TEST_VERSION}
    `;
    expect(row?.version).toBe(TEST_VERSION);
  });

  it('UPDATE pela role de runtime é barrado por falta de privilégio (42501)', async () => {
    await expect(
      appClient`UPDATE agent_config SET status = 'ARCHIVED' WHERE version = ${TEST_VERSION}`,
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('DELETE pela role de runtime é barrado por falta de privilégio (42501)', async () => {
    await expect(
      appClient`DELETE FROM agent_config WHERE version = ${TEST_VERSION}`,
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('TRUNCATE pela role de runtime é barrado por falta de privilégio (42501)', async () => {
    await expect(appClient`TRUNCATE agent_config`).rejects.toMatchObject({ code: '42501' });
  });

  it('UPDATE pela role de migration (que ainda tem grant) é barrado pelo trigger (55000)', async () => {
    await expect(
      migratorClient`UPDATE agent_config SET status = 'ARCHIVED' WHERE version = ${TEST_VERSION}`,
    ).rejects.toMatchObject({ code: '55000', message: expect.stringContaining('append-only') });

    const [row] = await appClient<{ status: string }[]>`
      SELECT status FROM agent_config WHERE version = ${TEST_VERSION}
    `;
    expect(row?.status).toBe('DRAFT');
  });

  it('a role de runtime não tem o privilégio de UPDATE/DELETE mesmo sem a trigger (segunda barreira)', async () => {
    const rows = await appClient<{ privilege_type: string }[]>`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_name = 'agent_config'
        AND grantee = current_user
        AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')
    `;
    expect(rows).toEqual([]);
  });

  it('a linha de teste (DRAFT) nunca aparece como persona vigente', async () => {
    for (const slot of ['MALE', 'FEMALE'] as const) {
      const active = await repo.activePayload(slot);
      expect(active?.version).not.toBe(TEST_VERSION);
    }
  });
});
