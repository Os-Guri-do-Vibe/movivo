/**
 * Adaptador MOCK do gateway (US-4.1) — implementa a MESMA interface dos provedores reais, sem
 * rede/sem conta. É o que roda em dev/CI (gateway real é bloqueador de lançamento, não de dev).
 *
 * Emite os eventos de webhook simulados do ciclo de vida (checkout confirmado, pagamento falho,
 * cancelamento, reembolso) via `emit()`, para o `SubscriptionService`/testes exercitarem a
 * máquina de estados sem um provedor real. `parseWebhookEvent` aceita um corpo JSON já no
 * formato normalizado (sem assinatura — dev).
 */
import { randomUUID } from 'node:crypto';
import { PinoLogger } from 'nestjs-pino';

import {
  type CheckoutSession,
  type CreateCheckoutInput,
  type GatewayEvent,
  type GatewayEventType,
  type GatewaySubscription,
  type PaymentGateway,
} from './payment-gateway.types';

export class MockGateway implements PaymentGateway {
  readonly name = 'MOCK' as const;

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext('MockGateway');
    this.logger.warn('gateway de pagamento em modo MOCK — nenhuma cobrança real (dev/CI)');
  }

  hasCredentials(): boolean {
    return true; // o mock está sempre "configurado"
  }

  createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const externalSessionId = `mock_cs_${randomUUID()}`;
    this.logger.info(
      { userId: input.userId, plan: input.plan, method: input.method },
      'checkout MOCK criado',
    );
    // URL fake — o frontend (US-4.6) trata; nenhuma cobrança acontece.
    return Promise.resolve({
      checkoutUrl: `https://mock.checkout/${externalSessionId}`,
      externalSessionId,
    });
  }

  /** Dev: o corpo já é o `GatewayEvent` normalizado em JSON; sem verificação de assinatura. */
  parseWebhookEvent(rawBody: Buffer): GatewayEvent | null {
    try {
      return JSON.parse(rawBody.toString('utf8')) as GatewayEvent;
    } catch {
      return null;
    }
  }

  cancelSubscription(externalSubscriptionId: string): Promise<void> {
    this.logger.info({ externalSubscriptionId }, 'cancelamento MOCK');
    return Promise.resolve();
  }

  getSubscription(externalSubscriptionId: string): Promise<GatewaySubscription | null> {
    return Promise.resolve({ externalSubscriptionId, status: 'active' });
  }

  /**
   * Simula um evento de webhook do provedor (dev/CI). Retorna o `GatewayEvent` normalizado que
   * o webhook real entregaria — o `SubscriptionService.applyGatewayEvent` o aplica.
   */
  emit(
    type: GatewayEventType,
    params: {
      userId: string;
      externalSubscriptionId?: string;
      plan?: GatewayEvent['plan'];
      priceCents?: number;
    },
  ): GatewayEvent {
    return {
      type,
      eventId: `mock_evt_${randomUUID()}`,
      externalSubscriptionId: params.externalSubscriptionId ?? `mock_sub_${randomUUID()}`,
      userId: params.userId,
      plan: params.plan,
      priceCents: params.priceCents,
    };
  }
}
