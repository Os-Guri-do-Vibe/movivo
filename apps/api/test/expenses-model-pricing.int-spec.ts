/**
 * Teste de integração da US-8.4 contra Postgres real. Prova as duas garantias que só
 * existem no banco e que nenhum mock consegue demonstrar:
 *
 *  (a) **`expenses` é append-only** — a role de runtime (`movivo_app`) não consegue
 *      UPDATE nem DELETE (erro 42501, checado antes do trigger), e a role de migração
 *      (`movivo_migrator`, que mantém o grant) esbarra no trigger (55000). Mesmo padrão
 *      e mesma divisão de barreiras de `agent-config-immutability.int-spec.ts`.
 *
 *  (b) **preço de modelo é por vigência** — o custo de um job usa o preço vigente na
 *      DATA DO JOB. Registrar um preço novo hoje **não** pode alterar o custo apurado de
 *      um job de mês passado (gate mensurável da TASK-8.4.3).
 *
 * Pré-requisito: `pnpm run infra:up` + `db:migrate`.
 */
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/core/config/load-env';

const { env } = loadEnv();
const RUN = Date.now().toString().slice(-8);
const TEST_MODEL = `modelo-de-teste-${RUN}`;

const appClient = postgres({
  host: env.DATABASE_HOST ?? 'localhost',
  port: Number(env.DATABASE_PORT ?? 5433),
  user: env.DATABASE_USER ?? 'movivo_app',
  password: env.DATABASE_PASSWORD,
  database: env.DATABASE_NAME ?? 'movivo',
  ssl: false,
  max: 2,
  prepare: false,
  idle_timeout: 5,
  onnotice: () => {
    /* notices podem conter valores — nunca vão para o log do teste. */
  },
});

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

const app = drizzle(appClient);

let expenseId: string;

beforeAll(async () => {
  const [actor] = await migratorClient<{ id: string }[]>`
    SELECT id FROM public.users ORDER BY created_at LIMIT 1
  `;
  if (!actor) throw new Error('Base sem usuário: rode `pnpm --filter @movivo/api run db:seed`.');

  const [row] = await migratorClient<{ id: string }[]>`
    INSERT INTO public.expenses
      (occurred_on, amount_cents, category, supplier, description, created_by)
    VALUES ('2026-01-15', 12345, 'OUTROS', ${'fornecedor-' + RUN}, 'linha de teste', ${actor.id})
    RETURNING id
  `;
  if (!row) throw new Error('Falha ao inserir a despesa de teste.');
  expenseId = row.id;

  // Duas vigências do mesmo modelo: dobra de preço a partir de 01/08/2026.
  await migratorClient`
    INSERT INTO public.model_pricing
      (model, input_price_per_1k_cents, output_price_per_1k_cents, currency, valid_from, valid_to)
    VALUES
      (${TEST_MODEL}, 0.2, 0.8, 'USD', '2026-01-01', '2026-08-01'),
      (${TEST_MODEL}, 0.4, 1.6, 'USD', '2026-08-01', NULL)
  `;
});

afterAll(async () => {
  // `expenses` é append-only por construção — a linha de teste fica, como em audit_logs.
  await migratorClient`DELETE FROM public.model_pricing WHERE model = ${TEST_MODEL}`;
  await Promise.all([appClient.end(), migratorClient.end()]);
});

describe('expenses append-only (US-8.4)', () => {
  it('a role de runtime não consegue alterar nem apagar uma despesa', async () => {
    // drizzle-orm 0.45 embrulha o erro do driver em `DrizzleQueryError`; o SQLSTATE
    // do Postgres vive em `.cause.code`, não no topo do erro lançado.
    await expect(
      app.execute(sql`UPDATE public.expenses SET amount_cents = 1 WHERE id = ${expenseId}::uuid`),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    await expect(
      app.execute(sql`DELETE FROM public.expenses WHERE id = ${expenseId}::uuid`),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });

  it('o trigger barra a alteração mesmo para quem ainda tem o privilégio', async () => {
    await expect(
      migratorClient`UPDATE public.expenses SET amount_cents = 1 WHERE id = ${expenseId}::uuid`,
    ).rejects.toMatchObject({ code: '55000' });

    const [row] = await migratorClient<{ amount_cents: number }[]>`
      SELECT amount_cents FROM public.expenses WHERE id = ${expenseId}::uuid
    `;
    expect(row?.amount_cents).toBe(12345);
  });

  it('a role de runtime consegue inserir — append-only não é read-only', async () => {
    const [actor] = await migratorClient<{ id: string }[]>`
      SELECT id FROM public.users ORDER BY created_at LIMIT 1
    `;
    if (!actor) throw new Error('Base sem usuário: rode `pnpm --filter @movivo/api run db:seed`.');
    await expect(
      app.execute(sql`
        INSERT INTO public.expenses
          (occurred_on, amount_cents, category, supplier, description, created_by)
        VALUES ('2026-01-15', -12345, 'OUTROS', ${'fornecedor-' + RUN}, 'estorno de teste', ${actor.id}::uuid)
      `),
    ).resolves.toBeDefined();
  });
});

describe('model_pricing por vigência (US-8.4 / TASK-8.4.3)', () => {
  /** Mesma expressão do LATERAL de `control-center.service.ts`, exercida isoladamente. */
  const priceAt = async (day: string) => {
    const rows = await migratorClient<{ input_price_per_1k_cents: string }[]>`
      SELECT mp.input_price_per_1k_cents
      FROM public.model_pricing mp
      WHERE lower(${TEST_MODEL + '-2026-04-14'}) LIKE mp.model || '%'
        AND mp.valid_from <= ${day}::date
        AND (mp.valid_to IS NULL OR mp.valid_to > ${day}::date)
      ORDER BY length(mp.model) DESC, mp.valid_from DESC
      LIMIT 1
    `;
    return Number(rows[0]?.input_price_per_1k_cents);
  };

  it('um job de julho continua precificado pelo preço de julho depois da alta de agosto', async () => {
    expect(await priceAt('2026-07-20')).toBe(0.2);
    expect(await priceAt('2026-08-20')).toBe(0.4);
  });

  it('registrar preço novo hoje não reprecifica o passado', async () => {
    await migratorClient`
      INSERT INTO public.model_pricing
        (model, input_price_per_1k_cents, output_price_per_1k_cents, currency, valid_from)
      VALUES (${TEST_MODEL}, 9.9, 9.9, 'USD', '2026-12-01')
    `;
    expect(await priceAt('2026-07-20')).toBe(0.2);
    expect(await priceAt('2026-12-20')).toBe(9.9);
  });
});
