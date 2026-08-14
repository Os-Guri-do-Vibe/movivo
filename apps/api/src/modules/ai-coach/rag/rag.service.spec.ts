/**
 * Unit — RagService (US-3.3): mapeamento, filtro pós-rerank e fail-safe anti-alucinação.
 * `db.execute` mockado (a busca densa real é exercida no int-spec).
 */
import { describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../../../core/config';
import type { DrizzleClient } from '../../../core/database/database.module';
import type { Redis } from 'ioredis';
import type { PinoLogger } from 'nestjs-pino';

import { RedisKeyBuilder } from '../../../core/redis';
import { FakeEmbedding } from './embedding.port';
import { FakeReranker } from './reranker.port';
import { RagService } from './rag.service';

function make(rows: unknown[]) {
  const db = { execute: vi.fn().mockResolvedValue(rows) } as unknown as DrizzleClient;
  const config = {
    rag: { minCosine: 0.75, rerankMinScore: 0.5, topK: 3, candidates: 20 },
  } as unknown as AppConfigService;
  const logger = { setContext: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
  const exec = vi.fn().mockResolvedValue([]);
  const incr = vi.fn();
  const pipeline = { incr, expire: vi.fn(), exec };
  incr.mockImplementation(() => pipeline);
  pipeline.expire.mockImplementation(() => pipeline);
  const redis = { pipeline: () => pipeline } as unknown as Redis;
  const rag = new RagService(
    db,
    new FakeEmbedding(),
    new FakeReranker(),
    config,
    logger,
    redis,
    new RedisKeyBuilder('movivo'),
  );
  return { rag, incr };
}

describe('RagService.retrieve', () => {
  it('fail-safe: nenhum chunk denso → [] (sem RAG)', async () => {
    const { rag, incr } = make([]);
    expect(await rag.retrieve('qualquer coisa')).toEqual([]);
    // Conta a consulta (TASK-7.5.3) mas não a recuperação útil.
    expect(incr).toHaveBeenCalledTimes(1);
  });

  it('mapeia trechos e filtra pelo score mínimo do rerank', async () => {
    const { rag, incr } = make([
      {
        id: '00000000-0000-0000-0000-000000000001',
        document_id: '00000000-0000-0000-0000-000000000010',
        chunk_text: 'descanso entre séries para hipertrofia',
        title: 'Descanso',
        source_url: 'http://x',
        score: 0.9,
      },
      {
        id: '00000000-0000-0000-0000-000000000002',
        document_id: null,
        chunk_text: 'bicicleta ergométrica cardio',
        title: 'Cardio',
        source_url: null,
        score: 0.8,
      },
    ]);
    const docs = await rag.retrieve('descanso entre séries');
    expect(docs.length).toBe(1); // o cardio é filtrado pelo rerank (< 0.5)
    expect(docs[0]?.title).toBe('Descanso');
    expect(docs[0]?.snippet).toContain('descanso');
    expect(docs[0]?.sourceUrl).toBe('http://x');
    expect(docs[0]?.documentId).toBe('00000000-0000-0000-0000-000000000010');
    expect(docs[0]?.score).toBeGreaterThanOrEqual(0.5);
    // Consulta + recuperação útil.
    expect(incr).toHaveBeenCalledTimes(2);
  });
});
