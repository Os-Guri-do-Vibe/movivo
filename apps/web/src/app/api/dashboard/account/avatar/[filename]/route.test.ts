import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../_lib/bff', () => ({ API_BASE: 'http://api.test' }));

import { GET } from './route';

function params(filename: string) {
  return { params: Promise.resolve({ filename }) };
}

afterEach(() => vi.restoreAllMocks());

describe('GET /api/dashboard/account/avatar/[filename]', () => {
  it('devolve 404 sem chamar a API para nome de arquivo fora do formato UUID', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const response = await GET(new Request('http://app.test'), params('../../etc/passwd'));
    expect(response.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('encaminha a imagem com content-type e cache-control do upstream', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000' },
      }),
    );

    const filename = '11111111-1111-4111-8111-111111111111.png';
    const response = await GET(new Request('http://app.test'), params(filename));

    expect(global.fetch).toHaveBeenCalledWith(
      `http://api.test/account/avatar/${filename}`,
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000');
  });

  it('devolve 404 quando o upstream não encontra o arquivo', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
    const filename = '11111111-1111-4111-8111-111111111111.jpg';
    const response = await GET(new Request('http://app.test'), params(filename));
    expect(response.status).toBe(404);
  });

  it('devolve 502 quando o upstream falha de outro jeito', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 500 }));
    const filename = '11111111-1111-4111-8111-111111111111.jpg';
    const response = await GET(new Request('http://app.test'), params(filename));
    expect(response.status).toBe(502);
  });
});
