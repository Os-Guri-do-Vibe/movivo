import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatBRL,
  getCheckoutSummary,
  manageSubscription,
  startCheckoutPayment,
} from './subscription-api';

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

afterEach(() => vi.restoreAllMocks());

describe('checkout API', () => {
  it('formata centavos inteiros em BRL', () => {
    expect(formatBRL(7990)).toContain('79,90');
    expect(formatBRL(81480)).toContain('814,80');
  });

  it('busca o resumo pelo token opaco com cache desabilitado', async () => {
    const fetchMock = mockFetch(200, { plan: 'MONTHLY' });
    vi.stubGlobal('fetch', fetchMock);
    await getCheckoutSummary('token/seguro');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/subscription/checkout/token%2Fseguro');
    expect(init.cache).toBe('no-store');
  });

  it('inicia o pagamento sem enviar plano nem preço', async () => {
    const fetchMock = mockFetch(200, { status: 'PENDING', method: 'PIX' });
    vi.stubGlobal('fetch', fetchMock);
    await startCheckoutPayment('opaque', {
      method: 'PIX',
      payer: {
        name: 'Pessoa Teste',
        email: 'teste@movivo.test',
        cpfCnpj: '11144477735',
        postalCode: '01310100',
        addressNumber: '100',
        phone: '11999999999',
      },
      acceptTerms: true,
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(body).not.toHaveProperty('plan');
    expect(body).not.toHaveProperty('totalCents');
  });

  it('propaga status de erro sem expor o corpo da resposta', async () => {
    vi.stubGlobal('fetch', mockFetch(500, { card: 'não pode vazar no erro' }));
    await expect(getCheckoutSummary('opaque')).rejects.toThrow('request_failed_500');
  });
});

describe('manageSubscription', () => {
  it('POST na ação self-service', async () => {
    const fetchMock = mockFetch(200, { status: 'CANCELED' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(manageSubscription('u1', 'cancel')).resolves.toEqual({ status: 'CANCELED' });
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/subscription/u1/cancel');
  });
});
