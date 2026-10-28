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
export * from './protocol-renewal.schema';
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
export * from './substitution.schema';
export * from './workout.schema';
export * from './workout-share-card.schema';
export * from './checkin-weekly.schema';

// Treino multimodal, Estado do Aluno, nutrição, corpo, check-in, decisões e eventos.
export * from './training/modality.schema';
export * from './training/strength.schema';
export * from './training/endurance.schema';
export * from './training/plan.schema';
export * from './training/execution.schema';
export * from './student/goal.schema';
export * from './student/student-state.schema';
export * from './nutrition/nutrition.schema';
export * from './body/body.schema';
export * from './check-in/check-in.schema';
export * from './coaching/coaching.schema';
export * from './events/domain-events.schema';
export * from './methodology/fields';
export * from './methodology/domains';
export * from './methodology/studio.schema';
export * from './onboarding/onboarding.schema';
export * from './plan/plan-read.schema';
