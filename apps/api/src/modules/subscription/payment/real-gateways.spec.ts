import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PaymentGatewayError } from './payment-gateway.types';
import { AsaasGateway, StripeGateway, type StripePriceIds } from './real-gateways';

const PRICES: StripePriceIds = {
  MONTHLY: 'price_monthly',
  QUARTERLY: 'price_quarterly',
  SEMIANNUAL: 'price_semiannual',
  ANNUAL: 'price_annual',
};

const CHECKOUT_INPUT = {
  userId: 'user-1',
  plan: 'MONTHLY' as const,
  priceCents: 7990,
  method: 'CARD' as const,
  termsVersion: 'terms-v1',
  successUrl: 'https://movivo.test/ok',
  cancelUrl: 'https://movivo.test/cancel',
};

function signedWebhook(
  payload: unknown,
  timestamp = Math.floor(Date.now() / 1000),
): { raw: Buffer; signature: string } {
  const raw = Buffer.from(JSON.stringify(payload));
  const digest = createHmac('sha256', 'whsec_test')
    .update(`${timestamp}.${raw.toString('utf8')}`)
    .digest('hex');
  return { raw, signature: `t=${timestamp},v1=${digest}` };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StripeGateway', () => {
  it('cria Checkout Session recorrente com Price e metadata do plano escolhido', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.test/cs_1' }),
          {
            status: 200,
          },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new StripeGateway('sk_test', 'whsec_test', PRICES);

    const session = await gateway.createCheckoutSession({
      userId: '11111111-1111-4111-8111-111111111111',
      plan: 'ANNUAL',
      priceCents: 71880,
      method: 'CARD',
      termsVersion: 'terms-v1',
      successUrl: 'https://movivo.test/checkout/sucesso',
      cancelUrl: 'https://movivo.test/checkout/cancelado',
      idempotencyKey: 'test',
    });

    expect(session).toEqual({
      externalSessionId: 'cs_test_1',
      checkoutUrl: 'https://checkout.stripe.test/cs_1',
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('mode')).toBe('subscription');
    expect(body.get('line_items[0][price]')).toBe('price_annual');
    expect(body.get('metadata[plan]')).toBe('ANNUAL');
    expect(body.get('subscription_data[metadata][userId]')).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('test');
  });

  it('rejeita PIX para assinatura recorrente e configuração sem Price', async () => {
    const gateway = new StripeGateway('sk_test', 'whsec_test', PRICES);
    const base = {
      userId: 'u1',
      plan: 'MONTHLY' as const,
      priceCents: 7990,
      termsVersion: 'terms-v1',
      successUrl: 'https://movivo.test/ok',
      cancelUrl: 'https://movivo.test/cancel',
    };
    await expect(gateway.createCheckoutSession({ ...base, method: 'PIX' })).rejects.toThrow(
      /PIX não suporta/,
    );
    await expect(
      new StripeGateway('sk_test', 'whsec_test').createCheckoutSession({
        ...base,
        method: 'CARD',
      }),
    ).rejects.toThrow(/Price ausente/);
  });

  it('verifica stripe-signature e normaliza checkout.session.completed', () => {
    const gateway = new StripeGateway('sk_test', 'whsec_test', PRICES);
    const timestamp = Math.floor(Date.now() / 1000);
    const raw = Buffer.from(
      JSON.stringify({
        id: 'evt_1',
        type: 'checkout.session.completed',
        created: timestamp,
        data: {
          object: {
            id: 'cs_1',
            client_reference_id: 'user-1',
            subscription: 'sub_1',
            customer: 'cus_1',
            amount_total: 71880,
            metadata: { plan: 'ANNUAL', priceId: 'price_annual', termsVersion: 'terms-v1' },
          },
        },
      }),
    );
    const digest = createHmac('sha256', 'whsec_test')
      .update(`${timestamp}.${raw.toString('utf8')}`)
      .digest('hex');

    expect(gateway.parseWebhookEvent(raw, `t=${timestamp},v1=${digest}`, undefined)).toEqual(
      expect.objectContaining({
        type: 'CHECKOUT_CONFIRMED',
        eventId: 'evt_1',
        userId: 'user-1',
        plan: 'ANNUAL',
        externalSubscriptionId: 'sub_1',
        externalCustomerId: 'cus_1',
        externalCheckoutSessionId: 'cs_1',
        externalPriceId: 'price_annual',
        termsVersion: 'terms-v1',
      }),
    );
    expect(
      gateway.parseWebhookEvent(raw, `t=${timestamp},v1=${'0'.repeat(64)}`, undefined),
    ).toBeNull();
  });

  it('não aceita metadata com Price divergente do plano configurado', () => {
    const gateway = new StripeGateway('sk_test', 'whsec_test', PRICES);
    const timestamp = Math.floor(Date.now() / 1000);
    const raw = Buffer.from(
      JSON.stringify({
        id: 'evt_2',
        type: 'checkout.session.completed',
        data: {
          object: {
            client_reference_id: 'user-1',
            subscription: 'sub_1',
            metadata: { plan: 'ANNUAL', priceId: 'price_monthly' },
          },
        },
      }),
    );
    const digest = createHmac('sha256', 'whsec_test')
      .update(`${timestamp}.${raw.toString('utf8')}`)
      .digest('hex');
    expect(gateway.parseWebhookEvent(raw, `t=${timestamp},v1=${digest}`, undefined)).toBeNull();
  });

  it('hasCredentials reflete a chave provisionada', () => {
    expect(new StripeGateway('sk_test', 'whsec_test', PRICES).hasCredentials()).toBe(true);
    expect(new StripeGateway(undefined, 'whsec_test', PRICES).hasCredentials()).toBe(false);
  });

  it('falha de forma fechada sem chave, com resposta inválida ou indisponibilidade', async () => {
    await expect(
      new StripeGateway(undefined, 'whsec_test', PRICES).createCheckoutSession(CHECKOUT_INPUT),
    ).rejects.toThrow(/sem credencial/);

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ id: 'cs_1' }), { status: 200 }))),
    );
    await expect(
      new StripeGateway('sk_test', 'whsec_test', PRICES).createCheckoutSession(CHECKOUT_INPUT),
    ).rejects.toThrow(/resposta inválida/);

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    await expect(
      new StripeGateway('sk_test', 'whsec_test', PRICES).createCheckoutSession(CHECKOUT_INPUT),
    ).rejects.toThrow(/provedor indisponível/);
  });

  it('propaga erros HTTP do Stripe com mensagem ou status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'cartão recusado' } }), { status: 402 }),
      )
      .mockResolvedValueOnce(new Response('não-json', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new StripeGateway('sk_test', 'whsec_test', PRICES);

    await expect(gateway.createCheckoutSession(CHECKOUT_INPUT)).rejects.toThrow(/cartão recusado/);
    await expect(gateway.createCheckoutSession(CHECKOUT_INPUT)).rejects.toThrow(/HTTP 500/);
  });

  it('cancela, consulta e trata assinatura ausente no Stripe', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'sub_1', status: 'active' }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'sub_1' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'não encontrada' } }), { status: 404 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'falha temporária' } }), { status: 503 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new StripeGateway('sk_test', 'whsec_test', PRICES);

    await expect(gateway.cancelSubscription('sub/1')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.stripe.com/v1/subscriptions/sub%2F1');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('DELETE');
    await expect(gateway.getSubscription('sub_1')).resolves.toEqual({
      externalSubscriptionId: 'sub_1',
      status: 'active',
    });
    await expect(gateway.getSubscription('sub_1')).resolves.toBeNull();
    await expect(gateway.getSubscription('sub_missing')).resolves.toBeNull();
    await expect(gateway.getSubscription('sub_error')).rejects.toThrow(/falha temporária/);
  });

  it('rejeita assinaturas de webhook ausentes, inválidas ou expiradas', () => {
    const now = Math.floor(Date.now() / 1000);
    const gateway = new StripeGateway('sk_test', 'whsec_test', PRICES);
    const noSecret = new StripeGateway('sk_test', undefined, PRICES);
    const raw = Buffer.from('{}');

    expect(noSecret.parseWebhookEvent(raw, `t=${now},v1=${'0'.repeat(64)}`, undefined)).toBeNull();
    expect(gateway.parseWebhookEvent(raw, undefined, undefined)).toBeNull();
    expect(gateway.parseWebhookEvent(raw, 'v1=abc', undefined)).toBeNull();
    expect(gateway.parseWebhookEvent(raw, `t=${now}`, undefined)).toBeNull();
    expect(gateway.parseWebhookEvent(raw, `t=${now},v1=abc`, undefined)).toBeNull();

    const stale = signedWebhook({}, now - 301);
    expect(gateway.parseWebhookEvent(stale.raw, stale.signature, undefined)).toBeNull();
  });

  it('rejeita payload de webhook malformado, incompleto ou desconhecido', () => {
    const gateway = new StripeGateway('sk_test', 'whsec_test', PRICES);
    const timestamp = Math.floor(Date.now() / 1000);
    const malformed = Buffer.from('{');
    const malformedDigest = createHmac('sha256', 'whsec_test')
      .update(`${timestamp}.{`)
      .digest('hex');
    expect(
      gateway.parseWebhookEvent(malformed, `t=${timestamp},v1=${malformedDigest}`, undefined),
    ).toBeNull();

    for (const payload of [[], {}, { id: 'evt_1', type: 'irrelevant', data: { object: {} } }]) {
      const signed = signedWebhook(payload);
      expect(gateway.parseWebhookEvent(signed.raw, signed.signature, undefined)).toBeNull();
    }
  });

  it('aceita checkout com IDs expandidos e userId vindo da metadata', () => {
    const gateway = new StripeGateway('sk_test', 'whsec_test', PRICES);
    const signed = signedWebhook({
      id: 'evt_checkout',
      type: 'checkout.session.completed',
      created: 0,
      data: {
        object: {
          id: 'cs_2',
          subscription: { id: 'sub_2' },
          customer: { id: 'cus_2' },
          metadata: { userId: 'user-2', plan: 'MONTHLY', priceId: 'price_monthly' },
        },
      },
    });

    expect(gateway.parseWebhookEvent(signed.raw, signed.signature, undefined)).toEqual(
      expect.objectContaining({
        type: 'CHECKOUT_CONFIRMED',
        userId: 'user-2',
        externalSubscriptionId: 'sub_2',
        externalCustomerId: 'cus_2',
        occurredAt: undefined,
      }),
    );
  });

  it('normaliza falha de cobrança com metadata nova e legada', () => {
    const gateway = new StripeGateway('sk_test', 'whsec_test', PRICES);
    const modern = signedWebhook({
      id: 'evt_failed_modern',
      type: 'invoice.payment_failed',
      data: {
        object: {
          amount_due: 7990,
          customer: { id: 'cus_1' },
          parent: {
            subscription_details: {
              subscription: { id: 'sub_1' },
              metadata: { userId: 'user-1', plan: 'MONTHLY' },
            },
          },
        },
      },
    });
    expect(gateway.parseWebhookEvent(modern.raw, modern.signature, undefined)).toEqual(
      expect.objectContaining({
        type: 'PAYMENT_FAILED',
        userId: 'user-1',
        externalSubscriptionId: 'sub_1',
        externalCustomerId: 'cus_1',
        priceCents: 7990,
      }),
    );

    const legacy = signedWebhook({
      id: 'evt_failed_legacy',
      type: 'invoice.payment_failed',
      data: {
        object: {
          subscription: 'sub_2',
          metadata: { userId: 'user-2', plan: 'QUARTERLY' },
        },
      },
    });
    expect(gateway.parseWebhookEvent(legacy.raw, legacy.signature, undefined)).toEqual(
      expect.objectContaining({ userId: 'user-2', externalSubscriptionId: 'sub_2' }),
    );

    const invalid = signedWebhook({
      id: 'evt_failed_invalid',
      type: 'invoice.payment_failed',
      data: { object: { metadata: { userId: 'user-3' } } },
    });
    expect(gateway.parseWebhookEvent(invalid.raw, invalid.signature, undefined)).toBeNull();
  });

  it('normaliza cancelamento de assinatura e rejeita evento sem vínculo', () => {
    const gateway = new StripeGateway('sk_test', 'whsec_test', PRICES);
    const valid = signedWebhook({
      id: 'evt_cancel',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_1',
          customer: { id: 'cus_1' },
          metadata: { userId: 'user-1', plan: 'ANNUAL' },
        },
      },
    });
    expect(gateway.parseWebhookEvent(valid.raw, valid.signature, undefined)).toEqual(
      expect.objectContaining({
        type: 'SUBSCRIPTION_CANCELED',
        externalSubscriptionId: 'sub_1',
        externalCustomerId: 'cus_1',
      }),
    );

    const invalid = signedWebhook({
      id: 'evt_cancel_invalid',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_2', metadata: {} } },
    });
    expect(gateway.parseWebhookEvent(invalid.raw, invalid.signature, undefined)).toBeNull();
  });
});

describe('AsaasGateway', () => {
  it('continua fail-closed enquanto o adaptador real não estiver habilitado', () => {
    const gateway = new AsaasGateway('aact_test', 'secret');
    expect(gateway.hasCredentials()).toBe(true);
    expect(() => gateway.cancelSubscription('sub_1')).toThrow(PaymentGatewayError);
    expect(() => gateway.createCheckoutSession({} as never)).toThrow(/api\.asaas\.com/);
    expect(() => gateway.parseWebhookEvent(Buffer.from('{}'), undefined, undefined)).toThrow(
      PaymentGatewayError,
    );
    expect(() => gateway.getSubscription('sub_1')).toThrow(PaymentGatewayError);
    expect(new AsaasGateway(undefined, undefined).hasCredentials()).toBe(false);
  });
});
