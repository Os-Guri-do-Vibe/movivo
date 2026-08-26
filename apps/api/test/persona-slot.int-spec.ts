/**
 * Teste de integração da **persona por slot** (Sprint 11) contra o Postgres real.
 *
 * Duas coisas só existem no banco e por isso não têm como ser provadas por teste unitário:
 *
 *   (a) o **backfill idempotente** de `users.biological_sex` a partir de
 *       `anamnesis_sessions.data_block_1` (`USERS_BIOLOGICAL_SEX_BACKFILL_SQL`, aplicado
 *       pelo runner de migração). Ele é `UPDATE ... FROM (SELECT DISTINCT ON ...)`: a
 *       escolha da sessão mais recente e a idempotência dependem do planejador, não de
 *       lógica em TypeScript;
 *   (b) a **coexistência de `version = 1` nos dois slots**, que só é possível porque o
 *       UNIQUE passou a ser `(target_sex, version)`. É a precondição do bug que o rollback
 *       por slot evita — se o banco recusasse a segunda linha, o teste unitário de rollback
 *       estaria provando um cenário impossível.
 *
 * Escreve com a role de **migração** (é ela quem roda o backfill no fluxo real) e lê com o
 * repositório de runtime. Faz teardown do que dá: `users`/`anamnesis_sessions` são
 * apagáveis; `agent_config` é append-only por construção e as linhas de teste nascem
 * `DRAFT` com `version` altíssima, então nunca são lidas como persona vigente.
 *
 * Pré-requisito: `pnpm run infra:up` + `pnpm --filter @movivo/api run db:migrate`.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AgentConfigRepository } from '../src/core/agent-config/agent-config.repository';
import { loadEnv } from '../src/core/config/load-env';
import { type DrizzleClient } from '../src/core/database/database.module';
import { USERS_BIOLOGICAL_SEX_BACKFILL_SQL } from '../src/core/database/security-policies';

const { env } = loadEnv();
const RUN = Date.now().toString().slice(-8);

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
const repo = new AgentConfigRepository(drizzle(appClient) as unknown as DrizzleClient);

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
    /* idem */
  },
});

/** Titulares do teste: um com anamnese submetida, um sem nenhuma. */
let submittedUserId = '';
let withoutAnamnesisId = '';
let authorId = '';
/** Versão altíssima e única por execução — nunca colide com publicação real. */
const TEST_VERSION = 900_000 + Number(RUN.slice(-5));

beforeAll(async () => {
  const [submitted] = await migratorClient<{ id: string }[]>`
    INSERT INTO users (phone_number, name) VALUES (${`+5544${RUN}1`}, 'Backfill submetido')
    RETURNING id
  `;
  const [without] = await migratorClient<{ id: string }[]>`
    INSERT INTO users (phone_number, name) VALUES (${`+5544${RUN}2`}, 'Backfill sem anamnese')
    RETURNING id
  `;
  const [author] = await migratorClient<{ id: string }[]>`
    INSERT INTO users (phone_number, name) VALUES (${`+5544${RUN}3`}, 'Autor slot')
    RETURNING id
  `;
  if (!submitted || !without || !author) throw new Error('falha ao semear titulares do teste');
  submittedUserId = submitted.id;
  withoutAnamnesisId = without.id;
  authorId = author.id;

  // Duas sessões submetidas do MESMO titular, com valores divergentes: a mais recente
  // é a que deve vencer. É o caso que o `DISTINCT ON` existe para tornar determinístico.
  // `migratorClient.json(...)` e NÃO `JSON.stringify(...)::jsonb`: o postgres.js reencoda um
  // parâmetro string como escalar JSON, e o jsonb gravado vira o texto do objeto em vez do
  // objeto. Com isso `data_block_1 ->> 'biologicalSex'` seria sempre NULL e o backfill
  // "passaria" no teste sem nunca ter lido campo nenhum.
  await migratorClient`
    INSERT INTO anamnesis_sessions (user_id, token, expires_at, status, submitted_at, data_block_1)
    VALUES
      (${submittedUserId}::uuid, ${`slot-${RUN}-antiga`}, now() + interval '30 days',
       'SUBMITTED', now() - interval '10 days',
       ${migratorClient.json({ biologicalSex: 'MALE' })}),
      (${submittedUserId}::uuid, ${`slot-${RUN}-recente`}, now() + interval '30 days',
       'SUBMITTED', now() - interval '1 day',
       ${migratorClient.json({ biologicalSex: 'FEMALE' })})
  `;
}, 30_000);

afterAll(async () => {
  await migratorClient`DELETE FROM anamnesis_sessions WHERE user_id = ${submittedUserId}::uuid`;
  await migratorClient`
    DELETE FROM users WHERE id IN (${submittedUserId}::uuid, ${withoutAnamnesisId}::uuid)
  `;
  await appClient.end({ timeout: 5 });
  await migratorClient.end({ timeout: 5 });
});

describe('backfill de users.biological_sex a partir da anamnese (Sprint 11)', () => {
  it('preenche a partir da sessão submetida mais recente e ignora quem não tem anamnese', async () => {
    await migratorClient.unsafe(USERS_BIOLOGICAL_SEX_BACKFILL_SQL);

    const [filled] = await migratorClient<{ biological_sex: string | null }[]>`
      SELECT biological_sex FROM users WHERE id = ${submittedUserId}::uuid
    `;
    const [empty] = await migratorClient<{ biological_sex: string | null }[]>`
      SELECT biological_sex FROM users WHERE id = ${withoutAnamnesisId}::uuid
    `;

    expect(filled?.biological_sex).toBe('FEMALE');
    // Sem anamnese não há palpite: fica NULL. Nunca inferir por heurística (Sato).
    expect(empty?.biological_sex).toBeNull();
  });

  it('é idempotente: rodar de novo não muda nada e não sobrescreve valor já definido', async () => {
    // Simula um titular que corrigiu o dado depois do primeiro backfill.
    await migratorClient`
      UPDATE users SET biological_sex = 'MALE' WHERE id = ${submittedUserId}::uuid
    `;

    await migratorClient.unsafe(USERS_BIOLOGICAL_SEX_BACKFILL_SQL);
    await migratorClient.unsafe(USERS_BIOLOGICAL_SEX_BACKFILL_SQL);

    const [row] = await migratorClient<{ biological_sex: string | null }[]>`
      SELECT biological_sex FROM users WHERE id = ${submittedUserId}::uuid
    `;
    // O backfill só toca em `NULL` — o valor corrigido sobrevive a qualquer reexecução.
    expect(row?.biological_sex).toBe('MALE');
  });
});

describe('agent_config — dois slots independentes (Sprint 11)', () => {
  it('aceita a MESMA version nos dois slots e recusa duplicata dentro do slot', async () => {
    for (const slot of ['MALE', 'FEMALE'] as const) {
      await migratorClient`
        INSERT INTO agent_config (target_sex, version, status, payload, change_note, created_by)
        VALUES (
          ${slot}, ${TEST_VERSION}, 'DRAFT', ${JSON.stringify({})}::jsonb,
          'teste de integração Sprint 11 — nunca publicado', ${authorId}::uuid
        )
      `;
    }

    const rows = await migratorClient<{ target_sex: string }[]>`
      SELECT target_sex FROM agent_config WHERE version = ${TEST_VERSION} ORDER BY target_sex
    `;
    // `ORDER BY` num enum nativo usa o ORDINAL do tipo, não a ordem alfabética.
    expect([...rows.map((row) => row.target_sex)].sort()).toEqual(['FEMALE', 'MALE']);

    // Dentro do slot, a proteção contra duas publicações no mesmo número continua valendo.
    await expect(
      migratorClient`
        INSERT INTO agent_config (target_sex, version, status, payload, change_note, created_by)
        VALUES (
          'MALE', ${TEST_VERSION}, 'DRAFT', ${JSON.stringify({})}::jsonb,
          'duplicata no mesmo slot', ${authorId}::uuid
        )
      `,
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('a leitura de persona vigente é por slot e nunca enxerga a linha DRAFT do outro', async () => {
    for (const slot of ['MALE', 'FEMALE'] as const) {
      const active = await repo.activePayload(slot);
      expect(active?.version).not.toBe(TEST_VERSION);
    }
  });
});
