/**
 * Indexação offline dos exemplos de intenção (US-3.4) — mesmo padrão do corpus RAG.
 *
 * Gera embeddings dos exemplos-semente e grava em `intent_examples`. NÃO é provider do
 * request-path: a escrita exige role privilegiada (o `movivo_app` só lê). Recebe o client
 * Drizzle por parâmetro (migrator no seed/teste; role de indexação em produção).
 */
import { intentExamples } from '../../../core/database/schema/intent-examples';
import type { DrizzleClient } from '../../../core/database/database.module';
import type { EmbeddingPort } from '../rag/embedding.port';
import type { IntentExampleSeed } from './intent-examples.seed';

/** Indexa os exemplos: gera embeddings e grava. Retorna quantos gravou. */
export async function indexIntentExamples(
  db: DrizzleClient,
  examples: readonly IntentExampleSeed[],
  embedding: EmbeddingPort,
): Promise<number> {
  const vectors = await embedding.embedBatch(examples.map((e) => e.text));
  const rows = examples.map((e, i) => ({
    intent: e.intent,
    text: e.text,
    embedding: vectors[i] as number[],
  }));
  if (rows.length === 0) return 0;
  await db.insert(intentExamples).values(rows);
  return rows.length;
}
