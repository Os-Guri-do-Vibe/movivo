/**
 * `@movivo/shared` — superfície pública do pacote compartilhado do monorepo MOVIVO.
 *
 * Consumido por `apps/api` (NestJS) e `apps/web` (Next.js 15).
 * Mantenha este arquivo como **único** ponto de entrada: nada deve ser importado
 * por caminho profundo (`@movivo/shared/src/...`) fora deste barrel.
 */

/**
 * Versão da aplicação MOVIVO.
 *
 * Serve de prova de consumo cross-app (TASK-0.1.4) e, a partir da US-0.3,
 * é o valor reportado por `GET /api/v1/health` e exibido no rodapé do `apps/web`.
 */
export const APP_VERSION = '0.1.0';

/** Prefixo de versionamento da API REST (regra inegociável §12.10). */
export const API_VERSION_PREFIX = 'api/v1';

export * from './enums';
export * from './schemas';
export * from './types';
