/**
 * Adaptador MOCK do gateway (US-4.1) — implementa a MESMA interface dos provedores reais, sem
 * rede/sem conta. É o que roda em dev/CI (gateway real é bloqueador de lançamento, não de dev).
 *
 * Emite os eventos de webhook simulados do ciclo de vida (checkout confirmado, pagamento falho,
 * cancelamento, reembolso) via `emit()`, para o `SubscriptionService`/testes exercitarem a
 * máquina de estados sem um provedor real. `parseWebhookEvent` aceita um corpo JSON já no
 * formato normalizado (sem assinatura — dev).
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { PinoLogger } from 'nestjs-pino';

import {
  type CheckoutSession,
  type CreateCheckoutInput,
  type GatewayEvent,
  type GatewayEventType,
  type GatewaySubscription,
  type PaymentGateway,
} from './payment-gateway.types';

/**
 * Segredo de webhook do MOCK — **dev-only** (o mock nunca roda em produção; lá é STRIPE/ASAAS
 * com o secret real). Permite ao teste gerar assinatura válida via `sign()` e exercitar
 * forjado/replay. ponytail: fixo de propósito; não é credencial de produção.
 */
export const MOCK_WEBHOOK_SECRET = 'mock-webhook-secret-dev';
const TOLERANCE_SECONDS = 300;

/** HMAC-SHA256 hex sobre `${timestamp}.${rawBody}` (estilo Asaas — o mock imita o real). */
function mockSignature(timestamp: string, rawBody: Buffer): string {
  return createHmac('sha256', MOCK_WEBHOOK_SECRET)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), rawBody]))
    .digest('hex');
}

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

  /**
   * Verifica a assinatura HMAC (+ janela de 300s) e parseia o corpo bruto no `GatewayEvent`
   * normalizado. Assinatura ausente/errada/expirada → `null` (o webhook responde 200 e ignora).
   * O corpo é o mesmo formato que `emit()` produz, serializado em JSON.
   */
  parseWebhookEvent(
    rawBody: Buffer,
    signature: string | undefined,
    timestamp: string | undefined,
  ): GatewayEvent | null {
    if (!signature || !timestamp) return null;
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > TOLERANCE_SECONDS) {
      return null;
    }
    const expected = Buffer.from(mockSignature(timestamp, rawBody), 'hex');
    let provided: Buffer;
    try {
      provided = Buffer.from(signature, 'hex');
    } catch {
      return null;
    }
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
    try {
      return JSON.parse(rawBody.toString('utf8')) as GatewayEvent;
    } catch {
      return null;
    }
  }

  /** Helper de teste/dev: assina um corpo bruto no formato que `parseWebhookEvent` espera. */
  sign(rawBody: Buffer, timestamp: string): string {
    return mockSignature(timestamp, rawBody);
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
