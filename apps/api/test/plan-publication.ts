/**
 * Publicação do plano nos testes de integração. Todo protocolo gerado passa pela fila do
 * profissional: aqui a janela de revisão opcional vence e a decisão chega à ativação do plano,
 * como o dispatcher faria depois do commit.
 */
import type { INestApplication } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { vi } from 'vitest';

import {
  domainEvents,
  exceptionCases,
  nutritionPlans,
  trainingPlans,
} from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { ExceptionsService } from '../src/modules/exceptions/exceptions.service';
import { PlanApprovalHandler } from '../src/modules/planning/plan-approval.handler';
import { PlanGenerationService } from '../src/modules/planning/plan-generation.service';

/** Vence a janela dos protocolos opcionais do aluno e ativa o que a fila liberou. */
export async function releaseOptionalProtocols(
  app: INestApplication,
  userId: string,
  now: Date,
): Promise<void> {
  const db = app.get(TenantDatabase);
  vi.useFakeTimers({ toFake: ['Date'], now });
  try {
    const queued = await db.runAsSystem((tx) =>
      tx
        .select({ id: exceptionCases.id })
        .from(exceptionCases)
        .where(and(eq(exceptionCases.userId, userId), eq(exceptionCases.kind, 'PROTOCOL_REVIEW'))),
    );
    for (const row of queued) await app.get(ExceptionsService).autoRelease(row.id, now);
    const decisions = await db.runAsSystem((tx) =>
      tx
        .select()
        .from(domainEvents)
        .where(and(eq(domainEvents.userId, userId), eq(domainEvents.type, 'DecisionMade'))),
    );
    for (const event of decisions) {
      await app.get(PlanApprovalHandler).handle({
        id: event.id,
        userId,
        type: 'DecisionMade',
        payload: event.payload,
        occurredAt: event.occurredAt,
      });
    }
  } finally {
    vi.useRealTimers();
  }
}

/** Gera o plano e libera os protocolos opcionais. `PUBLISHED` quando treino e dieta ficam ativos. */
export async function generatePublished(
  app: INestApplication,
  userId: string,
  now: Date,
): Promise<'PUBLISHED' | string> {
  const result = await app.get(PlanGenerationService).generate(userId, { now });
  if (result.status !== 'PENDING_REVIEW') return result.status;
  await releaseOptionalProtocols(app, userId, now);
  const db = app.get(TenantDatabase);
  const [training, nutrition] = await db.runAsSystem(async (tx) => [
    (await tx.select().from(trainingPlans).where(eq(trainingPlans.userId, userId)))[0],
    (await tx.select().from(nutritionPlans).where(eq(nutritionPlans.userId, userId)))[0],
  ]);
  return training?.status === 'ACTIVE' && nutrition?.status === 'ACTIVE'
    ? 'PUBLISHED'
    : result.status;
}
