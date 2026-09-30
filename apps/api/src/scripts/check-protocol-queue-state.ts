/**
 * Leitura ad-hoc, read-only: estado atual de um protocolo (status/approvalStatus/
 * reviewUrgency/createdAt) pra diagnosticar por que a fila do painel mostra
 * "Disparando automaticamente..." sem o auto-release nunca disparar de fato.
 *
 * Script descartável — investigação pontual, não é feature permanente.
 *
 * Uso: node --enable-source-maps dist/scripts/check-protocol-queue-state.js <phoneNumberE164>
 */
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq, desc, and } from 'drizzle-orm';

import { CoreModule } from '../core/core.module';
import { TenantDatabase } from '../core/database/tenant-database.service';
import { protocols, users } from '../core/database/schema';

@Module({ imports: [CoreModule] })
class CheckModule {}

async function main(): Promise<void> {
  const phone = process.argv[2];
  if (!phone) {
    console.error('Uso: node dist/scripts/check-protocol-queue-state.js <phoneNumberE164>');
    process.exitCode = 1;
    return;
  }
  const app = await NestFactory.createApplicationContext(CheckModule, { logger: false });
  try {
    const db = app.get(TenantDatabase);
    const row = await db.runAsSystem(async (tx) => {
      const [userRow] = await tx.select().from(users).where(eq(users.phoneNumber, phone)).limit(1);
      if (!userRow) return null;
      const [protocolRow] = await tx
        .select({
          id: protocols.id,
          status: protocols.status,
          approvalStatus: protocols.approvalStatus,
          reviewUrgency: protocols.reviewUrgency,
          humanReviewRequired: protocols.humanReviewRequired,
          generatedBy: protocols.generatedBy,
          createdAt: protocols.createdAt,
          updatedAt: protocols.updatedAt,
          signedAt: protocols.signedAt,
          version: protocols.version,
          mesocycleNumber: protocols.mesocycleNumber,
        })
        .from(protocols)
        .where(and(eq(protocols.userId, userRow.id), eq(protocols.mesocycleNumber, 1)))
        .orderBy(desc(protocols.version))
        .limit(1);
      return { userId: userRow.id, protocolRow };
    });
    console.warn(JSON.stringify(row, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('[check-protocol-queue-state] falhou:', error);
  process.exitCode = 1;
});
