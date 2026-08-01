/**
 * Testes do cliente HTTP de assinatura (US-4.6): formatação BRL e as chamadas de
 * checkout/gestão. `fetch` é mockado — o contrato do backend é exercitado no E2E.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatBRL, manageSubscription, startCheckout } from './subscription-api';

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('formatBRL', () => {
  it('converte centavos inteiros em BRL', () => {
    expect(formatBRL(3900)).toContain('39,00');
    expect(formatBRL(34900)).toContain('349,00');
  });
});

describe('startCheckout', () => {
  it('POST no endpoint de checkout e devolve a checkoutUrl', async () => {
    const fetchMock = mockFetch(201, { checkoutUrl: 'https://gateway.test/c/abc' });
    vi.stubGlobal('fetch', fetchMock);
    const res = await startCheckout('11111111-1111-4111-8111-111111111111', 'MONTHLY', 'PIX');
    expect(res.checkoutUrl).toBe('https://gateway.test/c/abc');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/subscription/11111111-1111-4111-8111-111111111111/checkout');
    expect(JSON.parse(init.body as string)).toEqual({ plan: 'MONTHLY', method: 'PIX' });
  });

  it('lança em status de erro', async () => {
    vi.stubGlobal('fetch', mockFetch(500, {}));
    await expect(startCheckout('u', 'ANNUAL', 'CARD')).rejects.toThrow('request_failed_500');
  });
});

describe('manageSubscription', () => {
  it('POST na ação self-service (cancel/pause/resume)', async () => {
    const fetchMock = mockFetch(200, { status: 'CANCELED' });
    vi.stubGlobal('fetch', fetchMock);
    const res = await manageSubscription('u1', 'cancel');
    expect(res.status).toBe('CANCELED');
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/subscription/u1/cancel');
  });
});
