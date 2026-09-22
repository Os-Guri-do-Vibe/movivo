/**
 * Adaptadores reais dos gateways. Stripe usa apenas HTTP nativo do Node: checkout hospedado,
 * assinatura HMAC do webhook e operações de assinatura ficam confinados nesta fronteira.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { SubscriptionPlan } from '../subscription-model';
import {
  type CheckoutSession,
  type CreateCheckoutInput,
  type GatewayEvent,
  type GatewaySubscription,
  type PaymentGateway,
  PaymentGatewayError,
} from './payment-gateway.types';

/** Endpoints reais — únicos no repo, confinados aqui (marcador do teste estrutural). */
const STRIPE_API = 'https://api.stripe.com/v1';
const ASAAS_API = 'https://api.asaas.com/v3';
const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export type StripePriceIds = Readonly<Record<SubscriptionPlan, string | undefined>>;

const EMPTY_STRIPE_PRICES: StripePriceIds = {
  MONTHLY: undefined,
  QUARTERLY: undefined,
  SEMIANNUAL: undefined,
  ANNUAL: undefined,
};

export class StripeGateway implements PaymentGateway {
  readonly name = 'STRIPE' as const;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly webhookSecret: string | undefined,
    private readonly priceIds: StripePriceIds = EMPTY_STRIPE_PRICES,
  ) {}

  hasCredentials(): boolean {
    return Boolean(this.apiKey);
  }

  async createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession> {
    if (!this.apiKey) throw new PaymentGatewayError('STRIPE.createCheckoutSession: sem credencial');
    if (input.method !== 'CARD') {
      throw new PaymentGatewayError(
        'STRIPE.createCheckoutSession: PIX não suporta esta assinatura recorrente',
      );
    }
    const priceId = this.priceIds[input.plan];
    if (!priceId) {
      throw new PaymentGatewayError(
        `STRIPE.createCheckoutSession: Price ausente para ${input.plan}`,
      );
    }

    const body = new URLSearchParams({
      mode: 'subscription',
      success_url: `${input.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: input.cancelUrl,
      client_reference_id: input.userId,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      'payment_method_types[0]': 'card',
      'metadata[userId]': input.userId,
      'metadata[plan]': input.plan,
      'metadata[priceId]': priceId,
      'metadata[termsVersion]': input.termsVersion,
      'subscription_data[metadata][userId]': input.userId,
      'subscription_data[metadata][plan]': input.plan,
      'subscription_data[metadata][priceId]': priceId,
    });
    const session = await this.request(
      '/checkout/sessions',
      { method: 'POST', body },
      input.idempotencyKey,
    );
    const id = stringAt(session, 'id');
    const url = stringAt(session, 'url');
    if (!id || !url)
      throw new PaymentGatewayError('STRIPE.createCheckoutSession: resposta inválida');
    return { externalSessionId: id, checkoutUrl: url };
  }

  parseWebhookEvent(
    rawBody: Buffer,
    signature: string | undefined,
    _timestamp: string | undefined,
  ): GatewayEvent | null {
    if (!this.webhookSecret || !signature) return null;
    const signed = parseStripeSignature(signature);
    if (!signed) return null;
    if (Math.abs(Date.now() / 1000 - signed.timestamp) > STRIPE_SIGNATURE_TOLERANCE_SECONDS) {
      return null;
    }
    const expected = createHmac('sha256', this.webhookSecret)
      .update(`${signed.timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex');
    if (!signed.signatures.some((candidate) => safeHexEqual(candidate, expected))) return null;

    const payload = parseObject(rawBody);
    const eventId = stringAt(payload, 'id');
    const type = stringAt(payload, 'type');
    const created = numberAt(payload, 'created');
    const object = objectAt(objectAt(payload, 'data'), 'object');
    if (!eventId || !type || !object) return null;
    const occurredAt = created ? new Date(created * 1000).toISOString() : undefined;

    if (type === 'checkout.session.completed') {
      const metadata = objectAt(object, 'metadata');
      const userId = stringAt(object, 'client_reference_id') ?? stringAt(metadata, 'userId');
      const externalSubscriptionId = idAt(object, 'subscription');
      const plan = planAt(metadata);
      const externalPriceId = stringAt(metadata, 'priceId');
      if (
        !userId ||
        !externalSubscriptionId ||
        !plan ||
        !externalPriceId ||
        externalPriceId !== this.priceIds[plan]
      ) {
        return null;
      }
      return {
        type: 'CHECKOUT_CONFIRMED',
        eventId,
        userId,
        plan,
        priceCents: numberAt(object, 'amount_total'),
        amountCents: numberAt(object, 'amount_total'),
        externalSubscriptionId,
        externalCustomerId: idAt(object, 'customer'),
        externalCheckoutSessionId: stringAt(object, 'id'),
        externalPriceId,
        termsVersion: stringAt(metadata, 'termsVersion'),
        occurredAt,
      };
    }

    if (type === 'invoice.payment_failed') {
      const parent = objectAt(object, 'parent');
      const details = objectAt(parent, 'subscription_details');
      const metadata = objectAt(details, 'metadata') ?? objectAt(object, 'metadata');
      const userId = stringAt(metadata, 'userId');
      const externalSubscriptionId = idAt(object, 'subscription') ?? idAt(details, 'subscription');
      if (!userId || !externalSubscriptionId) return null;
      return {
        type: 'PAYMENT_FAILED',
        eventId,
        userId,
        externalSubscriptionId,
        externalCustomerId: idAt(object, 'customer'),
        plan: planAt(metadata),
        priceCents: numberAt(object, 'amount_due'),
        occurredAt,
      };
    }

    if (type === 'customer.subscription.deleted') {
      const metadata = objectAt(object, 'metadata');
      const userId = stringAt(metadata, 'userId');
      const externalSubscriptionId = stringAt(object, 'id');
      if (!userId || !externalSubscriptionId) return null;
      return {
        type: 'SUBSCRIPTION_CANCELED',
        eventId,
        userId,
        externalSubscriptionId,
        externalCustomerId: idAt(object, 'customer'),
        plan: planAt(metadata),
        occurredAt,
      };
    }

    return null;
  }

  async cancelSubscription(externalSubscriptionId: string): Promise<void> {
    await this.request(`/subscriptions/${encodeURIComponent(externalSubscriptionId)}`, {
      method: 'DELETE',
    });
  }

  async getSubscription(externalSubscriptionId: string): Promise<GatewaySubscription | null> {
    try {
      const subscription = await this.request(
        `/subscriptions/${encodeURIComponent(externalSubscriptionId)}`,
        { method: 'GET' },
      );
      const id = stringAt(subscription, 'id');
      const status = stringAt(subscription, 'status');
      return id && status ? { externalSubscriptionId: id, status } : null;
    } catch (error) {
      if (error instanceof StripeHttpError && error.status === 404) return null;
      throw error;
    }
  }

  private async request(
    path: string,
    init: { method: 'GET' | 'POST' | 'DELETE'; body?: URLSearchParams },
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    if (!this.apiKey) throw new PaymentGatewayError('STRIPE.request: sem credencial');
    let response: Response;
    try {
      response = await fetch(`${STRIPE_API}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(init.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: init.body?.toString(),
      });
    } catch (cause) {
      throw new PaymentGatewayError('STRIPE.request: provedor indisponível', { cause });
    }
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = stringAt(objectAt(isRecord(payload) ? payload : null, 'error'), 'message');
      throw new StripeHttpError(
        response.status,
        `STRIPE.request: ${message ?? `HTTP ${response.status}`}`,
      );
    }
    return isRecord(payload) ? payload : {};
  }
}

/** Asaas continua fail-closed até o formato real ser habilitado. */
export class AsaasGateway implements PaymentGateway {
  readonly name = 'ASAAS' as const;

  constructor(
    private readonly apiKey: string | undefined,
    _webhookSecret: string | undefined,
  ) {
    void _webhookSecret;
  }

  hasCredentials(): boolean {
    return Boolean(this.apiKey);
  }

  createCheckoutSession(_input: CreateCheckoutInput): Promise<CheckoutSession> {
    throw new PaymentGatewayError(
      `ASAAS.createCheckoutSession: gateway real ainda não implementado (${ASAAS_API})`,
    );
  }

  parseWebhookEvent(
    _rawBody: Buffer,
    _signature: string | undefined,
    _timestamp: string | undefined,
  ): GatewayEvent | null {
    throw new PaymentGatewayError('ASAAS.parseWebhookEvent: gateway real ainda não implementado');
  }

  cancelSubscription(_externalSubscriptionId: string): Promise<void> {
    throw new PaymentGatewayError('ASAAS.cancelSubscription: gateway real ainda não implementado');
  }

  getSubscription(_externalSubscriptionId: string): Promise<GatewaySubscription | null> {
    throw new PaymentGatewayError('ASAAS.getSubscription: gateway real ainda não implementado');
  }
}

class StripeHttpError extends PaymentGatewayError {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function parseStripeSignature(
  header: string,
): { timestamp: number; signatures: readonly string[] } | null {
  const parts = header.split(',').map((part) => part.trim().split('=', 2));
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value ?? '');
  return Number.isFinite(timestamp) && signatures.length > 0 ? { timestamp, signatures } : null;
}

function safeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f\d]{64}$/i.test(left) || !/^[a-f\d]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function parseObject(raw: Buffer): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw.toString('utf8'));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectAt(
  value: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  const candidate = value?.[key];
  return isRecord(candidate) ? candidate : null;
}

function stringAt(value: Record<string, unknown> | null, key: string): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

function numberAt(value: Record<string, unknown> | null, key: string): number | undefined {
  const candidate = value?.[key];
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
}

function idAt(value: Record<string, unknown> | null, key: string): string | undefined {
  const candidate = value?.[key];
  if (typeof candidate === 'string') return candidate;
  return isRecord(candidate) ? stringAt(candidate, 'id') : undefined;
}

function planAt(value: Record<string, unknown> | null): SubscriptionPlan | undefined {
  const plan = stringAt(value, 'plan');
  return plan === 'MONTHLY' || plan === 'QUARTERLY' || plan === 'SEMIANNUAL' || plan === 'ANNUAL'
    ? plan
    : undefined;
}
