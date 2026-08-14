export const CHECKIN_INBOUND_EVENT = 'checkin.inbound.received';

/**
 * US-8.1 — toque no quick reply diário de treino. Consultado ANTES do check-in na
 * cadeia de inbound: os prefixos de botão (`workout:` / `checkin:`) não se sobrepõem,
 * e o handler de treino devolve `false` sem consumir a `routeKey` quando não é dele.
 */
export const WORKOUT_INBOUND_EVENT = 'workout.inbound.received';

/** O conteudo fica efemero no Redis; o evento transporta somente referencias opacas. */
export interface CheckinInboundEvent {
  userId: string;
  routeKey: string;
}

export type { DashboardQueueReason } from './dashboard-queue-events.service';
