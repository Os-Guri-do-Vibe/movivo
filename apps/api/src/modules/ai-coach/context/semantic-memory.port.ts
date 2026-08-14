/**
 * Porta da camada semantic (RAG) do ContextService (US-3.2).
 *
 * O RAG de verdade é a US-3.3 (indexação PGVector + retrieval + reranker). A US-3.2 só
 * depende deste contrato e usa a implementação no-op abaixo; a US-3.3 substitui o provider
 * ligado ao token `SEMANTIC_MEMORY` no `AiCoachModule` — sem refactor do ContextService.
 */
import { Injectable } from '@nestjs/common';

export interface RagDoc {
  chunkId: string;
  documentId: string | null;
  title: string;
  snippet: string;
  sourceUrl?: string;
  score: number;
}

export interface SemanticMemoryPort {
  /** Trechos relevantes à `query` (só chamado em `DUVIDA_TECNICA`). `[]` = sem cobertura. */
  retrieve(query: string): Promise<RagDoc[]>;
}

export const SEMANTIC_MEMORY = Symbol('MOVIVO_SEMANTIC_MEMORY');

/** Default até a US-3.3 plugar o RAG real: nunca recupera nada (fail-safe anti-alucinação). */
@Injectable()
export class NoopSemanticMemory implements SemanticMemoryPort {
  retrieve(): Promise<RagDoc[]> {
    return Promise.resolve([]);
  }
}
