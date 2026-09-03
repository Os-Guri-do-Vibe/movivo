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
export * from './expense.schema';
export * from './faq.schema';
export * from './guardrail.schema';
export * from './forbidden-topic.schema';
export * from './audit-search.schema';
export * from './ad-spend.schema';
export * from './partners.schema';
export * from './knowledge.schema';
export * from './exercise-catalog.schema';
export * from './workout.schema';
