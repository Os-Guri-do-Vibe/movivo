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

  it('parseia um webhook JSON normalizado (dev, sem assinatura)', () => {
    const g = new MockGateway(logger);
    const body = Buffer.from(JSON.stringify({ type: 'REFUNDED', userId: 'u1' }));
    expect(g.parseWebhookEvent(body)?.type).toBe('REFUNDED');
    expect(g.parseWebhookEvent(Buffer.from('not json'))).toBeNull();
  });
});
