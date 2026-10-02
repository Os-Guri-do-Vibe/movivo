import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const cookieGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: cookieGet, set: vi.fn() }),
  headers: async () => new Headers(),
}));

import { GET } from './route';

const ID = '22222222-2222-4222-8222-222222222222';
const context = { params: Promise.resolve({ id: ID }) };
const request = (headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost/api/workout/sessions/${ID}/share-card`, { headers });

beforeEach(() => {
  cookieGet.mockReset().mockReturnValue({ value: 'session-token' });
  vi.unstubAllGlobals();
});

describe('GET /api/workout/sessions/[id]/share-card', () => {
  it('repassa o PNG da API com cache privado e ETag', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.fn(
      async () => new Response(png, { status: 200, headers: { ETag: '"abc"' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('etag')).toBe('"abc"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`/workouts/sessions/${ID}/share-card`);
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer session-token');
  });

  it('propaga If-None-Match e responde 304 sem corpo', async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 304, headers: { ETag: '"abc"' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(request({ 'if-none-match': '"abc"' }), context);
    expect(response.status).toBe(304);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get('if-none-match')).toBe('"abc"');
  });

  it('devolve o erro JSON da API (404) sem cabeçalho de imagem', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ message: 'Not Found' }, { status: 404 })),
    );
    const response = await GET(request(), context);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('exige a sessão do aluno (cookie)', async () => {
    cookieGet.mockReturnValue(undefined);
    const response = await GET(request(), context);
    expect(response.status).toBe(401);
  });
});
