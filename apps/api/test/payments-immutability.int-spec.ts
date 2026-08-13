/**
 * Teste de integração da US-8.5 contra Postgres real. Prova as três garantias que só
 * existem no banco — nenhuma delas é demonstrável com mock, e as três são exatamente as
 * que protegem a superfície externa de escrita mais sensível do produto:
 *
 *  (a) **Idempotência é constraint, não código.** O segundo insert do mesmo
 *      (`gateway`, `gateway_event_id`) falha com 23505. É isto — e não uma checagem
 *      `select`-antes-do-`insert`, que tem janela de corrida — que garante que o gateway
 *      reentregando 5× produza 1 linha.
 *
 *  (b) **`payments` é append-only.** A role de runtime (`movivo_app`) não consegue UPDATE
 *      nem DELETE (42501, barrado no privilégio antes de chegar ao trigger); a role de
 *      migração (`movivo_migrator`, que mantém o grant) esbarra no trigger (55000). Mesma
 *      divisão de barreiras de `expenses` e `agent_config`.
 *
 *  (c) **Estorno é linha nova de sinal contrário.** A linha da cobrança original continua
 *      intacta e `sum(amount_cents)` devolve o líquido sem nenhum CASE.
 *
 * Pré-requisito: `pnpm run infra:up` + `db:migrate`.
 */
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/core/config/load-env';

const { env } = loadEnv();
const RUN = Date.now().toString().slice(-8);
const GATEWAY = `MOCK_TEST_${RUN}`;
const EVENT_ID = `evt_${RUN}`;

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

let paymentId: string;

beforeAll(async () => {
  const [row] = await migratorClient<{ id: string }[]>`
    INSERT INTO public.payments
      (gateway, gateway_event_id, status, amount_cents, net_amount_cents, occurred_at, raw_payload)
    VALUES (${GATEWAY}, ${EVENT_ID}, 'SETTLED', 3900, 3750, now(), ${'{"seed":true}'}::jsonb)
    RETURNING id
  `;
  if (!row) throw new Error('Falha ao inserir a liquidação de teste.');
  paymentId = row.id;
});

afterAll(async () => {
  // `payments` é append-only por construção — a limpeza precisa da role de migração e de
  // desabilitar o trigger, exatamente como o teste de `audit_logs`/`expenses` faz.
  await migratorClient`ALTER TABLE public.payments DISABLE TRIGGER trg_payments_immutable`;
  await migratorClient`DELETE FROM public.payments WHERE gateway = ${GATEWAY}`;
  await migratorClient`ALTER TABLE public.payments ENABLE TRIGGER trg_payments_immutable`;
  await Promise.all([appClient.end(), migratorClient.end()]);
});

describe('payments — idempotência pela UNIQUE do banco (US-8.5 / TASK-8.5.1)', () => {
  it('reentrega do mesmo evento pelo gateway não cria segunda linha', async () => {
    // 4 reentregas além do insert do `beforeAll` = as 5× do gate mensurável da sprint.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(
        migratorClient`
          INSERT INTO public.payments
            (gateway, gateway_event_id, status, amount_cents, net_amount_cents, occurred_at, raw_payload)
          VALUES (${GATEWAY}, ${EVENT_ID}, 'SETTLED', 3900, 3750, now(), ${'{}'}::jsonb)
        `,
      ).rejects.toMatchObject({ code: '23505' });
    }

    const [row] = await migratorClient<{ total: number; amount: number }[]>`
      SELECT count(*)::int AS total, coalesce(sum(amount_cents), 0)::int AS amount
      FROM public.payments WHERE gateway = ${GATEWAY}
    `;
    // 1 linha e 0 alteração de número — exatamente o gate da Definição de Pronto.
    expect(row?.total).toBe(1);
    expect(row?.amount).toBe(3900);
  });

  it('o MESMO event_id em outro gateway é outro evento e entra', async () => {
    await expect(
      migratorClient`
        INSERT INTO public.payments
          (gateway, gateway_event_id, status, amount_cents, net_amount_cents, occurred_at, raw_payload)
        VALUES (${GATEWAY + '_B'}, ${EVENT_ID}, 'SETTLED', 100, 100, now(), ${'{}'}::jsonb)
      `,
    ).resolves.toBeDefined();
    await migratorClient`ALTER TABLE public.payments DISABLE TRIGGER trg_payments_immutable`;
    await migratorClient`DELETE FROM public.payments WHERE gateway = ${GATEWAY + '_B'}`;
    await migratorClient`ALTER TABLE public.payments ENABLE TRIGGER trg_payments_immutable`;
  });
});

describe('payments append-only (US-8.5 / TASK-8.5.1)', () => {
  it('a role de runtime não consegue alterar nem apagar uma liquidação', async () => {
    await expect(
      appClient`UPDATE public.payments SET amount_cents = 1 WHERE id = ${paymentId}::uuid`,
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      appClient`DELETE FROM public.payments WHERE id = ${paymentId}::uuid`,
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('o trigger barra a alteração mesmo para quem ainda tem o privilégio', async () => {
    await expect(
      migratorClient`UPDATE public.payments SET amount_cents = 1 WHERE id = ${paymentId}::uuid`,
    ).rejects.toMatchObject({ code: '55000' });

    const [row] = await migratorClient<{ amount_cents: number }[]>`
      SELECT amount_cents FROM public.payments WHERE id = ${paymentId}::uuid
    `;
    expect(row?.amount_cents).toBe(3900);
  });

  it('estorno é linha NOVA de sinal contrário; a original fica intacta e a soma sai líquida', async () => {
    // Sob o mesmo contexto que `TenantDatabase.runAsSystem` monta para o worker: a RLS de
    // `payments` é FORCE, então uma liquidação órfã (sem titular) só entra como SYSTEM.
    // Append-only não é read-only — a role de runtime continua podendo INSERIR.
    await expect(
      appClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_role', 'SYSTEM', true)`;
        return tx`
          INSERT INTO public.payments
            (gateway, gateway_event_id, status, amount_cents, net_amount_cents, occurred_at, raw_payload)
          VALUES (${GATEWAY}, ${EVENT_ID + '_refund'}, 'REFUNDED', -3900, -3750, now(), '{}'::jsonb)
        `;
      }),
    ).resolves.toBeDefined();

    const [row] = await migratorClient<{ total: number; amount: number; original: number }[]>`
      SELECT
        count(*)::int AS total,
        coalesce(sum(amount_cents), 0)::int AS amount,
        (SELECT amount_cents FROM public.payments WHERE id = ${paymentId}::uuid) AS original
      FROM public.payments WHERE gateway = ${GATEWAY}
    `;
    expect(row?.total).toBe(2);
    // `sum` já devolve o líquido sem nenhum CASE — a propriedade que justifica o sinal.
    expect(row?.amount).toBe(0);
    expect(row?.original).toBe(3900);
  });
});
