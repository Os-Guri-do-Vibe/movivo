/**
 * Porta de embedding (US-3.3). A geração de embedding fica atrás desta porta para que
 * o dev/CI rode **sem chave** com um fake determinístico; a impl real (OpenAI
 * `text-embedding-3-small`, endpoint ZDR) pluga quando a chave existir — sem tocar o RAG.
 */
import { Injectable } from '@nestjs/common';

import { EMBEDDING_DIMENSIONS } from '../../../core/database/schema/knowledge-base';

export interface EmbeddingPort {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export const EMBEDDING_PORT = Symbol('MOVIVO_EMBEDDING_PORT');

/** djb2 → índice de dimensão (determinístico, estável entre processos). */
function hashToken(token: string): number {
  let h = 5381;
  for (let i = 0; i < token.length; i++) h = (h * 33 + token.charCodeAt(i)) >>> 0;
  return h % EMBEDDING_DIMENSIONS;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos combinantes
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

/**
 * Embedding fake determinístico: saco-de-palavras hasheado, L2-normalizado. O cosseno entre
 * dois textos ~ sobreposição de termos — suficiente para exercitar retrieval/threshold/rerank
 * sem rede.
 *
 * ponytail: bag-of-words, não semântico — só texto curto e com sobreposição real de termos
 * ultrapassa thresholds altos. O `text-embedding-3-small` real (impl plugável) trata chunks
 * longos e sinônimos. Ceiling reconhecido; upgrade = impl OpenAI atrás desta mesma porta.
 */
@Injectable()
export class FakeEmbedding implements EmbeddingPort {
  embed(text: string): Promise<number[]> {
    const vec = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
    for (const token of tokenize(text)) {
      const i = hashToken(token);
      vec[i] = (vec[i] ?? 0) + 1;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return Promise.resolve(vec.map((v) => v / norm));
  }

  embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}
