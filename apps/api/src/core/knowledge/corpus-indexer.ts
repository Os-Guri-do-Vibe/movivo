import { knowledgeBase } from '../database/schema/knowledge-base';
import type { DrizzleClient } from '../database/database.module';
import type { EmbeddingPort } from './embedding.port';

const CHUNK_CHARS = 1800;
const OVERLAP_CHARS = 270;

export interface CorpusDocument {
  title: string;
  topic: string;
  content: string;
  sourceUrl?: string;
  reliability?: number;
}

export interface PreparedCorpusChunk {
  chunkText: string;
  embedding: number[];
  topic: string;
  title: string;
  sourceUrl: string | null;
  reliability: number;
  chunkIndex: number;
}

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

export async function prepareCorpus(
  docs: readonly CorpusDocument[],
  embedding: EmbeddingPort,
): Promise<PreparedCorpusChunk[]> {
  const rows: PreparedCorpusChunk[] = [];
  for (const doc of docs) {
    const chunks = chunkText(doc.content);
    const vectors = await embedding.embedBatch(chunks);
    chunks.forEach((chunk, chunkIndex) => {
      rows.push({
        chunkText: chunk,
        embedding: vectors[chunkIndex] ?? [],
        topic: doc.topic,
        title: doc.title,
        sourceUrl: doc.sourceUrl ?? null,
        reliability: doc.reliability ?? 3,
        chunkIndex,
      });
    });
  }
  return rows;
}

export async function indexCorpus(
  db: DrizzleClient,
  docs: readonly CorpusDocument[],
  embedding: EmbeddingPort,
): Promise<number> {
  const rows = await prepareCorpus(docs, embedding);
  if (rows.length > 0) await db.insert(knowledgeBase).values(rows);
  return rows.length;
}
