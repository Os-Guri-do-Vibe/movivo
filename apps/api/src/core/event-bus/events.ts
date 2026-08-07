export const CHECKIN_INBOUND_EVENT = 'checkin.inbound.received';

/** O conteudo fica efemero no Redis; o evento transporta somente referencias opacas. */
export interface CheckinInboundEvent {
  userId: string;
  routeKey: string;
}

export type { DashboardQueueReason } from './dashboard-queue-events.service';
