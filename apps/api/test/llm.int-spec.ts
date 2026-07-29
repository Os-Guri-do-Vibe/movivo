/**
 * Integração — camada de IA (US-2.2) contra o stack Docker (US-0.2).
 *
 * Prova, com I/O real:
 *   · o AppModule boota com o AiCoachModule registrado **sem chave de LLM** (chaves opcionais);
 *   · `ai_jobs` grava um registro pseudonimizado sob `FORCE ROW LEVEL SECURITY`;
 *   · isolamento multi-tenant: o job do titular A não é visível para o titular B.
 *
 * Pré-requisito: `pnpm run infra:up`.
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { users } from '../src/core/database/schema/users';
import { aiJobs } from '../src/core/database/schema/ai-jobs';
import { AiJobRepository } from '../src/modules/ai-coach/llm/ai-job.repository';
import { LlmRouter } from '../src/modules/ai-coach/llm/llm-router.service';

let app: INestApplication;
let db: TenantDatabase;
let repo: AiJobRepository;
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

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  db = app.get(TenantDatabase);
  repo = app.get(AiJobRepository);
});

afterAll(async () => {
  // Limpa APENAS os ai_jobs e users criados por esta suíte (contexto de sistema — RLS
  // permite o DELETE). Escopar por id evita colidir com FKs de outras suítes no banco
  // compartilhado (ex.: consents apontando para users da anamnese).
  if (db && createdUserIds.length > 0) {
    await db.runAsSystem(async (tx) => {
      await tx.delete(aiJobs).where(inArray(aiJobs.userId, createdUserIds));
      await tx.delete(users).where(inArray(users.id, createdUserIds));
      return undefined;
    });
  }
  await app?.close();
});

describe('AiCoachModule — boot sem chave de LLM', () => {
  it('resolve o LLMRouter mesmo sem OPENAI/ANTHROPIC key (chaves opcionais)', () => {
    expect(app.get(LlmRouter)).toBeInstanceOf(LlmRouter);
  });
});

describe('ai_jobs sob RLS', () => {
  it('grava um registro pseudonimizado e o titular o enxerga', async () => {
    const userId = await createUser();
    await repo.record(userId, {
      jobType: 'PROTOCOL_GENERATION',
      status: 'COMPLETED',
      provider: 'OPENAI_GPT41',
      modelUsed: 'gpt-4.1',
      dataClass: 'HEALTH',
      tokensInput: 1000,
      tokensOutput: 200,
      tokensCached: 500,
      latencyMs: 1234,
      attempt: 1,
      intent: 'gerar-protocolo',
      costBrl: 0.012,
      validationAction: null,
      inputSnapshot:
        '{"system":"...","messages":[{"role":"user","content":"o usuário quer treinar"}]}',
      errorMessage: null,
    });

    const rows = await repo.listForUser(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider).toBe('OPENAI_GPT41');
    expect(rows[0]?.inputSnapshot).not.toContain('+55'); // snapshot pseudonimizado
    expect(Number(rows[0]?.costBrl)).toBeCloseTo(0.012, 3);
  });

  it('isola entre titulares: o job de A não é visível para B', async () => {
    const userA = await createUser();
    const userB = await createUser();
    await repo.record(userA, {
      jobType: 'AI_RESPONSE',
      status: 'COMPLETED',
      provider: 'ANTHROPIC_SONNET45',
      modelUsed: 'claude-sonnet-4-5',
      dataClass: 'HEALTH',
      tokensInput: 10,
      tokensOutput: 5,
      tokensCached: 0,
      latencyMs: 100,
      attempt: 2,
      intent: null,
      costBrl: 0.001,
      validationAction: null,
      inputSnapshot: '{}',
      errorMessage: null,
    });

    const seenByB = await repo.listForUser(userB);
    expect(seenByB.some((r) => r.userId === userA)).toBe(false);
    const seenByA = await repo.listForUser(userA);
    expect(seenByA.every((r) => r.userId === userA)).toBe(true);
  });
});
