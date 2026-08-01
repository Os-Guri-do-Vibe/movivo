import { describe, expect, it, vi } from 'vitest';

import { MockGateway } from './mock-gateway';

const logger = { info: vi.fn(), warn: vi.fn(), setContext: vi.fn() } as never;

describe('MockGateway (US-4.1)', () => {
  it('sempre tem credencial e cria uma sessão de checkout fake', async () => {
    const g = new MockGateway(logger);
    expect(g.hasCredentials()).toBe(true);
    const cs = await g.createCheckoutSession({
      userId: 'u1',
      plan: 'MONTHLY',
      priceCents: 3900,
      method: 'CARD',
      termsVersion: 'v1',
      successUrl: 'https://x/ok',
      cancelUrl: 'https://x/no',
    });
    expect(cs.checkoutUrl).toContain(cs.externalSessionId);
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
});
