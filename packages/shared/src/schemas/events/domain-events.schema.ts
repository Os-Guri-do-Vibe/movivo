import { z } from 'zod';

/**
 * Eventos de domínio da v2. Persistidos em `domain_events` na MESMA transação da mudança de
 * estado (transactional outbox) e repassados às filas por um relé; consumidores são
 * idempotentes por `eventId`.
 */
export const domainEventTypeSchema = z.enum([
  'OnboardingCompleted',
  'StrategyDefined',
  'PlanVersionPublished',
  'NutritionPlanPublished',
  'SessionScheduled',
  'SessionRescheduled',
  'SessionExecuted',
  'SessionMissed',
  'FoodLogged',
  'CheckInSubmitted',
  'BodyAssessmentRecorded',
  'ConstraintChanged',
  'PreferenceObserved',
  'InboundMessageReceived',
  'ProposalCreated',
  'DecisionMade',
  'DecisionExecuted',
  'SafetySignalRaised',
  'ExceptionOpened',
  'ExceptionResolved',
  'MethodologyPublished',
  'SubscriptionActivated',
  'SubscriptionPaymentFailed',
  'SubscriptionCanceled',
]);
export type DomainEventType = z.infer<typeof domainEventTypeSchema>;

/**
 * Payload mínimo: referências (ids) e o necessário para rotear. O consumidor relê o estado
 * no banco; o evento não carrega dado de saúde em claro.
 */
export const domainEventPayloadSchema = z.record(
  z.string(),
  z.union([z.string().max(200), z.number(), z.boolean(), z.null()]),
);
export type DomainEventPayload = z.infer<typeof domainEventPayloadSchema>;
