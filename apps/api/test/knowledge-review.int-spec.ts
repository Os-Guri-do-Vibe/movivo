import { migrationPostgresTls } from '../src/core/database/postgres-tls';
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
  ssl: migrationPostgresTls(env, env.DATABASE_HOST ?? 'localhost'),
  port: Number(env.DATABASE_PORT ?? 5433),
  user: env.DATABASE_USER ?? 'movivo_app',
  password: env.DATABASE_PASSWORD,
  database: env.DATABASE_NAME ?? 'movivo',

  max: 3,
  prepare: false,
  idle_timeout: 5,
  onnotice: () => undefined,
});
const migratorClient = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
  ssl: migrationPostgresTls(env, env.MIGRATION_DATABASE_HOST ?? 'localhost'),
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
  user: env.MIGRATION_DATABASE_USER ?? 'movivo_migrator',
  password: env.MIGRATION_DATABASE_PASSWORD,
  database: env.DATABASE_NAME ?? 'movivo',

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
      INSERT INTO staff (phone_number, email, name, role, password_hash, cref_active) VALUES
        (${`+5551${RUN}1`}, ${`uploader-rag-${RUN}@movivo.test`}, 'Uploader RAG', 'ADMIN', 'x', false),
        (${`+5551${RUN}2`}, ${`revisor-rag-${RUN}@movivo.test`}, 'Revisor RAG', 'PROFESSIONAL', 'x', true)
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
    tx.execute(sql`UPDATE staff SET cref_active = false WHERE id = ${professionalId}::uuid`),
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

describe('exclusão definitiva de artigo (delete_knowledge_document)', () => {
  const remaining = async () => {
    const [counts] = await appClient<
      {
        documents: number;
        events: number;
        reviews: number;
        extractions: number;
        staged: number;
        embeddings: number;
        chunks: number;
        blobs: number;
      }[]
    >`
      SELECT
        (SELECT count(*) FROM knowledge_documents WHERE id = ${documentId}::uuid)::int AS documents,
        (SELECT count(*) FROM knowledge_document_events WHERE document_id = ${documentId}::uuid)::int AS events,
        (SELECT count(*) FROM knowledge_document_reviews WHERE document_id = ${documentId}::uuid)::int AS reviews,
        (SELECT count(*) FROM knowledge_document_extractions WHERE document_id = ${documentId}::uuid)::int AS extractions,
        (SELECT count(*) FROM knowledge_staged_chunks WHERE document_id = ${documentId}::uuid)::int AS staged,
        (SELECT count(*) FROM knowledge_chunk_embeddings e
           JOIN knowledge_staged_chunks s ON s.id = e.staged_chunk_id
           WHERE s.document_id = ${documentId}::uuid)::int AS embeddings,
        (SELECT count(*) FROM knowledge_base WHERE document_id = ${documentId}::uuid)::int AS chunks,
        (SELECT count(*) FROM knowledge_document_blobs WHERE document_id = ${documentId}::uuid)::int AS blobs
    `;
    return counts;
  };

  it('recusa quem não é ADMIN, mesmo com o documento existindo', async () => {
    await expect(
      tenant.runAsUser(professionalId, 'PROFESSIONAL', (tx) =>
        tx.execute(sql`SELECT public.delete_knowledge_document(${documentId}::uuid)`),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    expect((await remaining())?.documents).toBe(1);
  });

  it('a runtime não consegue apagar o histórico por fora da função', async () => {
    await expect(
      appClient`DELETE FROM knowledge_document_events WHERE document_id = ${documentId}::uuid`,
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('documento inexistente falha sem alterar nada', async () => {
    await expect(
      tenant.runAsUser(uploaderId, 'ADMIN', (tx) =>
        tx.execute(sql`SELECT public.delete_knowledge_document(${randomUUID()}::uuid)`),
      ),
    ).rejects.toMatchObject({ cause: { code: 'P0002' } });
  });

  it('ADMIN remove documento, original, texto, trechos e vetores do banco', async () => {
    const before = await remaining();
    expect(before).toMatchObject({ documents: 1, chunks: 1, staged: 1, embeddings: 1, blobs: 1 });

    const removed = await tenant.runAsUser(
      uploaderId,
      'ADMIN',
      (tx) =>
        tx.execute(sql`
        SELECT public.delete_knowledge_document(${documentId}::uuid) AS chunks
      `) as unknown as Promise<Array<{ chunks: number }>>,
    );
    expect(Number(removed[0]?.chunks)).toBe(1);

    expect(await remaining()).toEqual({
      documents: 0,
      events: 0,
      reviews: 0,
      extractions: 0,
      staged: 0,
      embeddings: 0,
      chunks: 0,
      blobs: 0,
    });
  });

  it('religa os triggers de imutabilidade depois de excluir', async () => {
    const [state] = await migratorClient<{ disabled: number }[]>`
      SELECT count(*)::int AS disabled FROM pg_trigger
      WHERE tgname LIKE 'trg_knowledge_%_immutable' AND tgenabled = 'D'
    `;
    expect(state?.disabled).toBe(0);
    const other = randomUUID();
    await tenant.runAsUser(uploaderId, 'ADMIN', async (tx) => {
      await tx.execute(sql`
        INSERT INTO knowledge_documents (
          id, title, topic, original_filename, mime_type, size_bytes, sha256, uploaded_by, logical_key
        ) VALUES (
          ${other}::uuid, 'Outro', 'descanso', 'outro.md', 'text/markdown',
          10, ${createHash('sha256').update(other).digest('hex')}, ${uploaderId}::uuid, ${`outro-${RUN}`}
        )
      `);
    });
    await expect(
      migratorClient`UPDATE knowledge_documents SET title = 'x' WHERE id = ${other}::uuid`,
    ).rejects.toMatchObject({ code: '55000' });
  });
});

describe('artigo cujo texto extraído difere do arquivo original (PDF/Word)', () => {
  it('publica pelo hash do próprio texto, aprovado automaticamente pelo ADMIN, e exclui', async () => {
    const id = randomUUID();
    const original = Buffer.from('%PDF-1.7 bytes binarios do arquivo original');
    const originalSha = createHash('sha256').update(original).digest('hex');
    const text = 'Volume semanal de series modula a hipertrofia em adultos treinados.';
    const textSha = createHash('sha256').update(text, 'utf8').digest('hex');
    const chunkSha = createHash('sha256').update(text, 'utf8').digest('hex');
    expect(originalSha).not.toBe(textSha);

    await tenant.runAsUser(uploaderId, 'ADMIN', async (tx) => {
      await tx.execute(sql`
        INSERT INTO knowledge_documents (
          id, title, topic, category, original_filename, mime_type, size_bytes, sha256, uploaded_by, logical_key
        ) VALUES (
          ${id}::uuid, 'Artigo PDF', 'evidência científica', 'SCIENTIFIC_EVIDENCE', 'artigo.pdf',
          'application/pdf', ${original.byteLength}, ${originalSha}, ${uploaderId}::uuid, ${`artigo-pdf-${RUN}`}
        )
      `);
      await tx.execute(sql`
        INSERT INTO knowledge_document_blobs (document_id, payload, retained_until)
        VALUES (${id}::uuid, ${original}, now() + interval '30 days')
      `);
    });

    // O que o worker faz: extração, trechos, aprovação do admin que enviou e embedding.
    const published = await tenant.runAsSystem(async (tx) => {
      await tx.execute(sql`
        INSERT INTO knowledge_document_extractions (
          document_id, content, content_sha256, parser_version, detected_mime_type
        ) VALUES (${id}::uuid, ${text}, ${textSha}, 'article-text-v1', 'application/pdf')
      `);
      const [staged] = (await tx.execute(sql`
        INSERT INTO knowledge_staged_chunks (
          document_id, chunk_index, chunk_text, chunk_sha256, extraction_sha256
        ) VALUES (${id}::uuid, 0, ${text}, ${chunkSha}, ${textSha}) RETURNING id
      `)) as unknown as Array<{ id: string }>;
      await tx.execute(sql`
        INSERT INTO knowledge_chunk_embeddings (staged_chunk_id, chunk_sha256, embedding, model)
        VALUES (${staged.id}::uuid, ${chunkSha}, ${ZERO_EMBEDDING}::vector, 'test-fake')
      `);
      await tx.execute(sql`
        INSERT INTO knowledge_document_reviews (document_id, decision, note, reviewer_id)
        VALUES (${id}::uuid, 'APPROVED', 'publicação direta pelo administrador', ${uploaderId}::uuid)
      `);
      await tx.execute(sql`
        INSERT INTO knowledge_document_events (document_id, sequence, status, stage)
        VALUES (${id}::uuid, 1, 'INDEXING', 'INDEXING')
      `);
      return tx.execute(sql`
        SELECT public.publish_knowledge_document(${id}::uuid) AS count
      `) as unknown as Promise<Array<{ count: number }>>;
    });
    expect(Number(published[0]?.count)).toBe(1);

    await tenant.runAsUser(uploaderId, 'ADMIN', (tx) =>
      tx.execute(sql`SELECT public.delete_knowledge_document(${id}::uuid)`),
    );
    const [left] = await appClient<{ n: number }[]>`
      SELECT (SELECT count(*) FROM knowledge_documents WHERE id = ${id}::uuid)::int
           + (SELECT count(*) FROM knowledge_base WHERE document_id = ${id}::uuid)::int AS n
    `;
    expect(left?.n).toBe(0);
  });
});
