/**
 * Teste de integração da US-8.6 contra Postgres real (TASK-8.9.2).
 *
 * `ad_spend` foi a quinta aplicação do molde append-only e a única que tinha subido sem
 * o int-spec correspondente — exatamente o risco que a jornada da US-8.9 nomeia ("o risco
 * não é técnico, é de esquecimento"). Prova as mesmas garantias de
 * `expenses-model-pricing.int-spec.ts` e `payments-immutability.int-spec.ts`:
 *
 *  (a) a role de runtime (`movivo_app`) não consegue UPDATE nem DELETE — 42501, barrado
 *      no privilégio antes de chegar ao trigger;
 *  (b) a role de migração (`movivo_migrator`, que mantém o grant) esbarra no trigger — 55000;
 *  (c) o grant efetivo em `information_schema.role_table_grants` é só SELECT/INSERT;
 *  (d) correção é estorno: linha nova de sinal contrário, a original intacta, e
 *      `sum(amount_cents)` devolve o líquido sem nenhum CASE.
 *
 * Pré-requisito: `pnpm run infra:up` + `db:migrate`.
 */
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/core/config/load-env';

const { env } = loadEnv();
const RUN = Date.now().toString().slice(-8);
const CAMPAIGN = `campanha-de-teste-${RUN}`;

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

let actorId: string;
let adSpendId: string;

beforeAll(async () => {
  const [actor] = await migratorClient<{ id: string }[]>`
    SELECT id FROM public.users ORDER BY created_at LIMIT 1
  `;
  if (!actor) throw new Error('Base sem usuário: rode `pnpm --filter @movivo/api run db:seed`.');
  actorId = actor.id;

  const [row] = await migratorClient<{ id: string }[]>`
    INSERT INTO public.ad_spend (channel, campaign, spent_on, amount_cents, created_by)
    VALUES ('meta_ads', ${CAMPAIGN}, '2026-07-10', 200000, ${actorId})
    RETURNING id
  `;
  if (!row) throw new Error('Falha ao inserir o investimento de teste.');
  adSpendId = row.id;
});

afterAll(async () => {
  // `ad_spend` é append-only por construção — a limpeza precisa da role de migração e de
  // desabilitar o trigger, igual à de `expenses` e `payments`.
  await migratorClient`ALTER TABLE public.ad_spend DISABLE TRIGGER trg_ad_spend_immutable`;
  await migratorClient`DELETE FROM public.ad_spend WHERE campaign = ${CAMPAIGN}`;
  await migratorClient`ALTER TABLE public.ad_spend ENABLE TRIGGER trg_ad_spend_immutable`;
  await Promise.all([appClient.end(), migratorClient.end()]);
});

describe('ad_spend append-only (US-8.6 / TASK-8.9.2)', () => {
  it('a role de runtime não consegue alterar nem apagar um lançamento de mídia', async () => {
    await expect(
      appClient`UPDATE public.ad_spend SET amount_cents = 1 WHERE id = ${adSpendId}::uuid`,
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      appClient`DELETE FROM public.ad_spend WHERE id = ${adSpendId}::uuid`,
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('o trigger barra a alteração mesmo para quem ainda tem o privilégio', async () => {
    await expect(
      migratorClient`UPDATE public.ad_spend SET amount_cents = 1 WHERE id = ${adSpendId}::uuid`,
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      migratorClient`DELETE FROM public.ad_spend WHERE id = ${adSpendId}::uuid`,
    ).rejects.toMatchObject({ code: '55000' });

    const [row] = await migratorClient<{ amount_cents: number }[]>`
      SELECT amount_cents FROM public.ad_spend WHERE id = ${adSpendId}::uuid
    `;
    expect(row?.amount_cents).toBe(200000);
  });

  it('o grant efetivo de movivo_app em ad_spend é só SELECT e INSERT', async () => {
    const grants = await migratorClient<{ privilege_type: string }[]>`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = 'ad_spend'
        AND grantee = ${env.DATABASE_USER ?? 'movivo_app'}
    `;
    expect(new Set(grants.map((grant) => grant.privilege_type))).toEqual(
      new Set(['SELECT', 'INSERT']),
    );
  });

  it('estorno é linha NOVA de sinal contrário; a original fica intacta e a soma sai líquida', async () => {
    // Append-only não é read-only: a role de runtime continua podendo INSERIR.
    await expect(
      appClient`
        INSERT INTO public.ad_spend
          (channel, campaign, spent_on, amount_cents, reverses_ad_spend_id, created_by)
        VALUES ('meta_ads', ${CAMPAIGN}, '2026-07-10', -200000, ${adSpendId}::uuid, ${actorId}::uuid)
      `,
    ).resolves.toBeDefined();

    // Um lançamento só pode ser estornado uma vez (uq_ad_spend_reversal).
    await expect(
      appClient`
        INSERT INTO public.ad_spend
          (channel, campaign, spent_on, amount_cents, reverses_ad_spend_id, created_by)
        VALUES ('meta_ads', ${CAMPAIGN}, '2026-07-10', -200000, ${adSpendId}::uuid, ${actorId}::uuid)
      `,
    ).rejects.toMatchObject({ code: '23505' });

    const [row] = await migratorClient<{ total: number; amount: number; original: number }[]>`
      SELECT
        count(*)::int AS total,
        coalesce(sum(amount_cents), 0)::int AS amount,
        (SELECT amount_cents FROM public.ad_spend WHERE id = ${adSpendId}::uuid) AS original
      FROM public.ad_spend WHERE campaign = ${CAMPAIGN}
    `;
    expect(row?.total).toBe(2);
    expect(row?.amount).toBe(0);
    expect(row?.original).toBe(200000);
  });
});
