/**
 * Contrato do gateway de pagamento (US-4.1) — o `PaymentGatewayService`/adaptadores são o
 * ÚNICO ponto autorizado a falar com Asaas (padrão do `LLMRouter`). Nenhum outro
 * módulo importa SDK/HTTP de gateway (teste estrutural garante). Trocar de provedor é config.
 *
 * Dados de cartão ficam somente em memória durante a chamada transparente ao Asaas Sandbox.
 * Nunca são persistidos nem logados. Produção é bloqueada até validação PCI/QSA.
 */
import type { CheckoutCard, CheckoutPayer } from '@movivo/shared';
import type { SubscriptionPlan } from '../subscription-model';

export type GatewayName = 'MOCK' | 'ASAAS';

export type PaymentMethod = 'CARD' | 'PIX' | 'PIX_AUTOMATIC';

export interface StartPaymentInput {
  subscriptionId: string;
  userId: string;
  plan: SubscriptionPlan;
  monthlyCents: number;
  totalCents: number;
  months: number;
  method: PaymentMethod;
  payer: CheckoutPayer;
  card?: CheckoutCard;
  installments?: number;
  /** IP real do navegador, exigido pelo endpoint de cartão do Asaas. */
  remoteIp: string;
  termsVersion: string;
  idempotencyKey?: string;
}

export interface PaymentQrCode {
  encodedImage: string;
  payload: string;
  expirationDate: string;
}

export interface PaymentStartResult {
  status: 'PENDING' | 'CONFIRMED' | 'REFUSED' | 'EXPIRED';
  externalCustomerId: string;
  externalSubscriptionId?: string;
  externalPaymentId?: string;
  externalInstallmentId?: string;
  externalAuthorizationId?: string;
  qrCode?: PaymentQrCode;
  nextBillingAt?: string;
}

/** Tipos de evento de webhook normalizados (o adaptador mapeia o payload do provedor nisto). */
export type GatewayEventType =
  | 'CHECKOUT_CONFIRMED'
  | 'AUTHORIZATION_ACTIVE'
  | 'PAYMENT_FAILED'
  | 'SUBSCRIPTION_CANCELED'
  | 'REFUNDED';

export interface GatewayEvent {
  type: GatewayEventType;
  /** Id do evento no provedor — chave de idempotência do webhook (US-4.2). */
  eventId: string;
  /** Id externo principal do contrato (assinatura, parcelamento ou cobrança). */
  externalSubscriptionId: string;
  externalPaymentId?: string;
  externalInstallmentId?: string;
  externalAuthorizationId?: string;
  externalCustomerId?: string;
  externalCheckoutSessionId?: string;
  externalPriceId?: string;
  termsVersion?: string;
  /** Pode vir ausente no Asaas; o serviço resolve pelo ID externo sob RLS de sistema. */
  userId?: string;
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
  /** Vencimento (competência) da cobrança, ISO 8601 — âncora do período pago recorrente. */
  dueDate?: string;
}

/**
 * Evento **autenticado** que não muda nada na MOVIVO (ex.: `PAYMENT_CREATED`). Precisa de
 * 200: o Asaas trata qualquer outra resposta como falha, e no envio sequencial um evento
 * falhando segura os seguintes até pausar a fila.
 */
export interface IgnoredWebhookEvent {
  readonly ignored: true;
  /** Nome do evento no provedor — seguro para log (não carrega dado de cobrança). */
  readonly eventName: string;
}

export function isIgnoredWebhookEvent(
  value: GatewayEvent | IgnoredWebhookEvent,
): value is IgnoredWebhookEvent {
  return 'ignored' in value;
}

export interface GatewaySubscription {
  externalSubscriptionId: string;
  status: string;
}

export interface ExternalContractRefs {
  subscriptionId?: string | null;
  paymentId?: string | null;
  installmentId?: string | null;
  authorizationId?: string | null;
}

/** Adaptador de um provedor de pagamento. Real (Asaas) ou MOCK (dev/CI). */
export interface PaymentGateway {
  readonly name: GatewayName;
  /** `false` quando a chave não foi provisionada — o factory cai no MOCK. */
  hasCredentials(): boolean;
  startPayment(input: StartPaymentInput): Promise<PaymentStartResult>;
  /**
   * Verifica o token do webhook Asaas em tempo constante + parseia o webhook em
   * `GatewayEvent`. `null` SOMENTE quando a origem não foi provada (token/assinatura
   * inválidos, corpo malformado) — o controller responde 401 sem dizer qual camada falhou.
   * Evento autenticado sem efeito para a MOVIVO → `IgnoredWebhookEvent` (200).
   */
  parseWebhookEvent(
    rawBody: Buffer,
    signature: string | undefined,
    timestamp: string | undefined,
  ): GatewayEvent | IgnoredWebhookEvent | null;
  /** Cancela a cobrança/contrato pendente. Referência já inexistente no provedor é sucesso. */
  cancelContract(refs: ExternalContractRefs): Promise<void>;
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
