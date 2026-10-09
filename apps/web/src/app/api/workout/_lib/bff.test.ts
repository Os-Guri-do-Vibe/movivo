import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const cookieGet = vi.fn();
const cookieSet = vi.fn();
const cookieDelete = vi.fn();
const incoming = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: cookieGet, set: cookieSet, delete: cookieDelete }),
  headers: async () => incoming.headers,
}));

import { exchangeMagicToken, workoutBackendFetch } from './bff';

beforeEach(() => {
  cookieGet.mockReset().mockReturnValue({ value: 'session-token' });
  cookieSet.mockReset();
  cookieDelete.mockReset();
  incoming.headers = new Headers();
  vi.unstubAllGlobals();
});

it('troca o link por cookie HttpOnly restrito às rotas de treino e remove o legado', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ sessionToken: 'novo-token' }))),
  );
  await exchangeMagicToken('link');
  expect(cookieSet).toHaveBeenCalledWith(
    'movivo_workout_session_v2',
    'novo-token',
    expect.objectContaining({
      httpOnly: true,
      sameSite: 'strict',
      path: '/api/workout',
      maxAge: 30 * 24 * 60 * 60,
    }),
  );
  expect(cookieDelete).toHaveBeenCalledWith({ name: 'movivo_workout_session', path: '/' });
});

it('migra a sessão de treino existente sem exigir novo link', async () => {
  cookieGet.mockImplementation((name) =>
    name === 'movivo_workout_session' ? { value: 'token-legado' } : undefined,
  );
  const fetchMock = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);
  await workoutBackendFetch('/workouts/journal');
  expect(cookieSet).toHaveBeenCalledWith(
    'movivo_workout_session_v2',
    'token-legado',
    expect.objectContaining({ path: '/api/workout' }),
  );
  expect(cookieDelete).toHaveBeenCalledWith({ name: 'movivo_workout_session', path: '/' });
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
