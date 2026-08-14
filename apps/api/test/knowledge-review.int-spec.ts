/** Gate real do RAG: revisao CREF, publicacao estreita e historico imutavel. */
import { randomUUID } from 'node:crypto';

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
        id, title, topic, original_filename, mime_type, size_bytes, sha256, uploaded_by
      ) VALUES (
        ${documentId}::uuid, 'Fonte RAG integrada', 'descanso', 'fonte.md', 'text/markdown',
        80, ${documentId.replaceAll('-', '').padEnd(64, '0')}, ${uploaderId}::uuid
      )
    `);
    await tx.execute(sql`
      INSERT INTO knowledge_document_blobs (document_id, payload, retained_until)
      VALUES (${documentId}::uuid, ${Buffer.from('conteudo aprovado')}, now() + interval '30 days')
    `);
  });
}, 30_000);

afterAll(async () => {
  await appClient.end({ timeout: 5 });
  await migratorClient.end({ timeout: 5 });
});

const chunks = JSON.stringify([
  {
    chunkText: 'descanso entre series conforme protocolo',
    embedding: new Array<number>(1536).fill(0),
    topic: 'descanso',
    title: 'Fonte RAG integrada',
    sourceUrl: null,
    reliability: 5,
    chunkIndex: 0,
  },
]);

describe('documentos RAG no banco', () => {
  it('recusa publicacao antes da revisao profissional', async () => {
    await expect(
      tenant.runAsUser(professionalId, 'PROFESSIONAL', (tx) =>
        tx.execute(
          sql`SELECT public.publish_knowledge_document(${documentId}::uuid, ${chunks}::jsonb)`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });

  it('publica exatamente um trecho depois da aprovacao CREF', async () => {
    const published = await tenant.runAsUser(professionalId, 'PROFESSIONAL', async (tx) => {
      await tx.execute(sql`
        INSERT INTO knowledge_document_reviews (document_id, decision, note, reviewer_id)
        VALUES (${documentId}::uuid, 'APPROVED', 'revisao profissional integrada', ${professionalId}::uuid)
      `);
      return tx.execute(sql`
        SELECT public.publish_knowledge_document(${documentId}::uuid, ${chunks}::jsonb) AS count
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
