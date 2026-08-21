import { customType } from 'drizzle-orm/pg-core';

/** Dimensão do `text-embedding-3-small` e do embedding fake de dev/CI. */
export const EMBEDDING_DIMENSIONS = 1536;

/** Tipo pgvector compartilhado entre o corpus publicado e o staging. */
export const embeddingVector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${EMBEDDING_DIMENSIONS})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(',').filter(Boolean).map(Number);
  },
});
