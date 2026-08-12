/**
 * Teste de integração da fundação de segurança (US-1.1 / valida TASK-1.1.1..1.1.4).
 *
 * Exerce I/O real contra o stack Docker, **como a aplicação** (role `movivo_app` via
 * PgBouncer 5433, `prepare:false`), e prova:
 *   (a) RLS `FORCE` + `SET LOCAL`: `runAsUser(A)` nunca lê linha de B;
 *   (b) fail-closed: sem contexto de tenant, nenhuma linha é retornada;
 *   (c) fase anônima da anamnese isolada por token (IDOR — Sato §8.1) e, uma vez
 *       vinculada, protegida por RLS por `user_id`;
 *   (d) round-trip de cifra `pgcrypto`: `SELECT` bruto do dado retorna ciphertext.
 *
 * Pré-requisito: `pnpm run infra:up` + `db:migrate` (aplica a RLS via runner).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CONSENT_TEXTS } from '@movivo/shared';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/core/config/load-env';
import { HealthCipherService } from '../src/core/database/health-cipher.service';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { type DrizzleClient } from '../src/core/database/database.module';

const { env } = loadEnv();
const apiRoot = process.cwd();

// Prefixo único desta execução: isola os dados do teste e permite teardown limpo.
const RUN = Date.now().toString().slice(-8);
const phone = (n: number) => `+5555${RUN}${n}`;

// --- Cliente de APLICAÇÃO: exatamente o caminho de runtime (movivo_app @ 5433) ---
const appClient = postgres({
  host: env.DATABASE_HOST ?? 'localhost',
  port: Number(env.DATABASE_PORT ?? 5433),
  user: env.DATABASE_USER ?? 'movivo_app',
  password: env.DATABASE_PASSWORD,
  database: env.DATABASE_NAME ?? 'movivo',
  ssl: false,
  max: 3,
  prepare: false, // PgBouncer transaction mode
  idle_timeout: 5,
  onnotice: () => {
    /* notices podem conter valores — nunca vão para o log do teste. */
  },
});
const db = drizzle(appClient) as unknown as DrizzleClient;
const tenant = new TenantDatabase(db);
const cipher = new HealthCipherService(db, {
  pgcryptoKey:
    env.PGCRYPTO_KEY ??
    readFileSync(resolve(apiRoot, '..', '..', 'secrets', 'pgcrypto_key'), 'utf8').trimEnd(),
} as never);

// --- Cliente ADMIN (superusuário, BYPASSRLS) apenas para teardown do teste ---
const adminPort = Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432);
const adminClient = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
  port: adminPort,
  user: 'postgres',
  password: readFileSync(
    resolve(apiRoot, '..', '..', 'secrets', 'postgres_superuser_password'),
    'utf8',
  ).trimEnd(),
  database: env.DATABASE_NAME ?? 'movivo',
  ssl: false,
  max: 1,
  idle_timeout: 5,
  onnotice: () => {
    /* notices podem conter valores — nunca vão para o log do teste. */
  },
});

let userA = '';
let userB = '';
let professionalId = '';

beforeAll(async () => {
  // Criação de usuários no contexto de SISTEMA (bootstrap sem titular — TASK-1.1.4).
  userA = await tenant.runAsSystem(async (tx) => {
    const rows = (await tx.execute(
      sql`INSERT INTO users (phone_number, name) VALUES (${phone(1)}, 'A (teste US-1.1)') RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    return rows[0].id;
  });
  userB = await tenant.runAsSystem(async (tx) => {
    const rows = (await tx.execute(
      sql`INSERT INTO users (phone_number, name) VALUES (${phone(2)}, 'B (teste US-1.1)') RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    return rows[0].id;
  });

  // Fixture pelo superusuario: o runtime nao possui INSERT direto em consents;
  // producao grava apenas pela funcao estreita record_session_consent.
  await adminClient`
    INSERT INTO consents (user_id, consent_type, version, accepted)
    VALUES
      (${userA}::uuid, 'HEALTH_DATA', ${CONSENT_TEXTS.HEALTH_DATA.version}, true),
      (${userB}::uuid, 'HEALTH_DATA', ${CONSENT_TEXTS.HEALTH_DATA.version}, true)
  `;
  const [professional] = await adminClient<{ id: string }[]>`
    INSERT INTO users (phone_number, name, role, cref_number, cref_region, cref_active)
    VALUES (${phone(3)}, 'CREF (teste Sprint 5)', 'PROFESSIONAL', '900001', 'SP', true)
    RETURNING id
  `;
  professionalId = professional.id;
  await adminClient`
    INSERT INTO professional_assignments (professional_id, user_id)
    VALUES (${professionalId}::uuid, ${userA}::uuid)
  `;
}, 60_000);

afterAll(async () => {
  try {
    // Superusuário bypassa RLS (inclusive o append-only por RLS de consents) só p/ limpar.
    await adminClient.unsafe(
      `DELETE FROM professional_assignments
         WHERE professional_id = '${professionalId}' OR user_id IN ('${userA}','${userB}');
       DELETE FROM consents WHERE user_id IN ('${userA}','${userB}');
       -- \`audit_logs\` é append-only por trigger (imutável até para o superusuário). O titular
       -- que ficou com trilha de revogação é preservado — apagá-lo destruiria a prova.
       DELETE FROM users WHERE id IN ('${userA}','${userB}','${professionalId}')
         AND id NOT IN (SELECT user_id FROM audit_logs WHERE user_id IS NOT NULL
                        UNION SELECT actor_id FROM audit_logs WHERE actor_id IS NOT NULL);`,
    );
  } finally {
    await adminClient.end({ timeout: 5 });
    await appClient.end({ timeout: 5 });
  }
});

describe('RLS FORCE + SET LOCAL — isolamento entre titulares', () => {
  it('PROFESSIONAL enxerga somente o titular atribuído com consentimento ativo', async () => {
    const rows = await tenant.runAsUser(professionalId, 'PROFESSIONAL', async (tx) => {
      return (await tx.execute(
        sql`SELECT id FROM users WHERE id IN (${userA}, ${userB}) ORDER BY id`,
      )) as unknown as Array<{ id: string }>;
    });
    expect(rows.map((row) => row.id)).toEqual([userA]);
  });

  it('revogacao oculta o titular do PROFESSIONAL sem recursao e preserva contexto segregado', async () => {
    const rollback = new Error('rollback esperado');
    await expect(
      appClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_role', 'USER', true)`;
        await tx`SELECT set_config('app.current_user_id', ${userA}, true)`;
        await tx`SELECT public.revoke_health_data_consent(${userA}::uuid)`;

        await tx`SELECT set_config('app.current_role', 'PROFESSIONAL', true)`;
        await tx`SELECT set_config('app.current_user_id', ${professionalId}, true)`;
        const professionalUsers = await tx`SELECT id FROM users WHERE id = ${userA}::uuid`;
        const professionalConsents = await tx`
          SELECT id FROM consents WHERE user_id = ${userA}::uuid
        `;
        expect(professionalUsers).toHaveLength(0);
        expect(professionalConsents).toHaveLength(0);

        await tx`SELECT set_config('app.current_role', 'SYSTEM', true)`;
        await tx`SELECT set_config('app.current_user_id', '', true)`;
        const preserved = await tx`
          SELECT id FROM consents WHERE user_id = ${userA}::uuid AND revoked_at IS NOT NULL
        `;
        expect(preserved.length).toBeGreaterThan(0);

        await tx`SELECT set_config('app.current_role', 'ADMIN', true)`;
        const adminVisible = await tx`SELECT id FROM users WHERE id = ${userA}::uuid`;
        expect(adminVisible).toHaveLength(1);
        const [adminProtocols] = await tx<{ count: number }[]>`
          SELECT count(*)::int AS count FROM protocols
        `;
        expect(adminProtocols?.count).toBeGreaterThanOrEqual(0);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it('SUPPORT lê cadastro de titular final, mas nenhum dado de saúde', async () => {
    const rollback = new Error('rollback esperado');
    await expect(
      appClient.begin(async (tx) => {
        // Um agente de suporte é um `users` com role SUPPORT — criado aqui e desfeito
        // no rollback, sem sujar o banco compartilhado da suíte.
        await tx`SELECT set_config('app.current_role', 'SYSTEM', true)`;
        await tx`SELECT set_config('app.current_user_id', '', true)`;
        const [agent] = await tx<{ id: string }[]>`
          INSERT INTO users (phone_number, name, role)
          VALUES (${phone(4)}, 'Suporte (teste A2)', 'SUPPORT') RETURNING id
        `;

        await tx`SELECT set_config('app.current_role', 'SUPPORT', true)`;
        await tx`SELECT set_config('app.current_user_id', ${agent.id}, true)`;

        // Vê o titular final (users.role = 'USER')…
        const visible = await tx`SELECT id FROM users WHERE id IN (${userA}, ${userB})`;
        expect(visible).toHaveLength(2);
        // …e NÃO vê o profissional CREF (papel de staff, não é titular final).
        const staff = await tx`SELECT id FROM users WHERE id = ${professionalId}::uuid`;
        expect(staff).toHaveLength(0);
        // Nenhum dado de saúde: sem policy para SUPPORT nessas tabelas, fail-closed.
        expect(await tx`SELECT id FROM anamnesis_sessions`).toHaveLength(0);
        expect(await tx`SELECT id FROM protocols`).toHaveLength(0);
        expect(await tx`SELECT id FROM consents`).toHaveLength(0);

        // A3: consegue registrar a própria trilha de acesso em massa…
        await tx`
          INSERT INTO audit_logs (actor_id, user_id, action, entity_type, entity_id, changes, row_hash)
          VALUES (${agent.id}::uuid, ${agent.id}::uuid, 'SUPPORT_CUSTOMER_LIST_VIEWED',
                  'support_customer_list', ${agent.id}::uuid, '{"recordCount":2}'::jsonb, repeat('0', 64))
        `;
        // …mas não consegue forjar um evento atribuído a outro titular.
        await expect(
          tx`
            INSERT INTO audit_logs (actor_id, user_id, action, entity_type, entity_id, changes, row_hash)
            VALUES (${agent.id}::uuid, ${userA}::uuid, 'FORJADO', 'x', ${userA}::uuid, '{}'::jsonb, repeat('0', 64))
          `,
        ).rejects.toThrow();
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it('runAsUser(A) vê o consentimento de A e NÃO vê o de B', async () => {
    const rows = await tenant.runAsUser(userA, 'USER', async (tx) => {
      return (await tx.execute(sql`SELECT user_id FROM consents`)) as unknown as Array<{
        user_id: string;
      }>;
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.user_id === userA)).toBe(true);
    expect(rows.some((r) => r.user_id === userB)).toBe(false);
  });

  it('runAsUser(B) não enxerga a linha de A (isolamento recíproco no mesmo pool)', async () => {
    const rows = await tenant.runAsUser(userB, 'USER', async (tx) => {
      return (await tx.execute(
        sql`SELECT user_id FROM consents WHERE user_id = ${userA}`,
      )) as unknown as unknown[];
    });
    expect(rows).toHaveLength(0);
  });

  it('sem contexto de tenant, a app (movivo_app) não lê nada — fail-closed', async () => {
    const rows = (await db.execute(
      sql`SELECT user_id FROM consents WHERE user_id IN (${userA}, ${userB})`,
    )) as unknown as unknown[];
    expect(rows).toHaveLength(0);
  });
});

describe('movivo_app não pode burlar a RLS (TASK-1.8.2b — atributos da role)', () => {
  // Estes asserts FALHAM o pipeline se alguém conceder BYPASSRLS a movivo_app ou
  // torná-la dona das tabelas — as duas formas de anular a RLS FORCE sem tocar em
  // política nenhuma. São a prova de que o isolamento não depende só das policies.
  it('a role de aplicação não tem BYPASSRLS nem SUPERUSER', async () => {
    const rows = (await db.execute(
      sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'movivo_app'`,
    )) as unknown as Array<{ rolbypassrls: boolean; rolsuper: boolean }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].rolbypassrls).toBe(false);
    expect(rows[0].rolsuper).toBe(false);
  });

  it('movivo_app não é dona de nenhuma tabela de titular (dono ignora FORCE)', async () => {
    const owners = (await db.execute(
      sql`SELECT tablename, tableowner FROM pg_tables
          WHERE tablename IN ('users','consents','anamnesis_sessions','auth_sessions')`,
    )) as unknown as Array<{ tablename: string; tableowner: string }>;
    expect(owners.length).toBeGreaterThanOrEqual(4);
    expect(owners.every((r) => r.tableowner !== 'movivo_app')).toBe(true);
  });
});

describe('Anamnese anônima — token-scoped e IDOR (TASK-1.1.4 / Sato §8.1)', () => {
  const tokenA = `tkA_${RUN}_${'a'.repeat(40)}`.slice(0, 64);
  const tokenB = `tkB_${RUN}_${'b'.repeat(40)}`.slice(0, 64);

  beforeAll(async () => {
    await tenant.runAsToken(async (tx) => {
      await tx.execute(
        sql`INSERT INTO anamnesis_sessions (token, expires_at) VALUES (${tokenA}, now() + interval '72 hours')`,
      );
      await tx.execute(
        sql`INSERT INTO anamnesis_sessions (token, expires_at) VALUES (${tokenB}, now() + interval '72 hours')`,
      );
    });
  });

  afterAll(async () => {
    await adminClient.unsafe(
      `DELETE FROM anamnesis_sessions WHERE token IN ('${tokenA}','${tokenB}')`,
    );
  });

  it('o acesso anônimo filtra por token: token A retorna só a sessão A', async () => {
    const rows = await tenant.runAsToken(async (tx) => {
      return (await tx.execute(
        sql`SELECT token FROM anamnesis_sessions WHERE token = ${tokenA}`,
      )) as unknown as Array<{ token: string }>;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].token).toBe(tokenA);
  });

  it('sessão vinculada a um titular fica sob RLS: B não a vê, A vê', async () => {
    // Submit: vincula a sessão A ao usuário A (contexto de sistema).
    await tenant.runAsSystem(async (tx) => {
      await tx.execute(
        sql`UPDATE anamnesis_sessions SET user_id = ${userA}, status = 'SUBMITTED' WHERE token = ${tokenA}`,
      );
    });

    const seenByB = await tenant.runAsUser(userB, 'USER', async (tx) => {
      return (await tx.execute(
        sql`SELECT id FROM anamnesis_sessions WHERE user_id = ${userA}`,
      )) as unknown as unknown[];
    });
    expect(seenByB).toHaveLength(0);

    const seenByA = await tenant.runAsUser(userA, 'USER', async (tx) => {
      return (await tx.execute(sql`SELECT token FROM anamnesis_sessions`)) as unknown as Array<{
        token: string;
      }>;
    });
    expect(seenByA.some((r) => r.token === tokenA)).toBe(true);
  });
});

describe('Cifra pgcrypto do dado de saúde (TASK-1.1.3)', () => {
  it('round-trip: decryptHealth(encryptHealth(x)) === x', async () => {
    const plaintext = JSON.stringify({ parq_dor_toracica: true, medicacao: 'exemplo' });
    const ciphertext = await cipher.encryptHealth(plaintext);
    expect(Buffer.isBuffer(ciphertext)).toBe(true);
    // O ciphertext não contém o plaintext em claro.
    expect(ciphertext.toString('utf8')).not.toContain('medicacao');
    const decrypted = await cipher.decryptHealth(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it('a chave errada não decifra (a cifra depende mesmo do segredo)', async () => {
    const ciphertext = await cipher.encryptHealth('segredo');
    const wrong = new HealthCipherService(db, { pgcryptoKey: 'chave-errada' } as never);
    await expect(wrong.decryptHealth(ciphertext)).rejects.toBeTruthy();
  });
});
