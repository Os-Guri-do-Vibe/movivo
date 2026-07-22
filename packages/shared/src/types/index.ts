/**
 * Tipos TypeScript compartilhados entre `apps/api` e `apps/web`.
 *
 * Esta pasta é o **contrato de tipos** do monorepo. Regras:
 *  - Nada de lógica, nada de dependência de plataforma (Node/browser).
 *  - Nada que carregue PII em formato "solto": identificadores de usuário são
 *    sempre `UserId` (branded), nunca `string` cru, para não vazarem por engano
 *    para prompts de LLM (regra do PII Scrubber, ARQUITETURA.md §5).
 */

/** Marca nominal para evitar troca acidental entre ids de entidades diferentes. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** UUID v4 (PK padrão de todas as tabelas — ARQUITETURA.md / schema lógico §9 de Lucas). */
export type Uuid = Brand<string, 'Uuid'>;

/** Id do usuário final. Chave de tenant isolation (Redis namespace + RLS Postgres). */
export type UserId = Brand<string, 'UserId'>;

/** Id do profissional CREF responsável pela assinatura do protocolo. */
export type ProfessionalId = Brand<string, 'ProfessionalId'>;

/** Timestamp ISO-8601 em UTC (ex.: `2026-07-22T13:45:00.000Z`). */
export type IsoDateTime = Brand<string, 'IsoDateTime'>;

/** Campos de auditoria temporal presentes em toda tabela. */
export interface Timestamps {
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

/** Envelope de paginação por cursor (padrão de API definido em ARQUITETURA.md §12.10). */
export interface Paginated<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/** Envelope de erro padronizado da API `v1`. */
export interface ApiErrorBody {
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
  /** Correlation id do request, para cruzar com os logs estruturados (LoggerModule). */
  readonly correlationId?: string;
}

/** Torna todas as propriedades (inclusive aninhadas) somente-leitura. */
export type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};
