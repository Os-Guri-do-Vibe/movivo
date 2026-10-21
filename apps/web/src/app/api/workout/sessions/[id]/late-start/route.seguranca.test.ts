/**
 * BFF do registro tardio (`POST /api/workout/sessions/[id]/late-start`): o que o aluno vê
 * quando algo dá errado e o que o BFF nunca deixa passar. Complementa `route.test.ts`
 * (encaminhamento feliz e origem estranha).
 */
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

function call(id: string, headers: Record<string, string> = { origin: 'http://localhost:3000' }) {
  return POST(
    new NextRequest(`http://localhost/api/workout/sessions/${encodeURIComponent(id)}/late-start`, {
      method: 'POST',
      headers,
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  cookieGet.mockReset().mockReturnValue({ value: 'session-token' });
  vi.unstubAllGlobals();
});

describe('POST /api/workout/sessions/[id]/late-start: falhas e defesas', () => {
  it('sem a sessão do navegador: 401 com orientação, sem chamar a API', async () => {
    cookieGet.mockReturnValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await call(ID);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: 'Abra o link recebido pelo WhatsApp.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fora da janela: repassa o 400 da API com a mensagem, sem cache', async () => {
    const message = 'So e possivel registrar treinos dos ultimos 2 dias.';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message }), { status: 400 })),
    );
    const response = await call(ID);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('treino de outro aluno: o 404 da API chega igual (o BFF não decide titularidade)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })),
    );
    expect((await call(ID)).status).toBe(404);
  });

  it('id com barra não escapa do caminho do recurso na API', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    await call('../../admin/users');
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toMatch(/\/workouts\/sessions\/\.\.%2F\.\.%2Fadmin%2Fusers\/late-start$/);
  });

  it('pedido cross-site (Sec-Fetch-Site) é bloqueado mesmo com a origem certa', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await call(ID, {
      origin: 'http://localhost:3000',
      'sec-fetch-site': 'cross-site',
    });
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
