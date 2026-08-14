/**
 * Teste de integração da US-8.7 contra Postgres real (TASK-8.9.2 / TASK-8.9.4).
 *
 * `partners` **não** é append-only — é versionada por vigência, e fechar uma composição é
 * um `UPDATE valid_to`. A garantia que só existe no banco é outra: a constraint trigger
 * `trg_partners_share_total`, DEFERRABLE INITIALLY DEFERRED, que verifica **no commit**
 * que a soma das linhas vigentes é exatamente 10.000 bps.
 *
 * `partners.service.spec.ts` já prova que o serviço rejeita a composição errada com 400
 * antes de tocar o banco. Este teste prova a outra metade — a rede que pega SQL manual,
 * migração e qualquer caminho que não passe pelo serviço:
 *
 *  (a) composição que não fecha 10.000 bps é rejeitada **no commit** (23514);
 *  (b) o estado intermediário inválido dentro da transação é tolerado (é para isso que o
 *      trigger é DEFERRED) e um estado final válido passa;
 *  (c) o cap table semeado já fecha exatamente 10.000 bps.
 *
 * Pré-requisito: `pnpm run infra:up` + `db:migrate`.
 */
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/core/config/load-env';

const { env } = loadEnv();

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

/** Sentinela para desfazer uma transação cujo commit não interessa executar. */
const ROLLBACK = new Error('rollback proposital do teste');

afterAll(async () => {
  await migratorClient.end();
});

describe('partners — fechamento em 10.000 bps imposto pelo banco (US-8.7 / TASK-8.9.2)', () => {
  it('o cap table vigente semeado fecha exatamente 10.000 bps', async () => {
    const [row] = await migratorClient<{ total: number }[]>`
      SELECT coalesce(sum(share_basis_points), 0)::int AS total
      FROM public.partners WHERE valid_to IS NULL
    `;
    // Tolerância 0: em pontos-base inteiros a conferência é exata por construção.
    expect(row?.total).toBe(10000);
  });

  it('sócio novo sem fechar a participação de ninguém é rejeitado NO COMMIT', async () => {
    // 10.000 + 500 = 10.500 bps. Nada barra o INSERT em si — o erro só aparece no commit,
    // que é exatamente o modo de falha que um `INSERT` manual produziria em produção.
    await expect(
      migratorClient.begin(async (tx) => {
        await tx`
          INSERT INTO public.partners (name, share_basis_points, valid_from)
          VALUES ('Sócio de teste', 500, '2026-08-13')
        `;
      }),
    ).rejects.toMatchObject({ code: '23514' });

    const [row] = await migratorClient<{ total: number; n: number }[]>`
      SELECT coalesce(sum(share_basis_points), 0)::int AS total, count(*)::int AS n
      FROM public.partners WHERE valid_to IS NULL
    `;
    expect(row?.total).toBe(10000);
    expect(row?.n).toBe(5);
  });

  it('fechar uma vigência sem abrir a substituta também é rejeitado no commit', async () => {
    await expect(
      migratorClient.begin(async (tx) => {
        await tx`
          UPDATE public.partners SET valid_to = '2026-08-13'
          WHERE valid_to IS NULL AND name = 'Rodrigo'
        `;
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('a troca completa passa pelo estado intermediário inválido e o estado final válido é aceito', async () => {
    await expect(
      migratorClient.begin(async (tx) => {
        // Estado intermediário: 0 bps vigente. Só não explode porque o trigger é DEFERRED.
        await tx`UPDATE public.partners SET valid_to = '2026-08-13' WHERE valid_to IS NULL`;
        await tx`
          INSERT INTO public.partners (name, share_basis_points, valid_from)
          VALUES ('Sócio A de teste', 6000, '2026-08-13'), ('Sócio B de teste', 4000, '2026-08-13')
        `;
        // Força a verificação agora, ainda dentro da transação: se o estado final de
        // 10.000 bps não passasse, isto levantaria 23514 no lugar do ROLLBACK.
        await tx`SET CONSTRAINTS trg_partners_share_total IMMEDIATE`;
        throw ROLLBACK;
      }),
    ).rejects.toBe(ROLLBACK);

    // A base fica exatamente como estava — a troca era só a prova, não uma mudança real.
    const [row] = await migratorClient<{ total: number; n: number }[]>`
      SELECT coalesce(sum(share_basis_points), 0)::int AS total, count(*)::int AS n
      FROM public.partners WHERE valid_to IS NULL
    `;
    expect(row?.total).toBe(10000);
    expect(row?.n).toBe(5);
  });
});
