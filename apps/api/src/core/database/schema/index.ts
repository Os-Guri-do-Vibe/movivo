/**
 * Barrel do schema Drizzle (TASK-0.4.1).
 *
 * É este objeto agregado que o `drizzle.config.ts` lê para gerar migrações e que
 * o `DatabaseModule` (US-0.3) injeta como tipo do client. Uma tabela que não for
 * reexportada aqui **não** entra na migração — por isso o arquivo é a checklist
 * viva das 9 tabelas-base do schema lógico de Lucas (`08-relatorio-lucas.md` §9).
 */
export * from './_shared';
export * from './enums';

// As 9 tabelas-base da Sprint 0.
export * from './users';
export * from './anamnesis-sessions';
export * from './consents';
export * from './protocols';
export * from './protocol-versions';
export * from './conversations';
export * from './checkins';
export * from './subscriptions';
export * from './ai-jobs';

// Sprint 1 — schema de autenticação (US-1.1 / TASK-1.1.5).
export * from './auth-sessions';
