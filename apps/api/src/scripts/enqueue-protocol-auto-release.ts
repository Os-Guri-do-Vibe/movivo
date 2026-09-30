/**
 * Enfileira o job `protocol-auto-release` que faltou para um protocolo cujo
 * `reviewUrgency` foi setado para `OPTIONAL` fora do fluxo normal do
 * `ProtocolGenerationWorker` (ex.: `reprocess-protocol-fallback.ts`, que atualiza o
 * `content`/`reviewUrgency` de um protocolo em produção mas não passa pelo `persist()`
 * original — logo nunca agenda este job). Sem ele, o painel calcula e mostra o prazo de
 * cortesia (`createdAt + 1h`) mas nada dispara de verdade quando expira.
 *
 * Só enfileira (`QueueManager`, produtor) — não registra nenhum Worker/consumer, então é
 * seguro rodar ao lado da API real (mesmo racional de `diagnose-protocol-fallback.ts`). O
 * job roda no `movivo-api` já em execução, no `ProtocolAutoReleaseWorker` normal — sem
 * `delay`, dispara na primeira vez que o worker pegar a fila (imediato, já que o prazo
 * original já passou). `ProtocolRepository.autoRelease` é idempotente por construção:
 * só libera se o estado ainda bater `PENDING_REVIEW`+`OPTIONAL` no instante em que roda.
 *
 * Script descartável — correção pontual, não é feature permanente.
 *
 * Uso: node --enable-source-maps dist/scripts/enqueue-protocol-auto-release.js <phoneNumberE164>
 */
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq, desc, and } from 'drizzle-orm';

import { CoreModule } from '../core/core.module';
import { TenantDatabase } from '../core/database/tenant-database.service';
import { protocols, users } from '../core/database/schema';
import { QUEUE } from '../modules/jobs/jobs.config';
import { QueueManager } from '../modules/jobs/queue-manager.service';

@Module({ imports: [CoreModule], providers: [QueueManager] })
class EnqueueModule {}

async function main(): Promise<void> {
  const phone = process.argv[2];
  if (!phone) {
    console.error('Uso: node dist/scripts/enqueue-protocol-auto-release.js <phoneNumberE164>');
    process.exitCode = 1;
    return;
  }
  const app = await NestFactory.createApplicationContext(EnqueueModule, { logger: false });
  try {
    const db = app.get(TenantDatabase);
    const queues = app.get(QueueManager);

    const found = await db.runAsSystem(async (tx) => {
      const [userRow] = await tx.select().from(users).where(eq(users.phoneNumber, phone)).limit(1);
      if (!userRow) return null;
      const [protocolRow] = await tx
        .select({
          id: protocols.id,
          status: protocols.status,
          approvalStatus: protocols.approvalStatus,
          reviewUrgency: protocols.reviewUrgency,
        })
        .from(protocols)
        .where(and(eq(protocols.userId, userRow.id), eq(protocols.mesocycleNumber, 1)))
        .orderBy(desc(protocols.version))
        .limit(1);
      return { userId: userRow.id, protocolRow };
    });

    if (!found?.protocolRow) {
      console.error(`Nenhum protocolo (mesociclo 1) para ${phone}.`);
      process.exitCode = 1;
      return;
    }
    const { userId, protocolRow } = found;
    if (
      protocolRow.status !== 'PENDING_SIGNATURE' ||
      protocolRow.approvalStatus !== 'PENDING_REVIEW' ||
      protocolRow.reviewUrgency !== 'OPTIONAL'
    ) {
      console.error(
        `Protocolo ${protocolRow.id} não está mais PENDING_SIGNATURE/PENDING_REVIEW/OPTIONAL ` +
          `(status=${protocolRow.status}, approvalStatus=${protocolRow.approvalStatus}, reviewUrgency=${protocolRow.reviewUrgency}) — abortando, alguém já agiu.`,
      );
      process.exitCode = 1;
      return;
    }

    const jobId = `auto-release-${protocolRow.id}`;
    await queues.enqueue(
      QUEUE.protocolAutoRelease,
      'auto-release',
      { userId, protocolId: protocolRow.id },
      { jobId },
    );
    console.warn(
      `Job ${jobId} enfileirado (sem delay) — o ProtocolAutoReleaseWorker da API em execução deve processá-lo em instantes.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('[enqueue-protocol-auto-release] falhou:', error);
  process.exitCode = 1;
});
