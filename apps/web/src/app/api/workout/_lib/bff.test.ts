import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const cookieGet = vi.fn();
const incoming = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: cookieGet, set: vi.fn() }),
  headers: async () => incoming.headers,
}));

import { workoutBackendFetch } from './bff';

beforeEach(() => {
  cookieGet.mockReset().mockReturnValue({ value: 'session-token' });
  incoming.headers = new Headers();
  vi.unstubAllGlobals();
});

describe('workoutBackendFetch', () => {
  it('repassa o IP do aluno para o rate limit da API não virar um limite global', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    incoming.headers = new Headers({ 'x-real-ip': '203.0.113.7' });

    await workoutBackendFetch('/workouts/journal');

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const sent = new Headers(init.headers);
    expect(sent.get('x-forwarded-for')).toBe('203.0.113.7');
    expect(sent.get('authorization')).toBe('Bearer session-token');
  });

  it('não inventa X-Forwarded-For quando o proxy não informou o IP', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);

    await workoutBackendFetch('/workouts/journal');

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).has('x-forwarded-for')).toBe(false);
  });
});
