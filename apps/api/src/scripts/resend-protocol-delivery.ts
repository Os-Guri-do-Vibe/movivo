/**
 * Reenvio manual único da entrega de protocolo (PROTOCOL_DELIVERY) por WhatsApp, pra um
 * titular específico — uso: QA/fundador reavaliando uma mudança de estética do PDF sem
 * gerar um protocolo novo.
 *
 * Não sobe Nest/DI (evita o problema de decorator metadata do `tsx` com providers
 * complexos — ver `diagnose-protocol-fallback.ts`): fala direto com Postgres, Redis e
 * BullMQ, exatamente como `reenqueue-blocked-parq.ts`.
 *
 * O que faz:
 *  1. Busca o protocolo mais recente (ACTIVE) do titular pelo telefone.
 *  2. Apaga o marcador de idempotência em Redis (`wa-sent:PROTOCOL_DELIVERY:<version>`) —
 *     sem isso o worker real trata como já entregue e não reenvia nada.
 *  3. Enfileira um novo job `PROTOCOL_DELIVERY` com um `jobId` único (nunca reusa o
 *     `jobId` original — evita colisão com o job antigo no keyspace do BullMQ).
 *
 * O worker que processa de fato (`WhatsappOutboundWorker`, rodando na instância real da
 * API) que envia a mensagem — este script só enfileira e desbloqueia a idempotência.
 *
 * Uso:
 *   cd apps/api
 *   pnpm exec tsx src/scripts/resend-protocol-delivery.ts <phoneNumberE164>
 *
 * Script descartável — não faz parte do pipeline de nenhuma sprint, é só operação manual.
 */
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, desc, and } from 'drizzle-orm';
import postgres from 'postgres';
import Redis from 'ioredis';

import { loadEnv } from '../core/config/load-env';
import { protocols, users } from '../core/database/schema';
import { QUEUE, bullPrefix, resolveJobOptions } from '../modules/jobs/jobs.config';

async function main(): Promise<void> {
  const phone = process.argv[2];
  if (!phone) {
    console.error('Uso: tsx src/scripts/resend-protocol-delivery.ts <phoneNumberE164>');
    process.exitCode = 1;
    return;
  }

  const { env } = loadEnv();
  const host = env.MIGRATION_DATABASE_HOST ?? env.DATABASE_HOST;
  const port = Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT);
  const user = env.MIGRATION_DATABASE_USER ?? 'movivo_migrator';
  const password = env.MIGRATION_DATABASE_PASSWORD;
  const database = env.DATABASE_NAME;
  if (!host || !Number.isFinite(port) || !user || !password || !database) {
    throw new Error('Configuração incompleta. Defina MIGRATION_DATABASE_* em apps/api/.env.');
  }

  // Conecta direto no master (127.0.0.1:6379, porta publicada pelo docker-compose local),
  // sem descoberta via Sentinel — correto pra uma ação manual única contra o Redis que já
  // sabemos ser o master agora (`docker port movivo-redis-master`).
  const redisConnection = { host: '127.0.0.1', port: 6379, password: env.REDIS_PASSWORD };

  const client = postgres({ host, port, user, password, database, ssl: false, max: 1 });
  const redis = new Redis(redisConnection);
  const queue = new Queue(QUEUE.whatsappOutbound, {
    connection: redisConnection as ConnectionOptions,
    prefix: bullPrefix({ redis: { keyPrefix: env.REDIS_KEY_PREFIX } } as never),
  });

  try {
    const db = drizzle(client);
    const [row] = await db
      .select({ userId: users.id, protocolId: protocols.id, version: protocols.version })
      .from(protocols)
      .innerJoin(users, eq(users.id, protocols.userId))
      .where(and(eq(users.phoneNumber, phone), eq(protocols.status, 'ACTIVE')))
      .orderBy(desc(protocols.version))
      .limit(1);

    if (!row) {
      console.error(`Nenhum protocolo ACTIVE para ${phone}.`);
      process.exitCode = 1;
      return;
    }

    const markerKey = `${env.REDIS_KEY_PREFIX}:u:${row.userId.toLowerCase()}:wa-sent:PROTOCOL_DELIVERY:${row.version}`;
    const deleted = await redis.del(markerKey);
    console.warn(
      `[resend] marcador de idempotência removido: ${markerKey} (existia: ${deleted === 1})`,
    );

    const jobId = `manual-resend-${row.protocolId}-${row.version}-${randomUUID()}`;
    await queue.add(
      'protocol-delivery',
      {
        userId: row.userId,
        type: 'PROTOCOL_DELIVERY',
        protocolId: row.protocolId,
        protocolVersion: row.version,
        dedupeId: jobId,
      },
      { ...resolveJobOptions(QUEUE.whatsappOutbound), jobId },
    );
    console.warn(
      `[resend] job enfileirado (jobId=${jobId}) — o worker real vai processar em instantes.`,
    );
  } finally {
    await queue.close();
    await redis.quit();
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('[resend-protocol-delivery] falhou:', error);
  process.exitCode = 1;
});
