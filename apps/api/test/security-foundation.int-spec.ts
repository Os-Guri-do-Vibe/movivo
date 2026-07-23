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

  // Cada titular grava um consentimento no PRÓPRIO contexto (RLS por user_id).
  await tenant.runAsUser(userA, 'USER', async (tx) => {
    await tx.execute(
      sql`INSERT INTO consents (user_id, consent_type, version, accepted) VALUES (${userA}, 'HEALTH_DATA', '2026-07-v1', true)`,
    );
  });
  await tenant.runAsUser(userB, 'USER', async (tx) => {
    await tx.execute(
      sql`INSERT INTO consents (user_id, consent_type, version, accepted) VALUES (${userB}, 'HEALTH_DATA', '2026-07-v1', true)`,
    );
  });
}, 60_000);

afterAll(async () => {
  try {
    // Superusuário bypassa RLS (inclusive o append-only por RLS de consents) só p/ limpar.
    await adminClient.unsafe(
      `DELETE FROM consents WHERE user_id IN ('${userA}','${userB}');
       DELETE FROM users WHERE id IN ('${userA}','${userB}');`,
    );
  } finally {
    await adminClient.end({ timeout: 5 });
    await appClient.end({ timeout: 5 });
  }
});

describe('RLS FORCE + SET LOCAL — isolamento entre titulares', () => {
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
