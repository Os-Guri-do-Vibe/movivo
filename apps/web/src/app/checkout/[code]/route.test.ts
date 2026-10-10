import { afterEach, describe, expect, it, vi } from 'vitest';

const resolveShortLink = vi.hoisted(() => vi.fn());
vi.mock('@/lib/short-link-api', () => ({ resolveShortLink }));

import { GET } from './route';

const context = (code: string) => ({ params: Promise.resolve({ code }) });

afterEach(() => resolveShortLink.mockReset());

describe('GET /checkout/[code]', () => {
  it('redireciona 302 para o destino do link curto', async () => {
    resolveShortLink.mockResolvedValue('https://movivo.test/destino');
    const response = await GET(
      new Request('https://movivo.test/checkout/XcTJFfnN'),
      context('XcTJFfnN'),
    );
    expect(resolveShortLink).toHaveBeenCalledWith('XcTJFfnN');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://movivo.test/destino');
  });

  it('código vencido ou inexistente vai para a página amigável de novo link (sem enviar nada)', async () => {
    resolveShortLink.mockResolvedValue(null);
    const response = await GET(
      new Request('https://movivo.test/checkout/zzzzzzzz'),
      context('zzzzzzzz'),
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.pathname).toBe('/link-expirado');
    expect(location.searchParams.get('c')).toBe('zzzzzzzz');
  });
});
