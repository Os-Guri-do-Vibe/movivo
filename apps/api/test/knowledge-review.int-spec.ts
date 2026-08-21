/** Gate real do RAG: revisao CREF, publicacao estreita e historico imutavel. */
import { createHash, randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/core/config/load-env';
import type { DrizzleClient } from '../src/core/database/database.module';
import { TenantDatabase } from '../src/core/database/tenant-database.service';

const { env } = loadEnv();
const RUN = Date.now().toString().slice(-8);
const appClient = postgres({
  host: env.DATABASE_HOST ?? 'localhost',
  port: Number(env.DATABASE_PORT ?? 5433),
  user: env.DATABASE_USER ?? 'movivo_app',
  password: env.DATABASE_PASSWORD,
  database: env.DATABASE_NAME ?? 'movivo',
  ssl: false,
  max: 3,
  prepare: false,
  idle_timeout: 5,
  onnotice: () => undefined,
});
const migratorClient = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
  user: env.MIGRATION_DATABASE_USER ?? 'movivo_migrator',
  password: env.MIGRATION_DATABASE_PASSWORD,
  database: env.DATABASE_NAME ?? 'movivo',
  ssl: false,
  max: 1,
  prepare: false,
  idle_timeout: 5,
  onnotice: () => undefined,
});
const tenant = new TenantDatabase(drizzle(appClient) as unknown as DrizzleClient);
const documentId = randomUUID();
let uploaderId = '';
let professionalId = '';

/**
 * `publish_knowledge_document` (Sprint 10) verifica proveniência ponta a ponta — não recebe
 * mais os chunks prontos por parâmetro: exige extração + staged chunks + embeddings já
 * gravados, cada hash conferido contra o conteúdo real (nunca um placeholder arbitrário).
 */
const DOCUMENT_CONTENT =
  'Descanso entre séries conforme protocolo: 60 a 90 segundos para hipertrofia.';
const DOCUMENT_SHA256 = createHash('sha256').update(DOCUMENT_CONTENT, 'utf8').digest('hex');
const CHUNK_TEXT = 'descanso entre series conforme protocolo';
const CHUNK_SHA256 = createHash('sha256').update(CHUNK_TEXT, 'utf8').digest('hex');
const ZERO_EMBEDDING = `[${new Array(1536).fill(0).join(',')}]`;

beforeAll(async () => {
  [uploaderId, professionalId] = await tenant.runAsSystem(async (tx) => {
    const rows = (await tx.execute(sql`
      INSERT INTO users (phone_number, name, role, cref_active) VALUES
        (${`+5551${RUN}1`}, 'Uploader RAG', 'ADMIN', false),
        (${`+5551${RUN}2`}, 'Revisor RAG', 'PROFESSIONAL', true)
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    return [rows[0].id, rows[1].id];
  });
  await tenant.runAsUser(uploaderId, 'ADMIN', async (tx) => {
    await tx.execute(sql`
      INSERT INTO knowledge_documents (
        id, title, topic, original_filename, mime_type, size_bytes, sha256, uploaded_by, logical_key
      ) VALUES (
        ${documentId}::uuid, 'Fonte RAG integrada', 'descanso', 'fonte.md', 'text/markdown',
        80, ${DOCUMENT_SHA256}, ${uploaderId}::uuid, 'fonte-rag-integrada'
      )
    `);
    await tx.execute(sql`
      INSERT INTO knowledge_document_blobs (document_id, payload, retained_until)
      VALUES (${documentId}::uuid, ${Buffer.from('conteudo aprovado')}, now() + interval '30 days')
    `);
  });
}, 30_000);

afterAll(async () => {
  // Achado 2026-08-18: sem isto, o "Revisor RAG" fica com `cref_active = true` pra
  // sempre — `assign_unique_active_professional` (chamado no submit real da anamnese)
  // exige EXATAMENTE um profissional ativo e passa a falhar com 500 pra qualquer
  // submissão feita depois desta suíte rodar contra um Postgres persistente (o de dev,
  // não o efêmero do CI). Os documentos/reviews continuam intactos — são histórico
  // imutável por design, não resíduo de teste.
  await tenant.runAsSystem((tx) =>
    tx.execute(sql`UPDATE users SET cref_active = false WHERE id = ${professionalId}::uuid`),
  );
  await appClient.end({ timeout: 5 });
  await migratorClient.end({ timeout: 5 });
});

describe('documentos RAG no banco', () => {
  it('recusa publicacao antes da revisao profissional', async () => {
    await expect(
      tenant.runAsUser(professionalId, 'PROFESSIONAL', (tx) =>
        tx.execute(sql`SELECT public.publish_knowledge_document(${documentId}::uuid)`),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });

  it('publica exatamente um trecho depois da aprovacao CREF', async () => {
    const published = await tenant.runAsUser(professionalId, 'PROFESSIONAL', async (tx) => {
      // Proveniência ponta a ponta: extração → staged chunk → embedding, cada hash
      // conferido contra o conteúdo real (`publish_knowledge_document` recusa placeholder).
      await tx.execute(sql`
        INSERT INTO knowledge_document_events (document_id, sequence, status, stage)
        VALUES (${documentId}::uuid, 1, 'INDEXING', 'STAGING')
      `);
      await tx.execute(sql`
        INSERT INTO knowledge_document_extractions (
          document_id, content, content_sha256, parser_version, detected_mime_type
        ) VALUES (
          ${documentId}::uuid, ${DOCUMENT_CONTENT}, ${DOCUMENT_SHA256}, 'test-v1', 'text/markdown'
        )
      `);
      const [staged] = (await tx.execute(sql`
        INSERT INTO knowledge_staged_chunks (
          document_id, chunk_index, chunk_text, chunk_sha256, extraction_sha256
        ) VALUES (
          ${documentId}::uuid, 0, ${CHUNK_TEXT}, ${CHUNK_SHA256}, ${DOCUMENT_SHA256}
        )
        RETURNING id
      `)) as unknown as Array<{ id: string }>;
      await tx.execute(sql`
        INSERT INTO knowledge_chunk_embeddings (staged_chunk_id, chunk_sha256, embedding, model)
        VALUES (${staged.id}::uuid, ${CHUNK_SHA256}, ${ZERO_EMBEDDING}::vector, 'test-fake')
      `);
      await tx.execute(sql`
        INSERT INTO knowledge_document_reviews (document_id, decision, note, reviewer_id)
        VALUES (${documentId}::uuid, 'APPROVED', 'revisao profissional integrada', ${professionalId}::uuid)
      `);
      return tx.execute(sql`
        SELECT public.publish_knowledge_document(${documentId}::uuid) AS count
      `) as unknown as Promise<Array<{ count: number }>>;
    });
    expect(Number(published[0]?.count)).toBe(1);
    const [result] = await appClient<{ chunks: number; days: number }[]>`
      SELECT count(chunk.id)::int AS chunks,
        floor(extract(epoch FROM (blob.retained_until - now())) / 86400)::int AS days
      FROM knowledge_documents document
      LEFT JOIN knowledge_base chunk ON chunk.document_id = document.id
      LEFT JOIN knowledge_document_blobs blob ON blob.document_id = document.id
      WHERE document.id = ${documentId}::uuid
      GROUP BY blob.retained_until
    `;
    expect(result?.chunks).toBe(1);
    expect(result?.days).toBeGreaterThanOrEqual(364);
  });

  it.each([
    [
      'documento',
      () =>
        appClient`UPDATE knowledge_documents SET title = 'alterado' WHERE id = ${documentId}::uuid`,
    ],
    [
      'revisao',
      () =>
        appClient`DELETE FROM knowledge_document_reviews WHERE document_id = ${documentId}::uuid`,
    ],
    [
      'payload',
      () =>
        appClient`UPDATE knowledge_document_blobs SET payload = 'x'::bytea WHERE document_id = ${documentId}::uuid`,
    ],
  ])('%s e imutavel para runtime com 42501', async (_label, mutation) => {
    await expect(mutation()).rejects.toMatchObject({ code: '42501' });
  });

  it('trigger protege o historico ate para a role de migracao', async () => {
    await expect(
      migratorClient`UPDATE knowledge_documents SET title = 'alterado' WHERE id = ${documentId}::uuid`,
    ).rejects.toMatchObject({ code: '55000' });
  });
});
