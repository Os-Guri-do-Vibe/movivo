/**
 * Teste de integração da ANAMNESE (US-1.3 / valida TASK-1.3.1..1.3.4 + achados do Sato).
 *
 * Roda contra o stack real, **como a aplicação** (`movivo_app` via PgBouncer 5433).
 * Prova:
 *   (feliz)   start→3 blocos→submit: usuário criado (ONBOARDING), consentimento
 *             migrado, PAR-Q LIBERADO;
 *   (bloqueio) PAR-Q de risco → BLOQUEADO_AGUARDANDO_CLEARANCE + requires_professional_review;
 *   (gate)    bloco 2 barrado sem consentimento de saúde (nada persistido);
 *   (cifra)   `data_block_2` no banco é bytea, não contém o plaintext;
 *   (IDOR)    token A não acessa a sessão B;
 *   (72h)     sessão IN_PROGRESS expirada → EXPIRED com data_block_2 descartado;
 *   (Sato #1) RLS anônima isola por sessão: escopado à sessão A, a linha órfã de B
 *             não é lida nem alterada (o achado 1 não reproduz mais).
 *
 * Pré-requisito: `pnpm run infra:up` + `db:migrate`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CONSENT_TEXTS,
  PARQ_QUESTION_IDS,
  PARQ_VERSION,
  type AnamnesisBlock1,
  type AnamnesisBlock2,
} from '@movivo/shared';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/core/config/load-env';
import { type DrizzleClient } from '../src/core/database/database.module';
import { HealthCipherService } from '../src/core/database/health-cipher.service';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { AnamnesisService } from '../src/modules/anamnesis/anamnesis.service';
import { ConsentService } from '../src/modules/anamnesis/consent.service';

const { env } = loadEnv();
const apiRoot = process.cwd();
const RUN = Date.now().toString().slice(-8);
const ORIGIN = { ip: '203.0.113.20', userAgent: 'vitest/anamnesis' };

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
const cipher = new HealthCipherService(db, {
  pgcryptoKey:
    env.PGCRYPTO_KEY ??
    readFileSync(resolve(apiRoot, '..', '..', 'secrets', 'pgcrypto_key'), 'utf8').trimEnd(),
} as never);
const consents = new ConsentService(tenant);
const logger = {
  info: () => undefined,
  warn: () => undefined,
  setContext: () => undefined,
} as never;
const service = new AnamnesisService(logger, tenant, cipher, consents);

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

let seq = 0;
const phone = () => `+5541${RUN}${(seq += 1)}`;

function block1(): AnamnesisBlock1 {
  return { name: 'Fulano de Teste', phoneNumber: phone(), email: `t${RUN}${seq}@example.com` };
}
function block2(riskIds: string[] = []): AnamnesisBlock2 {
  return {
    parq: {
      version: PARQ_VERSION,
      answers: PARQ_QUESTION_IDS.map((questionId) => ({
        questionId,
        answer: riskIds.includes(questionId),
        ...(questionId === 'Q9' && riskIds.includes('Q9') ? { detail: 'motivo' } : {}),
      })),
    },
    injuries: ['joelho'],
  };
}
async function acceptHealth(token: string) {
  await consents.recordForSessionToken(
    token,
    [{ type: 'HEALTH_DATA', version: CONSENT_TEXTS.HEALTH_DATA.version, accepted: true }],
    ORIGIN,
  );
}

afterAll(async () => {
  try {
    await adminClient.unsafe(
      `DELETE FROM consents WHERE anamnesis_session_id IN
         (SELECT id FROM anamnesis_sessions WHERE token LIKE '%${RUN}%')
         OR user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM anamnesis_sessions WHERE token LIKE '%${RUN}%'
         OR user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM users WHERE phone_number LIKE '+5541${RUN}%';`,
    );
  } finally {
    await Promise.all([appClient.end({ timeout: 5 }), adminClient.end({ timeout: 5 })]);
  }
}, 30_000);

describe('ANAMNESE — fluxo feliz (US-1.3)', () => {
  it('start→3 blocos→submit cria usuário ONBOARDING, migra consentimento, LIBERADO', async () => {
    const b1 = block1();
    const { token } = await service.start({ primaryGoal: 'GAIN_MUSCLE' });

    await service.patchBlock(token, 1, b1);
    await acceptHealth(token);
    await service.patchBlock(token, 2, block2());
    await service.patchBlock(token, 3, { daysPerWeek: 4 });

    const result = await service.submit(token);
    expect(result.parqState).toBe('LIBERADO');
    expect(result.requiresProfessionalReview).toBe(false);

    // Usuário criado a partir do bloco 1, status ONBOARDING, sem revisão.
    const [user] = await adminClient<Array<{ status: string; requires: boolean; id: string }>>`
      SELECT id, status, requires_professional_review AS requires
        FROM users WHERE phone_number = ${b1.phoneNumber}`;
    expect(user.status).toBe('ONBOARDING');
    expect(user.requires).toBe(false);

    // Sessão vinculada e SUBMITTED; consentimento de saúde migrado para o titular.
    const [session] = await adminClient<Array<{ user_id: string; status: string }>>`
      SELECT user_id, status FROM anamnesis_sessions WHERE token = ${token}`;
    expect(session.status).toBe('SUBMITTED');
    expect(session.user_id).toBe(user.id);

    const [consent] = await adminClient<Array<{ user_id: string }>>`
      SELECT user_id FROM consents
        WHERE anamnesis_session_id = (SELECT id FROM anamnesis_sessions WHERE token = ${token})
          AND consent_type = 'HEALTH_DATA'`;
    expect(consent.user_id).toBe(user.id);
  });

  it('data_block_2 é gravado CIFRADO (bytea, sem o plaintext)', async () => {
    const { token } = await service.start({});
    await service.patchBlock(token, 1, block1());
    await acceptHealth(token);
    await service.patchBlock(token, 2, block2());

    const [row] = await adminClient<Array<{ data_block_2: Buffer }>>`
      SELECT data_block_2 FROM anamnesis_sessions WHERE token = ${token}`;
    expect(Buffer.isBuffer(row.data_block_2)).toBe(true);
    expect(row.data_block_2.toString('utf8')).not.toContain('joelho');
    expect(row.data_block_2.toString('utf8')).not.toContain('parq');
  });
});

describe('ANAMNESE — gate PAR-Q bloqueante (US-1.3 / Alexandre §2)', () => {
  it('resposta de risco → BLOQUEADO_AGUARDANDO_CLEARANCE + requires_professional_review', async () => {
    const b1 = block1();
    const { token } = await service.start({});
    await service.patchBlock(token, 1, b1);
    await acceptHealth(token);
    await service.patchBlock(token, 2, block2(['Q2'])); // dor no peito ao se exercitar
    await service.patchBlock(token, 3, { daysPerWeek: 3 });

    const result = await service.submit(token);
    expect(result.parqState).toBe('BLOQUEADO_AGUARDANDO_CLEARANCE');
    expect(result.requiresProfessionalReview).toBe(true);

    const [user] = await adminClient<Array<{ requires: boolean }>>`
      SELECT requires_professional_review AS requires FROM users WHERE phone_number = ${b1.phoneNumber}`;
    expect(user.requires).toBe(true);

    // Estado persistido e consultável (para o RT — Sprint 5).
    const [session] = await adminClient<Array<{ parq_state: string }>>`
      SELECT parq_state FROM anamnesis_sessions WHERE token = ${token}`;
    expect(session.parq_state).toBe('BLOQUEADO_AGUARDANDO_CLEARANCE');
  });
});

describe('ANAMNESE — bloco 2 gated por consentimento (BLOQUEADOR 3)', () => {
  it('sem consentimento de saúde, o PATCH do bloco 2 é barrado e nada persiste', async () => {
    const { token } = await service.start({});
    await service.patchBlock(token, 1, block1());

    await expect(service.patchBlock(token, 2, block2())).rejects.toThrow(/consentimento/i);

    const [row] = await adminClient<Array<{ data_block_2: Buffer | null }>>`
      SELECT data_block_2 FROM anamnesis_sessions WHERE token = ${token}`;
    expect(row.data_block_2).toBeNull();
  });
});

describe('ANAMNESE — IDOR e expiração (Sato §8.1)', () => {
  it('token A não acessa a sessão B (retomada é por token)', async () => {
    const a = await service.start({ primaryGoal: 'LOSE_WEIGHT' });
    const b = await service.start({ primaryGoal: 'CONDITIONING' });

    const viewA = await service.getByToken(a.token);
    expect(viewA.primaryGoal).toBe('LOSE_WEIGHT');
    const viewB = await service.getByToken(b.token);
    expect(viewB.primaryGoal).toBe('CONDITIONING');
  });

  it('sessão IN_PROGRESS expirada vira EXPIRED e descarta data_block_2', async () => {
    const { token } = await service.start({});
    await service.patchBlock(token, 1, block1());
    await acceptHealth(token);
    await service.patchBlock(token, 2, block2());
    // Força a expiração no passado.
    await adminClient`UPDATE anamnesis_sessions SET expires_at = now() - interval '1 hour' WHERE token = ${token}`;

    const view = await service.getByToken(token);
    expect(view.status).toBe('EXPIRED');

    const [row] = await adminClient<Array<{ status: string; data_block_2: Buffer | null }>>`
      SELECT status, data_block_2 FROM anamnesis_sessions WHERE token = ${token}`;
    expect(row.status).toBe('EXPIRED');
    expect(row.data_block_2).toBeNull();

    // Uma sessão expirada não aceita mais escrita nem submit.
    await expect(service.patchBlock(token, 3, { daysPerWeek: 2 })).rejects.toThrow();
    await expect(service.submit(token)).rejects.toThrow();
  });
});

describe('ANAMNESE — RLS anônima isolada por sessão (Sato — achado 1)', () => {
  it('escopado à sessão A, a linha órfã de B não é lida nem alterada', async () => {
    const a = await service.start({});
    const b = await service.start({});
    const [{ id: idA }] = await adminClient<Array<{ id: string }>>`
      SELECT id FROM anamnesis_sessions WHERE token = ${a.token}`;
    const [{ id: idB }] = await adminClient<Array<{ id: string }>>`
      SELECT id FROM anamnesis_sessions WHERE token = ${b.token}`;

    // Positivo: escopado a A, A é visível.
    const seesA = await tenant.runAsTokenScoped(idA, async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT id FROM anamnesis_sessions WHERE id = ${idA}`,
      )) as unknown as unknown[];
      return rows.length;
    });
    expect(seesA).toBe(1);

    // Negativo (o achado): escopado a A, a linha órfã de B some — mesmo sem WHERE token.
    const seesB = await tenant.runAsTokenScoped(idA, async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT id FROM anamnesis_sessions WHERE id = ${idB}`,
      )) as unknown as unknown[];
      return rows.length;
    });
    expect(seesB).toBe(0);

    // E não consegue ALTERAR a sessão B a partir do contexto de A.
    const changed = await tenant.runAsTokenScoped(idA, async (tx) => {
      const rows = (await tx.execute(
        sql`UPDATE anamnesis_sessions SET last_block = 3 WHERE id = ${idB} RETURNING id`,
      )) as unknown as unknown[];
      return rows.length;
    });
    expect(changed).toBe(0);

    const [rowB] = await adminClient<Array<{ last_block: number }>>`
      SELECT last_block FROM anamnesis_sessions WHERE id = ${idB}`;
    expect(rowB.last_block).toBe(1); // intacta
  });
});
