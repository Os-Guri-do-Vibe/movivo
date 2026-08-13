/**
 * Integração — RAG (US-3.3) contra o stack Docker (PGVector). Pré-requisito: `pnpm run infra:up`.
 *
 * Prova, com I/O real:
 *   · indexação do corpus-semente grava chunks com embedding em `knowledge_base`;
 *   · retrieval denso (HNSW `<=>`) retorna top-K relevante acima do threshold;
 *   · fail-safe: query sem cobertura → [] (sem RAG);
 *   · `movivo_app` NÃO escreve no corpus (read-only — Sato §10.4);
 *   · a camada semantic do ContextService agora é o RagService (RAG plugado no lugar do no-op).
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/core/config/load-env';
import { DRIZZLE } from '../src/core/database/database.constants';
import type { DrizzleClient } from '../src/core/database/database.module';
import { knowledgeBase } from '../src/core/database/schema/knowledge-base';
import { REDIS_CLIENT, REDIS_KEY_BUILDER } from '../src/core/redis';
import { SEMANTIC_MEMORY } from '../src/modules/ai-coach/context/semantic-memory.port';
import { FakeEmbedding } from '../src/modules/ai-coach/rag/embedding.port';
import { FakeReranker } from '../src/modules/ai-coach/rag/reranker.port';
import { SEED_CORPUS } from '../src/modules/ai-coach/rag/corpus-seed';
import { indexCorpus } from '../src/modules/ai-coach/rag/corpus-indexer';
import { RagService } from '../src/modules/ai-coach/rag/rag.service';

const { env } = loadEnv();
const migratorSql = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? env.DATABASE_HOST ?? 'localhost',
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
  user: env.MIGRATION_DATABASE_USER ?? 'movivo_migrator',
  password: env.MIGRATION_DATABASE_PASSWORD,
  database: env.DATABASE_NAME,
  max: 1,
  idle_timeout: 5,
  onnotice: () => {
    /* notices do Postgres podem conter valores — nunca vão para o log do teste. */
  },
});
const migratorDb = drizzle(migratorSql) as unknown as DrizzleClient;

// Config stub com threshold ajustado ao embedding fake (a nota de 0.75 é da impl real).
const configStub = {
  rag: { minCosine: 0.3, rerankMinScore: 0, topK: 3, candidates: 20 },
} as never;
const loggerStub = { setContext: () => undefined, warn: () => undefined } as never;

let app: INestApplication;
let rag: RagService;

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  const appDb = app.get<DrizzleClient>(DRIZZLE);
  // RagService lendo via movivo_app (SELECT), com threshold de dev.
  rag = new RagService(
    appDb,
    new FakeEmbedding(),
    new FakeReranker(),
    configStub,
    loggerStub,
    app.get(REDIS_CLIENT),
    app.get(REDIS_KEY_BUILDER),
  );

  await migratorDb.delete(knowledgeBase); // base limpa
  await indexCorpus(migratorDb, SEED_CORPUS, new FakeEmbedding());
});

afterAll(async () => {
  await migratorDb.delete(knowledgeBase);
  await migratorSql.end({ timeout: 5 });
  await app?.close();
});

describe('RAG — indexação e retrieval', () => {
  it('indexa o corpus-semente (chunks com embedding)', async () => {
    const rows = await migratorSql`SELECT count(*)::int AS n FROM knowledge_base`;
    expect(rows[0]?.n).toBeGreaterThanOrEqual(SEED_CORPUS.length);
  });

  it('retorna trecho relevante acima do threshold', async () => {
    const docs = await rag.retrieve('descanso entre séries para hipertrofia');
    expect(docs.length).toBeGreaterThan(0);
    expect(docs[0]?.snippet.toLowerCase()).toContain('descanso');
  });

  it('fail-safe: query sem cobertura → [] (sem RAG)', async () => {
    const docs = await rag.retrieve('xyzzy plugh quux zorkmid nonsense');
    expect(docs).toEqual([]);
  });
});

describe('RAG — corpus somente-leitura', () => {
  it('movivo_app NÃO escreve no corpus (Sato §10.4)', async () => {
    const appDb = app.get<DrizzleClient>(DRIZZLE);
    await expect(
      appDb.insert(knowledgeBase).values({
        chunkText: 'tentativa de envenenamento',
        embedding: new Array(1536).fill(0),
        topic: 'x',
        title: 'x',
      }),
    ).rejects.toThrow();
  });
});

describe('RAG — plugado no ContextService', () => {
  it('a camada semantic (SEMANTIC_MEMORY) agora é o RagService', () => {
    expect(app.get(SEMANTIC_MEMORY)).toBeInstanceOf(RagService);
  });
});
