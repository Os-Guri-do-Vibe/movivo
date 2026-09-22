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
      idempotencyKey: 'trial_sub-1_day7',
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
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('trial_sub-1_day7');
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
});

describe('AsaasGateway', () => {
  it('continua fail-closed enquanto o adaptador real não estiver habilitado', () => {
    const gateway = new AsaasGateway('aact_test', 'secret');
    expect(gateway.hasCredentials()).toBe(true);
    expect(() => gateway.cancelSubscription('sub_1')).toThrow(PaymentGatewayError);
    expect(() => gateway.createCheckoutSession({} as never)).toThrow(/api\.asaas\.com/);
  });
});
