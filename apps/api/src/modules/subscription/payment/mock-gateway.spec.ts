import { describe, expect, it, vi } from 'vitest';

import { MockGateway } from './mock-gateway';

const logger = { info: vi.fn(), warn: vi.fn(), setContext: vi.fn() } as never;

describe('MockGateway (US-4.1)', () => {
  it('sempre tem credencial e inicia um pagamento fake', async () => {
    const g = new MockGateway(logger);
    expect(g.hasCredentials()).toBe(true);
    const result = await g.startPayment({
      subscriptionId: 's1',
      userId: '11111111-1111-4111-8111-111111111111',
      plan: 'MONTHLY',
      monthlyCents: 7990,
      totalCents: 7990,
      months: 1,
      method: 'CARD',
      payer: {
        name: 'Pessoa Teste',
        email: 'teste@movivo.test',
        cpfCnpj: '11144477735',
        postalCode: '01310100',
        addressNumber: '100',
        phone: '11999999999',
      },
      card: {
        holderName: 'PESSOA TESTE',
        number: '4111111111111111',
        expiryMonth: '12',
        expiryYear: '2030',
        ccv: '123',
      },
      installments: 1,
      remoteIp: '127.0.0.1',
      termsVersion: 'v1',
    });
    expect(result.status).toBe('PENDING');
    expect(result.externalSubscriptionId).toMatch(/^mock_sub_/);
  });

  it('emite eventos de webhook simulados do ciclo de vida', () => {
    const g = new MockGateway(logger);
    const e = g.emit('CHECKOUT_CONFIRMED', {
      userId: 'u1',
      externalSubscriptionId: 'sub_1',
      plan: 'ANNUAL',
      priceCents: 34900,
    });
    expect(e).toMatchObject({
      type: 'CHECKOUT_CONFIRMED',
      userId: 'u1',
      externalSubscriptionId: 'sub_1',
    });
    expect(e.eventId).toMatch(/^mock_evt_/);
  });

  it('verifica a assinatura HMAC: válida parseia, forjada/ausente → null', () => {
    const g = new MockGateway(logger);
    const body = Buffer.from(JSON.stringify({ type: 'REFUNDED', userId: 'u1' }));
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = g.sign(body, ts);

    expect(g.parseWebhookEvent(body, sig, ts)?.type).toBe('REFUNDED');
    expect(g.parseWebhookEvent(body, 'deadbeef', ts)).toBeNull(); // forjada
    expect(g.parseWebhookEvent(body, undefined, ts)).toBeNull(); // ausente
  });

  it('rejeita timestamp fora da janela de tolerância', () => {
    const g = new MockGateway(logger);
    const body = Buffer.from(JSON.stringify({ type: 'REFUNDED', userId: 'u1' }));
    const staleTs = String(Math.floor(Date.now() / 1000) - 3600); // 1h atrás
    expect(g.parseWebhookEvent(body, g.sign(body, staleTs), staleTs)).toBeNull();
  });

  it('rejeita timestamp não numérico e JSON inválido mesmo quando assinados', () => {
    const g = new MockGateway(logger);
    const invalidJson = Buffer.from('{');
    const ts = String(Math.floor(Date.now() / 1000));

    expect(g.parseWebhookEvent(invalidJson, g.sign(invalidJson, ts), 'agora')).toBeNull();
    expect(g.parseWebhookEvent(invalidJson, g.sign(invalidJson, ts), ts)).toBeNull();
  });
});
