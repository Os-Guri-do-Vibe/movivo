import { Injectable } from '@nestjs/common';

import { EMBEDDING_DIMENSIONS } from '../database/schema/knowledge-base';

export interface EmbeddingPort {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export const EMBEDDING_PORT = Symbol('MOVIVO_EMBEDDING_PORT');

function hashToken(token: string): number {
  let hash = 5381;
  for (let index = 0; index < token.length; index++) {
    hash = (hash * 33 + token.charCodeAt(index)) >>> 0;
  }
  return hash % EMBEDDING_DIMENSIONS;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

/** Fake deterministico usado em dev/CI; a implementacao real pluga na mesma porta. */
@Injectable()
export class FakeEmbedding implements EmbeddingPort {
  embed(text: string): Promise<number[]> {
    const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
    for (const token of tokenize(text)) {
      const index = hashToken(token);
      vector[index] = (vector[index] ?? 0) + 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0)) || 1;
    return Promise.resolve(vector.map((item) => item / norm));
  }

  embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }
}
