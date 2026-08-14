/**
 * Contrato do gateway de pagamento (US-4.1) — o `PaymentGatewayService`/adaptadores são o
 * ÚNICO ponto autorizado a falar com Stripe/Asaas (padrão do `LLMRouter`). Nenhum outro
 * módulo importa SDK/HTTP de gateway (teste estrutural garante). Trocar de provedor é config.
 *
 * Dado de cartão NUNCA passa pelo backend (PCI-DSS): o checkout é hospedado pelo gateway;
 * guardamos só `externalSubscriptionId`/`status`/`plan`/`priceCents`.
 */
import type { SubscriptionPlan } from '../subscription-model';

export type GatewayName = 'MOCK' | 'STRIPE' | 'ASAAS';

/** Meio de pagamento do checkout (decisão do fundador: PIX avulso ou cartão recorrente). */
export type PaymentMethod = 'CARD' | 'PIX';

export interface CreateCheckoutInput {
  userId: string;
  plan: SubscriptionPlan;
  priceCents: number;
  method: PaymentMethod;
  /** Versão dos Termos aceita no checkout (registro contratual — US-4.1.3). */
  termsVersion: string;
  /** Retorno do checkout hospedado (US-4.6). */
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  /** URL hospedada do gateway para onde o frontend redireciona (US-4.6). */
  checkoutUrl: string;
  /** Id da sessão de checkout no provedor (para conciliação). */
  externalSessionId: string;
}

/** Tipos de evento de webhook normalizados (o adaptador mapeia o payload do provedor nisto). */
export type GatewayEventType =
  'CHECKOUT_CONFIRMED' | 'PAYMENT_FAILED' | 'SUBSCRIPTION_CANCELED' | 'REFUNDED';

export interface GatewayEvent {
  type: GatewayEventType;
  /** Id do evento no provedor — chave de idempotência do webhook (US-4.2). */
  eventId: string;
  /** Id da assinatura no provedor — chave de idempotência da ativação (uniqueIndex). */
  externalSubscriptionId: string;
  /** Titular alvo (mapeado do metadata do provedor). */
  userId: string;
  plan?: SubscriptionPlan;
  priceCents?: number;

  // ---- Liquidação (US-8.5). Opcionais: nem todo evento move dinheiro. ----
  /**
   * Valor **efetivamente movimentado** em centavos, com sinal. Positivo em cobrança
   * liquidada, **negativo** em estorno/chargeback — é o sinal que faz `sum(amount_cents)`
   * devolver o líquido sem nenhum CASE. Ausente ⇒ o worker cai em `priceCents`.
   */
  amountCents?: number;
  /** Taxa retida pelo provedor, em centavos positivos. Ausente ⇒ taxa desconhecida (≠ zero). */
  feeCents?: number;
  /** Instante da liquidação NO GATEWAY (ISO 8601), não a chegada do webhook. */
  occurredAt?: string;
}

export interface GatewaySubscription {
  externalSubscriptionId: string;
  status: string;
}

/** Adaptador de um provedor de pagamento. Real (Stripe/Asaas) ou MOCK (dev/CI). */
export interface PaymentGateway {
  readonly name: GatewayName;
  /** `false` quando a chave não foi provisionada — o factory cai no MOCK. */
  hasCredentials(): boolean;
  createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession>;
  /**
   * Verifica assinatura (Stripe `constructEvent` / Asaas HMAC+`timingSafeEqual`) + parseia o
   * webhook em `GatewayEvent`. `null` se assinatura inválida/replay/evento desconhecido — o
   * controller responde 200 e não processa (não vaza QUAL camada falhou).
   */
  parseWebhookEvent(
    rawBody: Buffer,
    signature: string | undefined,
    timestamp: string | undefined,
  ): GatewayEvent | null;
  cancelSubscription(externalSubscriptionId: string): Promise<void>;
  getSubscription(externalSubscriptionId: string): Promise<GatewaySubscription | null>;
}

export const PAYMENT_GATEWAY = Symbol('MOVIVO_PAYMENT_GATEWAY');

/** Falha do gateway (sem credencial, provedor indisponível, evento inválido). */
export class PaymentGatewayError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PaymentGatewayError';
  }
}
