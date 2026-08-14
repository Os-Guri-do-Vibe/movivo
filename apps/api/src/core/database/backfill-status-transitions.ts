/**
 * Backfill único de `user_status_transitions` (US-8.3 / TASK-8.3.3).
 *
 * Reconstrói os marcos passados a partir das datas que `subscriptions` já guarda, gravando
 * **sempre** com `actor = 'BACKFILL'` — dado reconstruído nunca se mistura com evento
 * observado. Uma coorte montada sobre reconstrução tem que se declarar como tal, e é o
 * `actor` que permite ao painel fazer essa declaração.
 *
 * ## O que é reconstruível, e o que não é
 *  - `TRIAL_STARTED` ← `subscriptions.created_at` (toda assinatura nasce `TRIALING`);
 *  - `CONVERTED`     ← `current_period_start` (proxy provisório — ver `subscription-lifecycle.ts`);
 *  - `CANCELED`      ← `canceled_at`.
 *
 * `PAUSED`, `RESUMED` e `RENEWED` **não** são reconstruídos: não existe nenhuma data no
 * schema atual que os localize no tempo. Inventá-los a partir do estado corrente produziria
 * uma sequência plausível e falsa — exatamente o erro silencioso que esta US existe para
 * matar. A partir do merge eles passam a ser observados em tempo real pelo repositório.
 *
 * ## Idempotência
 * `ON CONFLICT DO NOTHING` sobre `uq_user_status_transitions_event`
 * (`user_id, to_status, occurred_at`): rodar duas vezes converge para o mesmo estado.
 *
 * Roda pela conexão de **migração** (direta, `movivo_migrator`, com BYPASSRLS), como o seed.
 */
import { asc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { loadEnv } from '../config/load-env';
import {
  type LifecycleMarker,
  recordLifecycleTransition,
} from '../../modules/subscription/subscription-lifecycle';
import type { TenantTransaction } from './tenant-database.service';
import { subscriptions } from './schema';

const { env } = loadEnv();

const host = env.MIGRATION_DATABASE_HOST ?? env.DATABASE_HOST;
const port = Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT);
const user = env.MIGRATION_DATABASE_USER ?? 'movivo_migrator';
const password = env.MIGRATION_DATABASE_PASSWORD;
const database = env.DATABASE_NAME;

if (!host || !Number.isFinite(port) || !user || !password || !database) {
  throw new Error(
    '[db:backfill-transitions] Configuração incompleta. Defina MIGRATION_DATABASE_* em apps/api/.env.',
  );
}

async function main(): Promise<void> {
  const client = postgres({
    host,
    port,
    user,
    password,
    database,
    ssl: false,
    max: 1,
    idle_timeout: 5,
    onnotice: () => {
      /* notices podem conter valores — nunca vão para o log. */
    },
  });

  try {
    const db = drizzle(client);
    const rows = await db
      .select({
        userId: subscriptions.userId,
        createdAt: subscriptions.createdAt,
        currentPeriodStart: subscriptions.currentPeriodStart,
        canceledAt: subscriptions.canceledAt,
      })
      .from(subscriptions)
      .orderBy(asc(subscriptions.createdAt));

    let written = 0;
    for (const row of rows) {
      // Ordem cronológica dentro do titular: `from_status` é lido da última linha já
      // gravada, então inserir fora de ordem produziria uma cadeia invertida.
      const markers: ReadonlyArray<[LifecycleMarker, Date | null]> = [
        ['TRIAL_STARTED', row.createdAt],
        ['CONVERTED', row.currentPeriodStart],
        ['CANCELED', row.canceledAt],
      ];

      for (const [toStatus, occurredAt] of markers) {
        if (!occurredAt) continue;
        await db.transaction(async (tx) => {
          await recordLifecycleTransition(tx as unknown as TenantTransaction, {
            userId: row.userId,
            toStatus,
            actor: 'BACKFILL',
            occurredAt,
            reason: 'reconstruido de subscriptions',
          });
        });
        written += 1;
      }
    }

    console.warn(
      `[db:backfill-transitions] ${rows.length} assinatura(s) varrida(s), ` +
        `${written} marco(s) tentado(s) (duplicatas ignoradas por ON CONFLICT).`,
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
