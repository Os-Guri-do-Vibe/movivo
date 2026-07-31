/**
 * Indexação offline do corpus do RAG (US-3.3 / TASK-3.3.1).
 *
 * Chunking (~400-512 tokens, overlap 15%) → embeddings → grava em `knowledge_base`. NÃO é um
 * provider do request-path: a escrita exige a role privilegiada (o `movivo_app` de runtime só
 * lê o corpus — Sato §10.4). Recebe o client Drizzle por parâmetro (migrator no seed/teste;
 * na Sprint 5 o dashboard invoca com a role de indexação).
 */
import { knowledgeBase } from '../../../core/database/schema/knowledge-base';
import type { DrizzleClient } from '../../../core/database/database.module';
import type { EmbeddingPort } from './embedding.port';

/** ~4 chars/token → ~1800 chars ≈ 450 tokens; overlap 15%. */
const CHUNK_CHARS = 1800;
const OVERLAP_CHARS = 270;

export interface CorpusDocument {
  title: string;
  topic: string;
  content: string;
  sourceUrl?: string;
  reliability?: number;
}

/** Quebra o texto em janelas de ~CHUNK_CHARS com overlap. Texto curto → 1 chunk. */
export function chunkText(text: string, size = CHUNK_CHARS, overlap = OVERLAP_CHARS): string[] {
  const clean = text.trim();
  if (clean.length <= size) return [clean];
  const chunks: string[] = [];
  const step = size - overlap;
  for (let start = 0; start < clean.length; start += step) {
    chunks.push(clean.slice(start, start + size));
    if (start + size >= clean.length) break;
  }
  return chunks;
}

/** Indexa os documentos: gera embeddings e grava os chunks. Retorna quantos chunks gravou. */
export async function indexCorpus(
  db: DrizzleClient,
  docs: readonly CorpusDocument[],
  embedding: EmbeddingPort,
): Promise<number> {
  const rows: (typeof knowledgeBase.$inferInsert)[] = [];
  for (const doc of docs) {
    const chunks = chunkText(doc.content);
    const vectors = await embedding.embedBatch(chunks);
    chunks.forEach((chunk, i) => {
      rows.push({
        chunkText: chunk,
        embedding: vectors[i] ?? [],
        topic: doc.topic,
        title: doc.title,
        sourceUrl: doc.sourceUrl ?? null,
        reliability: doc.reliability ?? 3,
      });
    });
  }
  if (rows.length > 0) await db.insert(knowledgeBase).values(rows);
  return rows.length;
}
