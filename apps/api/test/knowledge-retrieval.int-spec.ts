/**
 * Integração — busca nos artigos (RAG) contra o Postgres real: pgvector + `unaccent` + busca
 * textual em português, na MESMA consulta que roda em produção.
 *
 * O corpus de teste é inserido com o migrador (a role de runtime só lê `knowledge_base`) e
 * removido no fim. O embedding é o do ambiente (o falso, sem chave, como na CI; o real, com chave): por isso estes testes
 * provam a MECÂNICA da busca (acento, fusão, piso, cada documento no lugar certo) e não a
 * qualidade semântica, que é do `pnpm rag:eval` com o provedor real.
 *
 * Pré-requisito: `pnpm run infra:up` + `db:migrate`.
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/core/config/load-env';
import { migrationPostgresTls } from '../src/core/database/postgres-tls';
import {
  contextHeader,
  contextualizeChunk,
  parseDocumentMeta,
} from '../src/core/knowledge/rag-text';
import { EMBEDDING_PORT, type EmbeddingPort } from '../src/core/knowledge/embedding.port';
import { KnowledgeRetrievalService } from '../src/core/knowledge/knowledge-retrieval.service';

const { env } = loadEnv();
const host = env.MIGRATION_DATABASE_HOST ?? env.DATABASE_HOST ?? 'localhost';

const admin = postgres({
  host,
  ssl: migrationPostgresTls(env, host),
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
  user: env.MIGRATION_DATABASE_USER ?? 'movivo_migrator',
  password: env.MIGRATION_DATABASE_PASSWORD,
  database: env.DATABASE_NAME ?? 'movivo',
  max: 1,
  idle_timeout: 5,
  onnotice: () => undefined,
});

const PREFIX = 'ITEST-RAG';
const DOCS = [
  [
    `${PREFIX} Volume semanal`,
    'Para hipertrofia, volumes de 10 a 20 séries semanais por grupo muscular são eficazes em treinados.',
  ],
  [
    `${PREFIX} Creatina`,
    'A creatina monoidratada, na dose de 3 a 5 g por dia, aumenta força e massa magra em adultos saudáveis.',
  ],
  [
    `${PREFIX} Sono`,
    'Dormir de 7 a 9 horas por noite favorece a recuperação e o desempenho no treino seguinte.',
  ],
] as const;

let app: INestApplication;
let retrieval: KnowledgeRetrievalService;

beforeAll(async () => {
  app = await NestFactory.create(
    { module: class RagRoot {}, imports: [AppModule] },
    { logger: false },
  );
  await app.init();
  retrieval = app.get(KnowledgeRetrievalService);
  const embedding = app.get<EmbeddingPort>(EMBEDDING_PORT);

  await admin`DELETE FROM knowledge_base WHERE title LIKE ${`${PREFIX}%`}`;
  for (const [index, [title, text]] of DOCS.entries()) {
    const vector = await embedding.embed(
      contextualizeChunk(contextHeader(title, parseDocumentMeta(text)), text),
    );
    await admin`
      INSERT INTO knowledge_base (chunk_text, embedding, topic, title, chunk_index)
      VALUES (${text}, ${`[${vector.join(',')}]`}::vector, 'artigo', ${title}, ${index})
    `;
  }
});

afterAll(async () => {
  await admin`DELETE FROM knowledge_base WHERE title LIKE ${`${PREFIX}%`}`;
  await admin.end({ timeout: 5 });
  await app?.close();
});

const titles = (chunks: Array<{ title: string }>) => chunks.map((chunk) => chunk.title);

describe('busca nos artigos — Postgres real', () => {
  it('a extensão unaccent existe (o migrate a cria)', async () => {
    const rows = await admin`SELECT 1 FROM pg_extension WHERE extname = 'unaccent'`;
    expect(rows).toHaveLength(1);
  });

  it('pergunta SEM acento acha o artigo COM acento ("series" → "séries")', async () => {
    const found = await retrieval.search('quantas series por semana de hipertrofia?', {
      minCosine: 0,
    });
    expect(titles(found)[0]).toBe(`${PREFIX} Volume semanal`);
  });

  it('o termo exato leva o documento certo ao topo ("creatina")', async () => {
    const found = await retrieval.search('creatina faz mal pro rim?', { minCosine: 0 });
    expect(titles(found)[0]).toBe(`${PREFIX} Creatina`);
  });

  it('piso de similaridade alto devolve NADA, e nada é um resultado correto', async () => {
    expect(await retrieval.search('creatina faz mal pro rim?', { minCosine: 0.99 })).toEqual([]);
  });

  it('pergunta fora do assunto, com o piso configurado, não traz trecho dos artigos', async () => {
    const found = await retrieval.search('qual é a capital da França hoje?');
    expect(titles(found).filter((title) => title.startsWith(PREFIX))).toEqual([]);
  });

  it('respeita o top-K e cada trecho vem com notas de similaridade', async () => {
    const found = await retrieval.search('treino de hipertrofia com creatina e sono', {
      minCosine: 0,
      topK: 2,
    });
    expect(found.length).toBeLessThanOrEqual(2);
    for (const chunk of found) {
      expect(chunk.cosine).toBeGreaterThanOrEqual(0);
      expect(chunk.score).toBeGreaterThan(0);
      expect(chunk.text).not.toMatch(/[<>]/);
    }
  });

  it('com RAG_ENABLED desligado (padrão), o agente não recebe evidência', async () => {
    if (retrieval.enabled) return; // ambiente com a chave ligada: nada a provar aqui
    expect(await retrieval.evidenceFor('creatina faz mal pro rim?')).toEqual([]);
  });
});
