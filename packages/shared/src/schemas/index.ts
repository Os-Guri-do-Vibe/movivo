/**
 * Schemas Zod compartilhados (DTOs de contrato entre `apps/api` e `apps/web`).
 *
 * Convenção de nomes: `<recurso>.schema.ts`, export `<nome>Schema` + type inferido.
 */
export * from './agent-config.schema';
export * from './anamnesis.schema';
export * from './auth.schema';
export * from './common.schema';
export * from './consent.schema';
export * from './control-center.schema';
export * from './protocol.schema';
export * from './subscription.schema';
