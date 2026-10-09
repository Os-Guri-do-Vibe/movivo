import { afterEach, describe, expect, it, vi } from 'vitest';

const backendFetch = vi.hoisted(() => vi.fn());
vi.mock('../../../_lib/bff', () => ({
  authenticatedBackendFetch: backendFetch,
  BffError: class BffError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

import { BffError } from '../../../_lib/bff';
import { GET } from './route';

function params(filename: string) {
  return { params: Promise.resolve({ filename }) };
}

afterEach(() => {
  vi.restoreAllMocks();
  backendFetch.mockReset();
});

describe('GET /api/dashboard/account/avatar/[filename]', () => {
  it('devolve 404 sem chamar a API para nome de arquivo fora do formato UUID', async () => {
    const response = await GET(new Request('http://app.test'), params('../../etc/passwd'));
    expect(response.status).toBe(404);
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it('encaminha a imagem com content-type e cache-control do upstream', async () => {
    backendFetch.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000' },
      }),
    );

    const filename = '11111111-1111-4111-8111-111111111111.png';
    const response = await GET(new Request('http://app.test'), params(filename));

    expect(backendFetch).toHaveBeenCalledWith(
      `/account/avatar/${filename}`,
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('devolve 404 quando o upstream não encontra o arquivo', async () => {
    backendFetch.mockResolvedValue(new Response(null, { status: 404 }));
    const filename = '11111111-1111-4111-8111-111111111111.jpg';
    const response = await GET(new Request('http://app.test'), params(filename));
    expect(response.status).toBe(404);
  });

  it('nega a leitura quando a sessão do dashboard está ausente', async () => {
    backendFetch.mockRejectedValue(new BffError(401, 'sem sessão'));
    const filename = '11111111-1111-4111-8111-111111111111.jpg';
    const response = await GET(new Request('http://app.test'), params(filename));
    expect(response.status).toBe(401);
  });

  it('devolve 502 quando o upstream falha de outro jeito', async () => {
    backendFetch.mockResolvedValue(new Response(null, { status: 500 }));
    const filename = '11111111-1111-4111-8111-111111111111.jpg';
    const response = await GET(new Request('http://app.test'), params(filename));
    expect(response.status).toBe(502);
  });
});
