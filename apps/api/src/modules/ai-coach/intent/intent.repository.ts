/**
 * IntentRepository (US-3.4) — busca kNN em `intent_examples` (PGVector).
 *
 * I/O de banco sem ramo, provado por integração (excluído da cobertura unitária como
 * `ai-job.repository`/`context.repository`). Lê o corpus global read-only via `movivo_app`.
 */
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DRIZZLE } from '../../../core/database/database.constants';
import type { DrizzleClient } from '../../../core/database/database.module';

interface KnnRow {
  intent: string;
  score: number;
}

export interface KnnMatch {
  intent: string;
  /** Cosseno do vizinho mais próximo (0..1). */
  confidence: number;
}

@Injectable()
export class IntentRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleClient) {}

  /** Vizinho mais próximo por cosseno. `null` se o corpus estiver vazio. */
  async classifyByKnn(vec: number[]): Promise<KnnMatch | null> {
    const literal = `[${vec.join(',')}]`;
    const rows = (await this.db.execute(sql`
      SELECT intent, 1 - (embedding <=> ${literal}::vector) AS score
      FROM intent_examples
      ORDER BY embedding <=> ${literal}::vector
      LIMIT 1
    `)) as unknown as KnnRow[];

    const top = rows[0];
    return top ? { intent: top.intent, confidence: Number(top.score) } : null;
  }
}
