/**
 * Testes do cliente do endpoint interno de resolução do link curto. `fetch` é mockado —
 * o contrato do `ShortLinkController` é exercitado no lado da API.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveShortLink } from './short-link-api';

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

describe('resolveShortLink', () => {
  it('devolve a URL alvo quando o código resolve', async () => {
    const fetchMock = mockFetch(200, { url: 'https://movivo.app/treino/acessar#token=secret' });
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveShortLink('aB3xK9pQ')).resolves.toBe(
      'https://movivo.app/treino/acessar#token=secret',
    );
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/short-links/aB3xK9pQ');
  });

  it('devolve null quando a API responde 410 (código inexistente ou expirado)', async () => {
    vi.stubGlobal('fetch', mockFetch(410, { message: 'Link inválido ou expirado.' }));
    await expect(resolveShortLink('inexistente')).resolves.toBeNull();
  });

  it('devolve null se a resposta não trouxer `url`', async () => {
    vi.stubGlobal('fetch', mockFetch(200, {}));
    await expect(resolveShortLink('aB3xK9pQ')).resolves.toBeNull();
  });
});
