/**
 * Integração — ContextService (US-3.2) contra o stack Docker (Redis + Postgres).
 *
 * Prova, com I/O real:
 *   · working memory "lembra de ontem" (2ª mensagem carrega as anteriores);
 *   · episodic memory lida sob FORCE RLS reflete o protocolo ativo;
 *   · isolamento multi-tenant: o contexto de A nunca vaza para B (working + episodic);
 *   · resumo de sessão longa persiste sob RLS e é lido de volta escopado ao titular.
 *
 * Pré-requisito: `pnpm run infra:up`.
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { coachingSessions, protocols, users } from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { ContextRepository } from '../src/modules/ai-coach/context/context.repository';
import {
  ContextService,
  currentSessionDate,
} from '../src/modules/ai-coach/context/context.service';

let app: INestApplication;
let db: TenantDatabase;
let ctx: ContextService;
let repo: ContextRepository;
const createdUserIds: string[] = [];

async function createUser(name: string): Promise<string> {
  const phone = `+55119${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const rows = await db.runAsSystem((tx) =>
    tx.insert(users).values({ phoneNumber: phone, name }).returning({ id: users.id }),
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('falha ao criar usuário de teste');
  createdUserIds.push(id);
  return id;
}

async function giveActiveProtocol(userId: string): Promise<void> {
  await db.runAsUser(userId, 'USER', async (tx) => {
    await tx.insert(protocols).values({
      userId,
      status: 'ACTIVE',
      currentWeek: 3,
      totalWeeks: 12,
      content: { goal: 'GAIN_MUSCLE', phase: 'HIPERTROFIA' },
      constraints: { injuryTags: ['SHOULDER'], equipment: ['halteres'] },
      // NOT NULL sem default desde a migração 0033.
      mesocycleName: 'Mesociclo 1 — Hipertrofia',
      startDate: new Date(),
      endDate: new Date(Date.now() + 12 * 7 * 24 * 60 * 60 * 1000),
    });
  });
}

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  db = app.get(TenantDatabase);
  ctx = app.get(ContextService);
  repo = app.get(ContextRepository);
});

afterAll(async () => {
  if (db && createdUserIds.length > 0) {
    await db.runAsSystem(async (tx) => {
      await tx.delete(coachingSessions).where(inArray(coachingSessions.userId, createdUserIds));
      await tx.delete(protocols).where(inArray(protocols.userId, createdUserIds));
      await tx.delete(users).where(inArray(users.id, createdUserIds));
      return undefined;
    });
  }
  await app?.close();
});

describe('ContextService — working memory ("lembra de ontem")', () => {
  it('a 2ª mensagem do dia carrega as anteriores', async () => {
    const userId = await createUser('Ana');
    await ctx.recordTurn(userId, 'user', 'ontem falei do meu joelho');
    await ctx.recordTurn(userId, 'assistant', 'anotado, vou considerar isso');

    const built = await ctx.build(userId, 'MOTIVACAO', 'e hoje, o que treino?');
    expect(built.volatileSuffix).toContain('meu joelho');
    expect(built.volatileSuffix).toContain('Aluno: e hoje, o que treino?');
  });
});

describe('ContextService — episodic sob RLS', () => {
  it('reflete o protocolo ativo do titular', async () => {
    const userId = await createUser('Bruno');
    await giveActiveProtocol(userId);
    const built = await ctx.build(userId, 'MOTIVACAO', 'oi');
    expect(built.cacheablePrefix).toContain('HIPERTROFIA');
    expect(built.cacheablePrefix).toContain('temProtocoloAtivo');
  });
});

describe('ContextService — isolamento multi-tenant', () => {
  it('o contexto de A nunca vaza para B (working + episodic)', async () => {
    const a = await createUser('Alice');
    const b = await createUser('Bob');
    await ctx.recordTurn(a, 'user', 'segredo da Alice sobre lesão');
    await giveActiveProtocol(a);

    const built = await ctx.build(b, 'MOTIVACAO', 'oi');
    expect(built.volatileSuffix).not.toContain('segredo da Alice');
    expect(built.cacheablePrefix).toContain('"temProtocoloAtivo":false'); // B não tem protocolo
  });
});

describe('ContextService — resumo sob RLS', () => {
  it('persiste e lê o resumo escopado ao titular', async () => {
    const a = await createUser('Carla');
    const b = await createUser('Diego');
    await repo.upsertSummary(a, currentSessionDate(), 'Carla relatou dor no ombro.');

    const epA = await repo.loadEpisodic(a, currentSessionDate());
    const epB = await repo.loadEpisodic(b, currentSessionDate());
    expect(epA.summary).toContain('dor no ombro');
    expect(epB.summary).toBeNull(); // B não enxerga o resumo de A
  });
});
