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

import { GET } from './route';

const ID = '11111111-1111-4111-8111-111111111111';
const params = (studentId: string) => ({ params: Promise.resolve({ studentId }) });
const photoUrl = (url: string | null) =>
  new Response(JSON.stringify({ data: { url } }), { status: 200 });

afterEach(() => {
  vi.restoreAllMocks();
  backendFetch.mockReset();
});

describe('GET /api/dashboard/conversations/[studentId]/photo', () => {
  it('404 sem chamar a API para id que não é UUID', async () => {
    const res = await GET(new Request('http://app.test'), params('../x'));
    expect(res.status).toBe(404);
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it('baixa a foto do CDN do WhatsApp e repassa os bytes same-origin', async () => {
    backendFetch.mockResolvedValue(photoUrl('https://pps.whatsapp.net/a.jpg'));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }),
    );
    const res = await GET(new Request('http://app.test'), params(ID));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(backendFetch).toHaveBeenCalledWith(
      `/control-center/conversations/${ID}/photo`,
      expect.anything(),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://pps.whatsapp.net/a.jpg',
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it('404 quando o aluno não tem foto', async () => {
    backendFetch.mockResolvedValue(photoUrl(null));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect((await GET(new Request('http://app.test'), params(ID))).status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('não baixa URL fora do host do WhatsApp (SSRF)', async () => {
    backendFetch.mockResolvedValue(photoUrl('https://evil.example.com/a.jpg'));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect((await GET(new Request('http://app.test'), params(ID))).status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('404 quando o CDN devolve algo que não é imagem', async () => {
    backendFetch.mockResolvedValue(photoUrl('https://pps.whatsapp.net/a.jpg'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    expect((await GET(new Request('http://app.test'), params(ID))).status).toBe(404);
  });

  it('propaga 401 da API (sessão expirada)', async () => {
    backendFetch.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await GET(new Request('http://app.test'), params(ID))).status).toBe(401);
  });
});
