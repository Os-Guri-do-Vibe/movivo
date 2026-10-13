/**
 * Integração — ContextService (US-3.2) contra o stack Docker (Redis + Postgres).
 *
 * Prova, com I/O real:
 *   · a transcrição "lembra de ontem" vem do histórico DURÁVEL (`conversations`), inclusive a
 *     pergunta automática do Coach e uma resposta que chega dias depois;
 *   · episodic memory lida sob FORCE RLS reflete o protocolo ativo;
 *   · isolamento multi-tenant: o contexto de A nunca vaza para B (janela curta + histórico durável + episodic);
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
import { coachingSessions, conversations, protocols, users } from '../src/core/database/schema';
import { HealthCipherService } from '../src/core/database/health-cipher.service';
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
let cipher: HealthCipherService;
const createdUserIds: string[] = [];

async function createUser(name: string): Promise<string> {
  const phone = `+55119${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const rows = await db.runAsSystem((tx) =>
    tx
      .insert(users)
      .values({ phoneNumber: phone, name, email: `${phone.replace(/\D/g, '')}@example.invalid` })
      .returning({ id: users.id }),
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('falha ao criar usuário de teste');
  createdUserIds.push(id);
  return id;
}

/** Grava uma mensagem no histórico durável, como o worker do Coach e o de WhatsApp fazem. */
async function seedConversation(
  userId: string,
  message: {
    direction: 'INBOUND' | 'OUTBOUND';
    origin: 'STUDENT' | 'COACH' | 'SYSTEM';
    text: string;
    sourceType?: string;
    hoursAgo?: number;
  },
): Promise<void> {
  const content = await cipher.encryptText(message.text);
  await db.runAsUser(userId, 'USER', async (tx) => {
    await tx.insert(conversations).values({
      userId,
      direction: message.direction,
      origin: message.origin,
      sourceType: message.sourceType ?? null,
      content,
      createdAt: new Date(Date.now() - (message.hoursAgo ?? 0) * 3_600_000),
    });
  });
}

async function giveActiveProtocol(userId: string): Promise<void> {
  await db.runAsUser(userId, 'USER', async (tx) => {
    await tx.insert(protocols).values({
      userId,
      status: 'ACTIVE',
      currentWeek: 3,
      totalWeeks: 12,
      // `ProtocolStructure` completo (achado 2026-09-11): `ContextRepository` agora
      // calcula o treino de hoje via `sessionFor`, que lê `.sessions` — um stub sem
      // esse campo derrubava o teste com um TypeError não relacionado ao que ele prova.
      content: {
        promptVersion: 'test-v1',
        goal: 'GAIN_MUSCLE',
        phase: 'HIPERTROFIA',
        weeklyFrequency: 3,
        phaseDurationWeeks: 8,
        sessions: [
          {
            dayLabel: 'Treino A',
            focus: 'Full body',
            exercises: [
              {
                exerciseId: 'goblet_squat',
                name: 'Agachamento Goblet',
                sets: 3,
                reps: { min: 8, max: 12 },
                loadStrategy: 'DOUBLE_PROGRESSION',
                restSeconds: 90,
              },
            ],
          },
        ],
      },
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
  cipher = app.get(HealthCipherService);
});

afterAll(async () => {
  if (db && createdUserIds.length > 0) {
    await db.runAsSystem(async (tx) => {
      await tx.delete(conversations).where(inArray(conversations.userId, createdUserIds));
      await tx.delete(coachingSessions).where(inArray(coachingSessions.userId, createdUserIds));
      await tx.delete(protocols).where(inArray(protocols.userId, createdUserIds));
      await tx.delete(users).where(inArray(users.id, createdUserIds));
      return undefined;
    });
  }
  await app?.close();
});

describe('ContextService — transcrição durável ("lembra de ontem")', () => {
  it('a 2ª mensagem carrega as anteriores do histórico durável', async () => {
    const userId = await createUser('Ana');
    await seedConversation(userId, {
      direction: 'INBOUND',
      origin: 'STUDENT',
      text: 'ontem falei do meu joelho',
      hoursAgo: 2,
    });
    await seedConversation(userId, {
      direction: 'OUTBOUND',
      origin: 'COACH',
      text: 'anotado, vou considerar isso',
      hoursAgo: 1.9,
    });

    const built = await ctx.build(userId, 'MOTIVACAO', 'e hoje, o que treino?', 'MOVI');
    expect(built.volatileSuffix).toContain('Aluno: ontem falei do meu joelho');
    expect(built.volatileSuffix).toContain('MOVI: anotado, vou considerar isso');
    expect(built.volatileSuffix).toContain('Aluno: e hoje, o que treino?');
  });

  it('resposta 2 dias depois: o Coach ainda vê a pergunta que fez e o intervalo, sem a URL do link', async () => {
    const userId = await createUser('Elisa');
    await seedConversation(userId, {
      direction: 'OUTBOUND',
      origin: 'SYSTEM',
      sourceType: 'WORKOUT_DAILY_LINK',
      text: 'Bom dia, Elisa! Seu treino de hoje é Pernas: https://movivo.com.br/check-in/aB3xK9pQ',
      hoursAgo: 49,
    });
    await seedConversation(userId, {
      direction: 'OUTBOUND',
      origin: 'SYSTEM',
      sourceType: 'WORKOUT_DAILY_LINK',
      text: 'E ontem, tudo bem? O treino de Costas ficou sem registro. Uma palavra já ajuda.',
      hoursAgo: 48.9,
    });

    const built = await ctx.build(userId, 'MOTIVACAO', 'trabalhei até tarde', 'MOVI');
    expect(built.volatileSuffix).toContain(
      'E ontem, tudo bem? O treino de Costas ficou sem registro.',
    );
    expect(built.volatileSuffix).toMatch(/a mensagem abaixo chegou 2 dias depois/);
    expect(built.volatileSuffix).not.toMatch(/https?:|check-in\//);
    expect(built.volatileSuffix).toContain('Aluno: trabalhei até tarde');
  });
});

describe('ContextService — episodic sob RLS', () => {
  it('reflete o protocolo ativo do titular', async () => {
    const userId = await createUser('Bruno');
    await giveActiveProtocol(userId);
    const built = await ctx.build(userId, 'MOTIVACAO', 'oi', 'MOVI');
    expect(built.cacheablePrefix).toContain('HIPERTROFIA');
    expect(built.cacheablePrefix).toContain('temProtocoloAtivo');
  });
});

describe('ContextService — isolamento multi-tenant', () => {
  it('o contexto de A nunca vaza para B (janela curta + histórico durável + episodic)', async () => {
    const a = await createUser('Alice');
    const b = await createUser('Bob');
    await ctx.recordTurn(a, 'user', 'segredo da Alice sobre lesão');
    await seedConversation(a, {
      direction: 'INBOUND',
      origin: 'STUDENT',
      text: 'segredo da Alice no histórico durável',
    });
    await giveActiveProtocol(a);

    const built = await ctx.build(b, 'MOTIVACAO', 'oi', 'MOVI');
    // Nem a janela curta (Redis) nem o histórico durável (Postgres, sob RLS) cruzam titulares.
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
