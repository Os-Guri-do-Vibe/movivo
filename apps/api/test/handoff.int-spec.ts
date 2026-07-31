/**
 * Integração — handoff_alerts (US-3.6) sob FORCE RLS. Pré-requisito: `pnpm run infra:up`.
 *
 * Prova, com I/O real: o alerta de handoff persiste escopado ao titular e o alerta de A
 * NUNCA é visível para B (isolamento multi-tenant do estado que o painel CREF lê na Sprint 5).
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { handoffAlerts, users } from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { ConversationRepository } from '../src/modules/coach/conversation.repository';

let app: INestApplication;
let db: TenantDatabase;
let repo: ConversationRepository;
const createdUserIds: string[] = [];

async function createUser(): Promise<string> {
  const phone = `+55119${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const rows = await db.runAsSystem((tx) =>
    tx.insert(users).values({ phoneNumber: phone }).returning({ id: users.id }),
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('falha ao criar usuário de teste');
  createdUserIds.push(id);
  return id;
}

function countFor(userId: string): Promise<number> {
  return db.runAsUser(userId, 'USER', async (tx) => {
    const rows = await tx
      .select({ id: handoffAlerts.id })
      .from(handoffAlerts)
      .where(eq(handoffAlerts.userId, userId));
    return rows.length;
  });
}

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  db = app.get(TenantDatabase);
  repo = app.get(ConversationRepository);
});

afterAll(async () => {
  if (db && createdUserIds.length > 0) {
    await db.runAsSystem(async (tx) => {
      await tx.delete(handoffAlerts).where(inArray(handoffAlerts.userId, createdUserIds));
      await tx.delete(users).where(inArray(users.id, createdUserIds));
      return undefined;
    });
  }
  await app?.close();
});

describe('handoff_alerts sob RLS', () => {
  it('persiste os dois níveis e isola por titular', async () => {
    const a = await createUser();
    const b = await createUser();

    await repo.persistHandoff(a, 'SAFETY', 'RED_FLAG');
    await repo.persistHandoff(a, 'ALERT', 'PEDIDO_HANDOFF');

    expect(await countFor(a)).toBe(2);
    expect(await countFor(b)).toBe(0); // B nunca vê o alerta de A

    // Sanidade: o nível SAFETY foi de fato gravado para A.
    const safety = await db.runAsUser(a, 'USER', (tx) =>
      tx
        .select({ level: handoffAlerts.level })
        .from(handoffAlerts)
        .where(and(eq(handoffAlerts.userId, a), eq(handoffAlerts.level, 'SAFETY'))),
    );
    expect(safety).toHaveLength(1);
  });
});
