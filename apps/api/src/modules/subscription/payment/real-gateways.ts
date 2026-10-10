/**
 * Adaptador Asaas. Toda chamada externa de pagamento fica confinada neste arquivo.
 * O cartão é preenchido somente no Checkout hospedado pelo Asaas (Sandbox e produção).
 */
import { timingSafeEqual } from 'node:crypto';

import type { SubscriptionPlan } from '../subscription-model';
import {
  type GatewayEvent,
  type GatewaySubscription,
  type ExternalContractRefs,
  type IgnoredWebhookEvent,
  type PaymentGateway,
  PaymentGatewayError,
  type PaymentQrCode,
  type PaymentStartResult,
  type StartPaymentInput,
} from './payment-gateway.types';

type Json = Record<string, unknown>;

export class AsaasGateway implements PaymentGateway {
  readonly name = 'ASAAS' as const;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly webhookToken: string | undefined,
    private readonly apiUrl: string,
    private readonly timeoutMs = 10_000,
  ) {}

  hasCredentials(): boolean {
    return Boolean(this.apiKey && this.webhookToken);
  }

  async startPayment(input: StartPaymentInput): Promise<PaymentStartResult> {
    // Cartão só existe no Checkout hospedado do Asaas: número e CVV nunca passam pela MOVIVO.
    if (input.method === 'CARD') return this.startHostedCard(input);
    const customerId = await this.ensureCustomer(input);
    switch (input.method) {
      case 'PIX':
        return this.startPix(input, customerId);
      case 'PIX_AUTOMATIC':
        return this.startAutomaticPix(input, customerId);
    }
  }

  parseWebhookEvent(
    rawBody: Buffer,
    signature: string | undefined,
    _timestamp: string | undefined,
  ): GatewayEvent | IgnoredWebhookEvent | null {
    if (!this.webhookToken || !signature || !safeTextEqual(signature, this.webhookToken)) {
      return null;
    }
    const payload = parseObject(rawBody);
    if (!payload) return null;
    const eventId = stringAt(payload, 'id');
    const eventName = stringAt(payload, 'event');
    if (!eventId || !eventName) return null;
    // A partir daqui a origem está provada: o que não mapeamos é ignorado com 200, nunca 401.
    const ignored: IgnoredWebhookEvent = { ignored: true, eventName };
    const webhookOccurredAt = asIso(stringAt(payload, 'dateCreated'));

    const payment = objectAt(payload, 'payment');
    if (payment) {
      return this.paymentEvent(eventId, eventName, payment, webhookOccurredAt) ?? ignored;
    }

    const authorization = objectAt(payload, 'authorization');
    if (authorization) {
      return (
        this.authorizationEvent(eventId, eventName, authorization, webhookOccurredAt) ?? ignored
      );
    }

    const instruction = objectAt(payload, 'paymentInstruction');
    if (instruction) {
      return this.instructionEvent(eventId, eventName, instruction, webhookOccurredAt) ?? ignored;
    }

    const subscription = objectAt(payload, 'subscription');
    if (subscription && eventName === 'SUBSCRIPTION_DELETED') {
      const id = stringAt(subscription, 'id');
      if (!id) return ignored;
      const reference = parseReference(stringAt(subscription, 'externalReference'));
      return {
        type: 'SUBSCRIPTION_CANCELED',
        eventId,
        externalSubscriptionId: id,
        externalCustomerId: stringAt(subscription, 'customer'),
        userId: reference?.userId,
        plan: reference?.plan,
        occurredAt: webhookOccurredAt,
      };
    }
    return ignored;
  }

  async cancelContract(refs: ExternalContractRefs): Promise<void> {
    if (refs.checkoutSessionId && !refs.subscriptionId && !refs.installmentId && !refs.paymentId) {
      try {
        await this.request(`/checkouts/${encodeURIComponent(refs.checkoutSessionId)}/cancel`, {
          method: 'POST',
        });
      } catch (error) {
        // Sessão inexistente (404) ou já encerrada (400 "não está ativo": expirada, cancelada ou
        // paga): não há mais nada a cancelar, e travar aqui impediria uma nova compra.
        if (error instanceof AsaasHttpError && error.status === 404) return;
        if (
          error instanceof AsaasHttpError &&
          error.status === 400 &&
          /não está ativo/i.test(error.message)
        ) {
          return;
        }
        throw error;
      }
      return;
    }
    const path = cancelPathFor(refs);
    if (!path) return;
    try {
      await this.request(path, { method: 'DELETE' });
    } catch (error) {
      // Já removido no Asaas (retentativa, cancelamento pelo painel): o objetivo foi atingido.
      if (error instanceof AsaasHttpError && error.status === 404) return;
      throw error;
    }
  }

  async refundContract(refs: ExternalContractRefs, reason: string): Promise<void> {
    // Parcelado é estornado pelo parcelamento; cobrança avulsa (Pix, cartão à vista ou o
    // primeiro mês da assinatura) pela própria cobrança. Nunca um ID no endpoint do outro.
    const path = refs.installmentId
      ? `/installments/${encodeURIComponent(refs.installmentId)}/refund`
      : refs.paymentId
        ? `/payments/${encodeURIComponent(refs.paymentId)}/refund`
        : undefined;
    if (!path) throw new PaymentGatewayError('ASAAS.refund: contrato sem cobrança para estornar');
    await this.request(path, { method: 'POST', body: { description: reason.slice(0, 200) } });
  }

  async getSubscription(externalSubscriptionId: string): Promise<GatewaySubscription | null> {
    try {
      const response = await this.request(
        `/subscriptions/${encodeURIComponent(externalSubscriptionId)}`,
        { method: 'GET' },
      );
      const id = stringAt(response, 'id');
      const status = stringAt(response, 'status');
      return id && status ? { externalSubscriptionId: id, status } : null;
    } catch (error) {
      if (error instanceof AsaasHttpError && error.status === 404) return null;
      throw error;
    }
  }

  private async ensureCustomer(input: StartPaymentInput): Promise<string> {
    const payer = requiredPayer(input);
    const query = new URLSearchParams({ externalReference: input.userId, limit: '1' });
    const listed = await this.request(`/customers?${query}`, { method: 'GET' });
    const existing = arrayAt(listed, 'data').map(asRecord).find(Boolean);
    const existingId = existing ? stringAt(existing, 'id') : undefined;
    const fields = {
      name: payer.name,
      cpfCnpj: payer.cpfCnpj,
      email: payer.email,
      mobilePhone: payer.phone,
      postalCode: payer.postalCode,
      addressNumber: payer.addressNumber,
      addressComplement: payer.addressComplement,
    };
    if (existingId) {
      // Cliente de uma tentativa anterior pode estar sem endereço; o Checkout hospedado exige.
      await this.request(`/customers/${encodeURIComponent(existingId)}`, {
        method: 'PUT',
        body: fields,
      });
      return existingId;
    }

    const created = await this.request('/customers', {
      method: 'POST',
      body: { ...fields, externalReference: input.userId, notificationDisabled: true },
    });
    const id = stringAt(created, 'id');
    if (!id) throw new PaymentGatewayError('ASAAS.customer: resposta inválida');
    return id;
  }

  private async startHostedCard(input: StartPaymentInput): Promise<PaymentStartResult> {
    if (!input.returnUrl) throw new PaymentGatewayError('ASAAS.checkout: URL de retorno ausente');
    // O cliente nasce antes do Checkout: com ele, a página do Asaas já abre com identificação
    // e endereço completos e pede só os dados do cartão.
    const customerId = await this.ensureCustomer(input);
    const count = input.installments ?? input.months;
    const response = await this.request('/checkouts', {
      method: 'POST',
      body: {
        customer: customerId,
        billingTypes: ['CREDIT_CARD'],
        chargeTypes: input.plan === 'MONTHLY' ? ['RECURRENT'] : ['DETACHED', 'INSTALLMENT'],
        minutesToExpire: 60,
        externalReference: externalReference(input),
        // O retorno só navega: quem confirma o pagamento é o webhook autenticado.
        callback: {
          successUrl: callbackUrl(input.returnUrl, 'sucesso'),
          cancelUrl: callbackUrl(input.returnUrl, 'cancelado'),
          expiredUrl: callbackUrl(input.returnUrl, 'expirado'),
        },
        items: [
          {
            name: `MOVIVO — Plano ${planLabel(input.plan)}`,
            quantity: 1,
            value: brl(input.plan === 'MONTHLY' ? input.monthlyCents : input.totalCents),
          },
        ],
        ...(input.plan === 'MONTHLY'
          ? {
              subscription: {
                cycle: 'MONTHLY',
                // A data da primeira cobrança: hoje, para o cartão ser cobrado na hora do checkout.
                // Os meses seguintes o próprio Asaas agenda.
                nextDueDate: isoDate(new Date()),
              },
            }
          : { installment: { maxInstallmentCount: count } }),
      },
    });
    const id = requiredId(response, 'ASAAS.checkout');
    const link = stringAt(response, 'link');
    if (!link) throw new PaymentGatewayError('ASAAS.checkout: link ausente');
    const url = new URL(link);
    const official = url.hostname === 'asaas.com' || url.hostname.endsWith('.asaas.com');
    if (url.protocol !== 'https:' || !official) {
      throw new PaymentGatewayError('ASAAS.checkout: link inválido');
    }
    return {
      status: 'PENDING',
      externalCustomerId: customerId,
      externalCheckoutSessionId: id,
      checkoutUrl: url.toString(),
    };
  }

  private async startPix(
    input: StartPaymentInput,
    customerId: string,
  ): Promise<PaymentStartResult> {
    const reference = externalReference(input);
    const dueDate = isoDate(addDays(new Date(), 1));
    const payment =
      (await this.first('/payments', { externalReference: reference, billingType: 'PIX' })) ??
      (await this.request('/payments', {
        method: 'POST',
        body: {
          customer: customerId,
          billingType: 'PIX',
          value: brl(input.totalCents),
          dueDate,
          description: `MOVIVO — Plano ${planLabel(input.plan)}`,
          externalReference: reference,
        },
      }));
    const paymentId = requiredId(payment, 'ASAAS.payment');
    const qr = await this.request(`/payments/${encodeURIComponent(paymentId)}/pixQrCode`, {
      method: 'GET',
    });
    return {
      status: normalizeStartStatus(stringAt(payment, 'status')),
      externalCustomerId: customerId,
      externalPaymentId: paymentId,
      // O Asaas deixa o QR pagável por até um ano, mas a cobrança vence no `dueDate`: é esse o
      // prazo que o aluno vê (depois dele, "gerar novo QR" cancela esta cobrança).
      qrCode: clampQrExpiration(parseQr(qr), stringAt(payment, 'dueDate') ?? dueDate),
    };
  }

  private async startAutomaticPix(
    input: StartPaymentInput,
    customerId: string,
  ): Promise<PaymentStartResult> {
    const attempt = input.idempotencyKey?.split(':').at(-1) ?? '0';
    const contractId = `${input.subscriptionId.replaceAll('-', '').slice(0, 31)}-${attempt}`.slice(
      0,
      35,
    );
    const listed = await this.request('/pix/automatic/authorizations?limit=100', { method: 'GET' });
    const existing = arrayAt(listed, 'data')
      .map(asRecord)
      .find((item) => item && stringAt(item, 'contractId') === contractId);
    const startDate = new Date();
    const response =
      existing ??
      (await this.request('/pix/automatic/authorizations', {
        method: 'POST',
        body: {
          frequency: 'MONTHLY',
          contractId,
          startDate: isoDate(startDate),
          // O número máximo de débitos autorizados é sempre o período contratado.
          finishDate: isoDate(addMonths(startDate, input.months - 1)),
          value: brl(input.monthlyCents),
          description: `MOVIVO ${planLabel(input.plan)}`.slice(0, 35),
          customerId,
          immediateQrCode: {
            expirationSeconds: 3_600,
            originalValue: brl(input.monthlyCents),
            description: 'Primeira mensalidade MOVIVO',
          },
          paymentCreationMode: 'SUBSCRIPTION',
          retryPolicy: 'NOT_ALLOWED',
        },
      }));
    const id = requiredId(response, 'ASAAS.pixAutomaticAuthorization');
    return {
      status: normalizeAuthorizationStatus(stringAt(response, 'status')),
      externalCustomerId: customerId,
      externalAuthorizationId: id,
      externalSubscriptionId: stringAt(response, 'subscriptionId'),
      qrCode: parseQr(response),
      nextBillingAt: stringAt(response, 'startDate'),
    };
  }

  private paymentEvent(
    eventId: string,
    eventName: string,
    payment: Json,
    webhookOccurredAt: string | undefined,
  ): GatewayEvent | null {
    const type = paymentEventType(eventName);
    if (!type) return null;
    const paymentId = stringAt(payment, 'id');
    const subscriptionId = stringAt(payment, 'subscription');
    const installmentId = stringAt(payment, 'installment');
    if (!paymentId) return null;
    const reference = parseReference(stringAt(payment, 'externalReference'));
    const gross = centsAt(payment, 'value');
    const net = centsAt(payment, 'netValue');
    return {
      type,
      eventId,
      userId: reference?.userId,
      plan: reference?.plan,
      termsVersion: reference?.termsVersion,
      externalSubscriptionId: subscriptionId ?? installmentId ?? paymentId,
      externalPaymentId: paymentId,
      externalInstallmentId: installmentId,
      externalCheckoutSessionId: stringAt(payment, 'checkoutSession'),
      externalCustomerId: stringAt(payment, 'customer'),
      priceCents: gross,
      amountCents: gross,
      feeCents: gross !== undefined && net !== undefined ? Math.max(0, gross - net) : undefined,
      occurredAt:
        asIso(stringAt(payment, 'paymentDate') ?? stringAt(payment, 'confirmedDate')) ??
        webhookOccurredAt,
      dueDate: asIso(stringAt(payment, 'dueDate')),
    };
  }

  private authorizationEvent(
    eventId: string,
    eventName: string,
    authorization: Json,
    webhookOccurredAt: string | undefined,
  ): GatewayEvent | null {
    const id = stringAt(authorization, 'id');
    if (!id) return null;
    const base = {
      eventId,
      externalSubscriptionId: stringAt(authorization, 'subscriptionId') ?? id,
      externalAuthorizationId: id,
      externalCustomerId: stringAt(authorization, 'customerId'),
      occurredAt: webhookOccurredAt,
    };
    switch (eventName) {
      case 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED':
        return { type: 'AUTHORIZATION_ACTIVE', ...base };
      // O pagador revogou no banco: interrompe os débitos futuros.
      case 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED':
        return { type: 'SUBSCRIPTION_CANCELED', ...base };
      // O QR da primeira mensalidade expirou sem pagamento: é falha do primeiro pagamento,
      // não fim de contrato — o aluno precisa poder tentar de novo.
      case 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED':
        return { type: 'PAYMENT_FAILED', ...base };
      // `EXPIRED` é o fim natural em `finishDate`, depois do último débito: quem encerra o
      // acesso é a varredura de fim do período pago, não o evento.
      default:
        return null;
    }
  }

  /** Débito mensal do Pix Automático recusado pelo banco do pagador → inadimplência. */
  private instructionEvent(
    eventId: string,
    eventName: string,
    instruction: Json,
    webhookOccurredAt: string | undefined,
  ): GatewayEvent | null {
    if (eventName !== 'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_REFUSED') return null;
    const authorizationId = stringAt(objectAt(instruction, 'authorization'), 'id');
    if (!authorizationId) return null;
    return {
      type: 'PAYMENT_FAILED',
      eventId,
      externalSubscriptionId: authorizationId,
      externalAuthorizationId: authorizationId,
      externalPaymentId: stringAt(instruction, 'paymentId'),
      occurredAt: webhookOccurredAt,
    };
  }

  private async first(path: string, query: Record<string, string>): Promise<Json | null> {
    const params = new URLSearchParams({ ...query, limit: '1' });
    const listed = await this.request(`${path}?${params}`, { method: 'GET' });
    return arrayAt(listed, 'data').map(asRecord).find(Boolean) ?? null;
  }

  private async request(
    path: string,
    init: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: Json },
  ): Promise<Json> {
    if (!this.apiKey) throw new PaymentGatewayError('ASAAS.request: sem credencial');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.apiUrl}${path}`, {
        method: init.method,
        headers: {
          access_token: this.apiKey,
          'User-Agent': 'MOVIVO/0.1 payment-integration',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
    } catch (cause) {
      throw new PaymentGatewayError('ASAAS.request: indisponível ou timeout', { cause });
    } finally {
      clearTimeout(timeout);
    }
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const firstError = arrayAt(asRecord(payload), 'errors').map(asRecord).find(Boolean);
      const description = firstError ? stringAt(firstError, 'description') : undefined;
      throw new AsaasHttpError(
        response.status,
        `ASAAS.request: ${description ?? `HTTP ${response.status}`}`,
      );
    }
    return asRecord(payload) ?? {};
  }
}

class AsaasHttpError extends PaymentGatewayError {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function requiredPayer(input: StartPaymentInput) {
  if (!input.payer) throw new PaymentGatewayError('ASAAS.payer: dados ausentes');
  return input.payer;
}

/**
 * URL de retorno do Checkout. O Asaas recusa `localhost` ("successUrl inválido") mas aceita
 * `127.0.0.1`, então o desenvolvimento local volta pelo IP de loopback; produção não muda.
 */
function callbackUrl(returnUrl: string, outcome: 'sucesso' | 'cancelado' | 'expirado'): string {
  const url = new URL(returnUrl);
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  url.searchParams.set('retorno', outcome);
  return url.toString();
}

function requiredId(value: Json, source: string): string {
  const id = stringAt(value, 'id');
  if (!id) throw new PaymentGatewayError(`${source}: resposta inválida`);
  return id;
}

function externalReference(input: StartPaymentInput): string {
  const attempt = input.idempotencyKey?.split(':').at(-1) ?? '0';
  return `movivo:${input.userId}:${input.plan}:${input.termsVersion}:${attempt}`;
}

function parseReference(
  value: string | undefined,
): { userId: string; plan: SubscriptionPlan; termsVersion?: string } | undefined {
  if (!value) return undefined;
  const [prefix, userId, rawPlan, termsVersion] = value.split(':');
  if (prefix !== 'movivo' || !userId || !isPlan(rawPlan)) return undefined;
  return { userId, plan: rawPlan, termsVersion };
}

function paymentEventType(event: string): GatewayEvent['type'] | undefined {
  if (['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED_IN_CASH'].includes(event)) {
    return 'CHECKOUT_CONFIRMED';
  }
  if (
    [
      'PAYMENT_OVERDUE',
      'PAYMENT_CHARGEBACK_REQUESTED',
      'PAYMENT_REPROVED_BY_RISK_ANALYSIS',
    ].includes(event)
  ) {
    return 'PAYMENT_FAILED';
  }
  if (['PAYMENT_REFUNDED', 'PAYMENT_REFUND_IN_PROGRESS'].includes(event)) return 'REFUNDED';
  // `PAYMENT_DELETED` fica de fora de propósito: remover uma cobrança pendente (Pix
  // regenerado, troca de método) não encerra o contrato. O fim do contrato chega por
  // `SUBSCRIPTION_DELETED` ou pela autorização do Pix Automático.
  return undefined;
}

/** A referência exata de cada contrato; nunca um ID de cobrança no lugar de assinatura. */
function cancelPathFor(refs: ExternalContractRefs): string | undefined {
  if (refs.authorizationId) {
    return `/pix/automatic/authorizations/${encodeURIComponent(refs.authorizationId)}`;
  }
  if (refs.subscriptionId) return `/subscriptions/${encodeURIComponent(refs.subscriptionId)}`;
  if (refs.installmentId) {
    return `/installments/${encodeURIComponent(refs.installmentId)}/payments`;
  }
  if (refs.paymentId) return `/payments/${encodeURIComponent(refs.paymentId)}`;
  return undefined;
}

function normalizeStartStatus(status: string | undefined): PaymentStartResult['status'] {
  if (status === 'RECEIVED' || status === 'CONFIRMED' || status === 'RECEIVED_IN_CASH') {
    return 'CONFIRMED';
  }
  if (status === 'OVERDUE' || status === 'REFUNDED' || status === 'DELETED') return 'REFUSED';
  return 'PENDING';
}

function normalizeAuthorizationStatus(status: string | undefined): PaymentStartResult['status'] {
  if (status === 'ACTIVE') return 'CONFIRMED';
  if (status === 'EXPIRED') return 'EXPIRED';
  if (status === 'REFUSED' || status === 'CANCELLED') return 'REFUSED';
  return 'PENDING';
}

function parseQr(value: Json): PaymentQrCode {
  const encodedImage = stringAt(value, 'encodedImage');
  const payload = stringAt(value, 'payload');
  const immediate = objectAt(value, 'immediateQrCode');
  const expirationDate = stringAt(value, 'expirationDate') ?? stringAt(immediate, 'expirationDate');
  if (!encodedImage || !payload || !expirationDate) {
    throw new PaymentGatewayError('ASAAS.pixQrCode: resposta inválida');
  }
  // ISO 8601 em UTC: "2027-10-11 23:59:59" (hora de Brasília, sem fuso) não é lido igual por todo navegador.
  return { encodedImage, payload, expirationDate: asIso(expirationDate) ?? expirationDate };
}

/** O QR nunca "vale" além do fim do dia de vencimento (23:59:59 de Brasília). */
function clampQrExpiration(qr: PaymentQrCode, dueDate: string): PaymentQrCode {
  const dueEnd = asIso(`${dueDate.slice(0, 10)} 23:59:59`);
  if (!dueEnd) return qr;
  return new Date(qr.expirationDate).getTime() > new Date(dueEnd).getTime()
    ? { ...qr, expirationDate: dueEnd }
    : qr;
}

function safeTextEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseObject(raw: Buffer): Json | null {
  try {
    return asRecord(JSON.parse(raw.toString('utf8')));
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function objectAt(value: Json | null, key: string): Json | null {
  return asRecord(value?.[key]);
}

function arrayAt(value: Json | null, key: string): unknown[] {
  const candidate = value?.[key];
  return Array.isArray(candidate) ? candidate : [];
}

function stringAt(value: Json | null, key: string): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

function centsAt(value: Json | null, key: string): number | undefined {
  const candidate = value?.[key];
  return typeof candidate === 'number' && Number.isFinite(candidate)
    ? Math.round(candidate * 100)
    : undefined;
}

function brl(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

/**
 * O Asaas fala em hora civil de Brasília, sem fuso no texto (`"2026-07-10 14:32:18"`,
 * `"2026-07-10"`). Brasília é UTC−3 fixo desde o fim do horário de verão (2019). Ler essas
 * datas no fuso do servidor (UTC em container) as deslocaria 3h.
 */
const ASAAS_UTC_OFFSET = '-03:00';
const ASAAS_OFFSET_MS = -3 * 60 * 60 * 1000;

/** Data civil de Brasília (`YYYY-MM-DD`) — depois das 21h UTC−3 ainda é "hoje" para o Asaas. */
function isoDate(value: Date): string {
  return new Date(value.getTime() + ASAAS_OFFSET_MS).toISOString().slice(0, 10);
}

function asIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const local = value.includes('T') ? value : value.replace(' ', 'T');
  const withTime = /^\d{4}-\d{2}-\d{2}$/.test(local) ? `${local}T00:00:00` : local;
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(withTime)
    ? withTime
    : `${withTime}${ASAAS_UTC_OFFSET}`;
  const parsed = new Date(zoned);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonths(value: Date, months: number): Date {
  const next = new Date(value);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function isPlan(value: string | undefined): value is SubscriptionPlan {
  return (
    value === 'MONTHLY' || value === 'QUARTERLY' || value === 'SEMIANNUAL' || value === 'ANNUAL'
  );
}

function planLabel(plan: SubscriptionPlan): string {
  return { MONTHLY: 'Mensal', QUARTERLY: 'Trimestral', SEMIANNUAL: 'Semestral', ANNUAL: 'Anual' }[
    plan
  ];
}
