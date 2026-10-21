import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const cookieGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: cookieGet, set: vi.fn(), delete: vi.fn() }),
  headers: async () => new Headers(),
}));

import { POST } from './route';

const ID = '22222222-2222-4222-8222-222222222222';
const context = { params: Promise.resolve({ id: ID }) };
const request = (headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost/api/workout/sessions/${ID}/late-start`, {
    method: 'POST',
    headers,
  });

beforeEach(() => {
  cookieGet.mockReset().mockReturnValue({ value: 'session-token' });
  vi.unstubAllGlobals();
});

describe('POST /api/workout/sessions/[id]/late-start', () => {
  it('repassa o pedido à API com o token da sessão', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(request({ origin: 'http://localhost:3000' }), context);

    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`/workouts/sessions/${ID}/late-start`);
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer session-token');
  });

  it('recusa pedido de outra origem sem chamar a API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(request({ origin: 'https://outro-site.example' }), context);

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
