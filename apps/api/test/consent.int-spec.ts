/**
 * Teste de integração do CONSENT (US-1.2 / valida TASK-1.2.1..1.2.3).
 *
 * Roda contra o stack real, **como a aplicação** (`movivo_app` via PgBouncer 5433),
 * e prova os invariantes que fazem o registro ser PROVA e não anotação:
 *   (a) independência das finalidades — saúde nunca inferido de marketing/termos;
 *   (b) idempotência por (âncora, finalidade, versão);
 *   (c) `hasValidHealthConsent` como trava real do Bloco 2 (BLOQUEADOR 3);
 *   (d) paridade texto↔versão — versão divergente é recusada;
 *   (e) revogação carimba `revoked_at` e **nunca** apaga a linha;
 *   (f) `movivo_app` não consegue DELETE em `consents` (append-only por RLS);
 *   (g) IDOR: token de uma sessão não registra consentimento em outra;
 *   (h) vínculo sessão→titular preserva a prova original.
 *
 * Pré-requisito: `pnpm run infra:up` + `db:migrate`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CONSENT_TEXTS } from '@movivo/shared';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/core/config/load-env';
import { type DrizzleClient } from '../src/core/database/database.module';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { ConsentService } from '../src/modules/anamnesis/consent.service';

const { env } = loadEnv();
const apiRoot = process.cwd();

const RUN = Date.now().toString().slice(-8);
const ORIGIN = { ip: '203.0.113.10', userAgent: 'vitest/consent' };

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
const service = new ConsentService(tenant);

const adminClient = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
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

/** Cria uma sessão de anamnese anônima e devolve `{ id, token }`. */
async function createSession(suffix: string): Promise<{ id: string; token: string }> {
  const token = `tok-${RUN}-${suffix}`.padEnd(40, 'x');
  const id = await tenant.runAsSystem(async (tx) => {
    const rows = (await tx.execute(
      sql`INSERT INTO anamnesis_sessions (token, expires_at)
          VALUES (${token}, now() + interval '72 hours') RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    return rows[0].id;
  });
  return { id, token };
}

let sessionA: { id: string; token: string };
let sessionB: { id: string; token: string };

beforeAll(async () => {
  sessionA = await createSession('a');
  sessionB = await createSession('b');
}, 60_000);

afterAll(async () => {
  try {
    await adminClient.unsafe(
      `DELETE FROM consents WHERE anamnesis_session_id IN
         (SELECT id FROM anamnesis_sessions WHERE token LIKE 'tok-${RUN}-%')
         OR user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5555${RUN}%');
       DELETE FROM anamnesis_sessions WHERE token LIKE 'tok-${RUN}-%';
       DELETE FROM users WHERE phone_number LIKE '+5555${RUN}%';`,
    );
  } finally {
    await Promise.all([appClient.end({ timeout: 5 }), adminClient.end({ timeout: 5 })]);
  }
}, 30_000);

/** Lê as linhas de consentimento de uma sessão via superusuário (visão crua). */
async function rowsOf(sessionId: string) {
  return adminClient<
    Array<{
      consent_type: string;
      version: string;
      accepted: boolean;
      revoked_at: Date | null;
      user_id: string | null;
      accepted_at: Date;
    }>
  >`SELECT consent_type, version, accepted, revoked_at, user_id, accepted_at
      FROM consents WHERE anamnesis_session_id = ${sessionId} ORDER BY consent_type`;
}

describe('CONSENT — prova de consentimento LGPD (US-1.2)', () => {
  it('(c) sem consentimento de saúde, o gate do Bloco 2 está FECHADO', async () => {
    await expect(service.hasValidHealthConsent(sessionA.id)).resolves.toBe(false);
  });

  it('(a) registra finalidades de forma INDEPENDENTE (saúde aceito, marketing recusado)', async () => {
    await service.recordForSessionToken(
      sessionA.token,
      [
        { type: 'HEALTH_DATA', version: CONSENT_TEXTS.HEALTH_DATA.version, accepted: true },
        { type: 'MARKETING', version: CONSENT_TEXTS.MARKETING.version, accepted: false },
      ],
      ORIGIN,
    );

    const rows = await rowsOf(sessionA.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.consent_type === 'HEALTH_DATA')?.accepted).toBe(true);
    // A recusa também é registrada — é prova de que foi perguntado.
    expect(rows.find((r) => r.consent_type === 'MARKETING')?.accepted).toBe(false);
  });

  it('(c) com saúde aceito, o gate do Bloco 2 ABRE', async () => {
    await expect(service.hasValidHealthConsent(sessionA.id)).resolves.toBe(true);
  });

  it('(b) reaceitar a MESMA versão é idempotente (não duplica a prova)', async () => {
    await service.recordForSessionToken(
      sessionA.token,
      [{ type: 'MARKETING', version: CONSENT_TEXTS.MARKETING.version, accepted: true }],
      ORIGIN,
    );

    const rows = await rowsOf(sessionA.id);
    expect(rows).toHaveLength(2); // continua 2, não 3
    expect(rows.find((r) => r.consent_type === 'MARKETING')?.accepted).toBe(true);
  });

  it('(d) recusa versão divergente da vigente (paridade texto↔versão)', async () => {
    await expect(
      service.recordForSessionToken(
        sessionA.token,
        [{ type: 'HEALTH_DATA', version: 'consent-health-2020-01-v0', accepted: true }],
        ORIGIN,
      ),
    ).rejects.toThrow(/desatualizada/i);
  });

  it('(g) IDOR: token de outra sessão não escreve na sessão A', async () => {
    await service.recordForSessionToken(
      sessionB.token,
      [{ type: 'HEALTH_DATA', version: CONSENT_TEXTS.HEALTH_DATA.version, accepted: true }],
      ORIGIN,
    );

    // A sessão A continua com exatamente as suas 2 linhas.
    expect(await rowsOf(sessionA.id)).toHaveLength(2);
    expect(await rowsOf(sessionB.id)).toHaveLength(1);
  });

  it('(g) token inexistente/expirado não registra nada', async () => {
    await expect(
      service.recordForSessionToken(
        'token-que-nao-existe'.padEnd(40, 'z'),
        [{ type: 'HEALTH_DATA', version: CONSENT_TEXTS.HEALTH_DATA.version, accepted: true }],
        ORIGIN,
      ),
    ).rejects.toThrow(/não encontrada|expirada/i);
  });

  it('(f) `movivo_app` NÃO consegue apagar consentimento (append-only)', async () => {
    const deleted = await tenant.runAsToken(async (tx) => {
      const res = (await tx.execute(
        sql`DELETE FROM consents WHERE anamnesis_session_id = ${sessionA.id} RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      return res.length;
    });

    expect(deleted).toBe(0);
    expect(await rowsOf(sessionA.id)).toHaveLength(2); // a prova sobreviveu
  });

  it('(h) vincula ao titular no submit preservando a prova original', async () => {
    const before = await rowsOf(sessionA.id);
    const acceptedAtBefore = before[0].accepted_at.getTime();

    const userId = await tenant.runAsSystem(async (tx) => {
      const rows = (await tx.execute(
        sql`INSERT INTO users (phone_number, name) VALUES (${`+5555${RUN}9`}, 'Titular US-1.2')
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      return rows[0].id;
    });

    await service.linkSessionToUser(sessionA.id, userId);

    const after = await rowsOf(sessionA.id);
    expect(after.every((r) => r.user_id === userId)).toBe(true);
    // `accepted_at` é do momento do aceite, não do vínculo.
    expect(after[0].accepted_at.getTime()).toBe(acceptedAtBefore);
  });

  it('(e) revogar carimba `revoked_at` sem apagar, e fecha o gate', async () => {
    const [{ id: userId }] = await adminClient<Array<{ id: string }>>`
      SELECT user_id AS id FROM consents WHERE anamnesis_session_id = ${sessionA.id} LIMIT 1`;

    await service.revoke(userId, 'HEALTH_DATA');

    const rows = await rowsOf(sessionA.id);
    expect(rows).toHaveLength(2); // nada apagado
    expect(rows.find((r) => r.consent_type === 'HEALTH_DATA')?.revoked_at).not.toBeNull();
    // Consentimento revogado não sustenta mais a coleta de saúde.
    await expect(service.hasValidHealthConsent(sessionA.id)).resolves.toBe(false);
  });
});
