/**
 * Reenfileiramento único dos titulares que ficaram presos no gate de PAR-Q.
 *
 * ## Por que existe
 * Até 2026-08-24, `requires_professional_review = true` era TRAVA de geração: o job de
 * `protocol-generation` encerrava com `BLOCKED_PENDING_CLEARANCE` e o titular ficava numa
 * fila "PAR-Q para Revisão" separada, sem protocolo nenhum, até um RT liberar à mão. Essa
 * fila e essa ação deixaram de existir — o protocolo agora é sempre gerado (em modo
 * conservador, `reviewUrgency: MANDATORY`) e a liberação do PAR-Q acontece dentro da
 * assinatura dele.
 *
 * Quem já estava bloqueado no momento do deploy não tem gatilho nenhum: o submit já
 * aconteceu, o job já foi consumido e descartado, e a tela que o desbloquearia foi
 * removida. Sem este script, esses titulares ficam invisíveis para sempre. Ele é a
 * migração de DADOS que acompanha a migração de código.
 *
 * ## Como rodar (manual, uma vez, após o deploy da mudança)
 * ```sh
 * cd apps/api
 * pnpm exec tsx src/scripts/reenqueue-blocked-parq.ts
 * # simulação, sem enfileirar nada:
 * pnpm exec tsx src/scripts/reenqueue-blocked-parq.ts --dry-run
 * ```
 * Exige as mesmas variáveis de `apps/api/.env` que `db:migrate` (conexão de MIGRAÇÃO,
 * `movivo_migrator`, com BYPASSRLS — a varredura é global, não tem contexto de titular)
 * mais o bloco de Redis/Sentinel que a API já usa.
 *
 * ## Idempotência
 * `jobId: parq-backfill-<sessionId>` — o BullMQ descarta um job com id repetido enquanto
 * ele existir no keyspace. Além disso, o próprio worker pré-checa `existsForUser` antes de
 * chamar o LLM, e o `UNIQUE(user_id, version)` de `protocols` é o backstop final. Rodar
 * duas vezes converge para o mesmo estado; rodar por engano não gera protocolo duplicado.
 *
 * Sessões cujo titular JÁ tem protocolo são filtradas aqui também — não por segurança
 * (as três camadas acima já bastam), mas para o log dizer a verdade sobre quantos
 * titulares de fato voltaram para a fila.
 */
import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import postgres from 'postgres';

import { AppConfigService, getAppConfig } from '../core/config';
import { loadEnv } from '../core/config/load-env';
import { anamnesisSessions, protocols } from '../core/database/schema';
import {
  bullPrefix,
  buildBullConnection,
  QUEUE,
  resolveJobOptions,
} from '../modules/jobs/jobs.config';

const dryRun = process.argv.includes('--dry-run');

const { env } = loadEnv();
const host = env.MIGRATION_DATABASE_HOST ?? env.DATABASE_HOST;
const port = Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT);
const user = env.MIGRATION_DATABASE_USER ?? 'movivo_migrator';
const password = env.MIGRATION_DATABASE_PASSWORD;
const database = env.DATABASE_NAME;

if (!host || !Number.isFinite(port) || !user || !password || !database) {
  throw new Error(
    '[reenqueue-blocked-parq] Configuração incompleta. Defina MIGRATION_DATABASE_* em apps/api/.env.',
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

  const config = new AppConfigService(getAppConfig());
  const queue = new Queue(QUEUE.protocolGeneration, {
    connection: buildBullConnection(config) as ConnectionOptions,
    prefix: bullPrefix(config),
  });

  try {
    const db = drizzle(client);
    // Só sessões SUBMITTED com titular: uma sessão bloqueada ainda anônima (sem `user_id`)
    // não tem o que gerar, e o próprio submit é que a criaria.
    const rows = await db
      .select({
        sessionId: anamnesisSessions.id,
        userId: anamnesisSessions.userId,
        submittedAt: anamnesisSessions.submittedAt,
        hasProtocol: sql<boolean>`exists (
          select 1 from ${protocols} p where p.user_id = ${anamnesisSessions.userId}
        )`,
      })
      .from(anamnesisSessions)
      .where(
        and(
          eq(anamnesisSessions.parqState, 'BLOQUEADO_AGUARDANDO_CLEARANCE'),
          isNotNull(anamnesisSessions.userId),
        ),
      );

    const pending = rows.filter((row) => !row.hasProtocol);
    console.warn(
      `[reenqueue-blocked-parq] ${rows.length} sessão(ões) bloqueada(s); ` +
        `${pending.length} sem protocolo${dryRun ? ' (dry-run: nada será enfileirado)' : ''}.`,
    );

    let enqueued = 0;
    for (const row of pending) {
      // O tipo já garante `userId` não-nulo pelo filtro do WHERE, mas o Drizzle não sabe
      // disso — a guarda evita um `null` virar a string "null" no payload do job.
      if (!row.userId) continue;
      if (dryRun) {
        console.warn(`[reenqueue-blocked-parq] (dry-run) sessão ${row.sessionId}`);
        continue;
      }
      await queue.add(
        'generate-protocol',
        {
          userId: row.userId,
          anamnesisSessionId: row.sessionId,
          submittedAt: row.submittedAt?.toISOString(),
          correlationId: row.sessionId,
        },
        { ...resolveJobOptions(QUEUE.protocolGeneration), jobId: `parq-backfill-${row.sessionId}` },
      );
      enqueued++;
    }
    console.warn(`[reenqueue-blocked-parq] ${enqueued} job(s) enfileirado(s).`);
  } finally {
    await queue.close();
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('[reenqueue-blocked-parq] falhou:', error);
  process.exitCode = 1;
});
