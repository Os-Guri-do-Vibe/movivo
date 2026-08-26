/**
 * Integração — `workout_completions` (US-8.1 / TASK-8.1.2). Pré-requisito: `pnpm run infra:up`.
 *
 * Prova, com I/O real, a regra que define se o dado nasce limpo: **duplo reporte do
 * mesmo treino produz 1 linha**, e a fonte de maior precedência vence — em qualquer
 * ordem de chegada. É SQL cru (`setWhere: source > excluded.source` sobre o ordinal do
 * enum nativo); nenhum mock de Drizzle provaria isso.
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { protocols, users, workoutCompletions } from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { WorkoutCompletionService } from '../src/modules/workout/workout-completion.service';

let app: INestApplication;
let db: TenantDatabase;
let service: WorkoutCompletionService;
const createdUserIds: string[] = [];

const DAY = '2026-08-10';

async function createUserWithProtocol(): Promise<{ userId: string; protocolId: string }> {
  const phone = `+55119${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const { userId, protocolId } = await db.runAsSystem(async (tx) => {
    const [user] = await tx.insert(users).values({ phoneNumber: phone }).returning({
      id: users.id,
    });
    if (!user) throw new Error('falha ao criar usuário de teste');
    const [protocol] = await tx
      .insert(protocols)
      // `mesocycle_name`/`start_date`/`end_date` são NOT NULL sem default desde a
      // migração 0033 — todo writer precisa fornecê-los (o app faz isso em `persist()`).
      .values({
        userId: user.id,
        content: {},
        constraints: {},
        mesocycleName: 'Mesociclo 1 — Adaptação',
        startDate: new Date(),
        endDate: new Date(Date.now() + 12 * 7 * 24 * 60 * 60 * 1000),
      })
      .returning({ id: protocols.id });
    if (!protocol) throw new Error('falha ao criar protocolo de teste');
    return { userId: user.id, protocolId: protocol.id };
  });
  createdUserIds.push(userId);
  return { userId, protocolId };
}

function rowsFor(userId: string) {
  return db.runAsSystem((tx) =>
    tx
      .select({ source: workoutCompletions.source, sessionKey: workoutCompletions.sessionKey })
      .from(workoutCompletions)
      .where(eq(workoutCompletions.userId, userId)),
  );
}

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  db = app.get(TenantDatabase);
  service = app.get(WorkoutCompletionService);
});

afterAll(async () => {
  if (db && createdUserIds.length > 0) {
    await db.runAsSystem(async (tx) => {
      await tx.delete(workoutCompletions).where(inArray(workoutCompletions.userId, createdUserIds));
      await tx.delete(protocols).where(inArray(protocols.userId, createdUserIds));
      await tx.delete(users).where(inArray(users.id, createdUserIds));
      return undefined;
    });
  }
  await app?.close();
});

describe('dedupe de workout_completions por precedência de fonte', () => {
  it('check-in depois do quick reply: 1 linha, quick reply permanece', async () => {
    const { userId, protocolId } = await createUserWithProtocol();
    expect(await service.record(userId, protocolId, 1, 1, 'A', DAY, 'WHATSAPP_QUICK_REPLY')).toBe(
      true,
    );
    // Fonte menos específica chegando depois: não sobrescreve e não cria linha nova.
    expect(await service.record(userId, protocolId, 1, 1, 'A', DAY, 'CHECKIN')).toBe(false);

    const rows = await rowsFor(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe('WHATSAPP_QUICK_REPLY');
  });

  it('quick reply depois do check-in: 1 linha, promovida a quick reply', async () => {
    const { userId, protocolId } = await createUserWithProtocol();
    expect(await service.record(userId, protocolId, 1, 1, 'A', DAY, 'CHECKIN')).toBe(true);
    expect(await service.record(userId, protocolId, 1, 1, 'A', DAY, 'WHATSAPP_QUICK_REPLY')).toBe(
      true,
    );

    const rows = await rowsFor(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe('WHATSAPP_QUICK_REPLY');
  });

  it('sessões distintas no mesmo dia são treinos distintos', async () => {
    const { userId, protocolId } = await createUserWithProtocol();
    await service.record(userId, protocolId, 1, 1, 'A', DAY, 'WHATSAPP_QUICK_REPLY');
    await service.record(userId, protocolId, 1, 1, 'B', DAY, 'WHATSAPP_QUICK_REPLY');

    const rows = await rowsFor(userId);
    expect(rows.map((row) => row.sessionKey).sort()).toEqual(['A', 'B']);
  });
});
