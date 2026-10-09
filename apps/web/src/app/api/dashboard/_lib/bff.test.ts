import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }));
const incoming = vi.hoisted(() => ({ value: new Map<string, string>() }));
vi.mock('next/headers', () => ({
  cookies: async () => mocks,
  headers: async () => ({ get: (name: string) => incoming.value.get(name) ?? null }),
}));
import {
  loginBackend,
  logoutBackend,
  mfaEnableBackend,
  mfaSetupBackend,
  mfaVerifyBackend,
  authenticatedBackendFetch,
  BFF_ACCESS_COOKIE,
  BFF_REFRESH_COOKIE,
  readBackendSession,
} from './bff';
beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  incoming.value = new Map();
});
it('logout envia apenas refresh mesmo sem access e só limpa após confirmação', async () => {
  mocks.get.mockImplementation((name) =>
    name === BFF_REFRESH_COOKIE ? { value: 'opaque.refresh' } : undefined,
  );
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetch);
  incoming.value = new Map([
    ['x-real-ip', '203.0.113.7'],
    ['user-agent', 'Mozilla/5.0 teste'],
  ]);
  await logoutBackend();
  expect(fetch).toHaveBeenCalledWith(
    expect.stringMatching(/auth\/logout\/refresh$/),
    expect.objectContaining({
      method: 'POST',
      // IP/UA reais do visitante: sem eles a API grava o IP do container web.
      headers: {
        Cookie: 'movivo_refresh=opaque.refresh',
        'X-Forwarded-For': '203.0.113.7',
        'User-Agent': 'Mozilla/5.0 teste',
      },
    }),
  );
  expect(mocks.delete).toHaveBeenCalledWith(BFF_REFRESH_COOKIE);
});
it.each([401, 500, 503])(
  'falha %s não descarta credencial necessária para tentar revogar novamente',
  async (status) => {
    mocks.get.mockReturnValue({ value: 'opaque.refresh' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));
    await expect(logoutBackend()).rejects.toThrow(/encerrar/);
    expect(mocks.delete).not.toHaveBeenCalled();
  },
);
it('falha de rede não simula revogação', async () => {
  mocks.get.mockReturnValue({ value: 'opaque.refresh' });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  await expect(logoutBackend()).rejects.toThrow('offline');
  expect(mocks.delete).not.toHaveBeenCalled();
});
it('cookie inventado não autentica operação protegida', async () => {
  mocks.get.mockImplementation((name) =>
    name === BFF_ACCESS_COOKIE ? { value: 'forged' } : undefined,
  );
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
  vi.stubGlobal('fetch', fetch);
  await expect(authenticatedBackendFetch('/account/profile')).rejects.toThrow(/ausente/);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]?.[0]).toMatch(/auth\/me$/);
});

it('duas requisições simultâneas compartilham uma rotação e ambas renovam os cookies', async () => {
  mocks.get.mockImplementation((name) =>
    name === BFF_ACCESS_COOKIE
      ? { value: 'access-expirado' }
      : name === BFF_REFRESH_COOKIE
        ? { value: 'sess.secret' }
        : undefined,
  );
  let releaseRefresh!: (response: Response) => void;
  const refreshResponse = new Promise<Response>((resolve) => {
    releaseRefresh = resolve;
  });
  const fetch = vi.fn((url: string, init: RequestInit) => {
    if (url.endsWith('/auth/refresh')) return refreshResponse;
    if (url.endsWith('/auth/me')) {
      return Promise.resolve(
        init.headers instanceof Headers &&
          init.headers.get('Authorization') === 'Bearer access-expirado'
          ? new Response(null, { status: 401 })
          : new Response(JSON.stringify({ userId: 'u1', role: 'ADMIN' }), { status: 200 }),
      );
    }
    return Promise.resolve(new Response('{}', { status: 200 }));
  });
  vi.stubGlobal('fetch', fetch);

  const first = authenticatedBackendFetch('/account/profile');
  const second = authenticatedBackendFetch('/account/profile');
  await vi.waitFor(() =>
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/auth/refresh'))).toHaveLength(1),
  );
  releaseRefresh(sessionResponse({ accessToken: 'access-novo' }));

  expect((await first).status).toBe(200);
  expect((await second).status).toBe(200);
  expect(fetch.mock.calls.filter(([url]) => url.endsWith('/auth/refresh'))).toHaveLength(1);
  expect(mocks.set.mock.calls.filter(([name]) => name === BFF_REFRESH_COOKIE)).toHaveLength(2);
});

it('rotação concorrente em outra instância não apaga a sessão do navegador', async () => {
  mocks.get.mockImplementation((name) =>
    name === BFF_REFRESH_COOKIE ? { value: 'sess.secret' } : undefined,
  );
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 409 })));
  await expect(readBackendSession()).rejects.toMatchObject({ status: 409 });
  expect(mocks.delete).not.toHaveBeenCalled();
});

it('login repassa IP e user-agent reais do visitante (rate limit e trilha por origem)', async () => {
  incoming.value = new Map([
    ['x-real-ip', '198.51.100.20'],
    ['user-agent', 'Mozilla/5.0 login'],
  ]);
  const response = new Response(
    JSON.stringify({ accessToken: 'access', user: { id: 'u1', role: 'ADMIN' } }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'movivo_refresh=sess.secret; Max-Age=2592000; Path=/',
      },
    },
  );
  const fetch = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetch);
  await loginBackend({ email: 'a@movivo.app', password: 'x' });
  expect(fetch).toHaveBeenCalledWith(
    expect.stringMatching(/auth\/login$/),
    expect.objectContaining({
      headers: expect.objectContaining({
        'X-Forwarded-For': '198.51.100.20',
        'User-Agent': 'Mozilla/5.0 login',
      }),
    }),
  );
});

it('login sem cabeçalhos de visitante não inventa IP', async () => {
  const response = new Response(
    JSON.stringify({ accessToken: 'access', user: { id: 'u1', role: 'ADMIN' } }),
    {
      status: 200,
      headers: { 'set-cookie': 'movivo_refresh=sess.secret; Max-Age=2592000; Path=/' },
    },
  );
  const fetch = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetch);
  await loginBackend({ email: 'a@movivo.app', password: 'x' });
  const init = fetch.mock.calls[0]?.[1] as { headers: Record<string, string> };
  expect(init.headers).not.toHaveProperty('X-Forwarded-For');
});

const CHALLENGE = 'b'.repeat(64);
const sessionResponse = (extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({ accessToken: 'access', user: { id: 'u1', role: 'ADMIN' }, ...extra }),
    {
      status: 200,
      headers: { 'set-cookie': 'movivo_refresh=sess.secret; Max-Age=2592000; Path=/' },
    },
  );

it('login com 2º fator pendente devolve o desafio e NÃO grava nenhum cookie de sessão', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ mfa: { step: 'verify', challengeToken: CHALLENGE } }), {
        status: 200,
      }),
    ),
  );
  const outcome = await loginBackend({ email: 'a@movivo.app', password: 'x' });
  expect(outcome).toEqual({ kind: 'mfa', step: 'verify', challengeToken: CHALLENGE });
  expect(mocks.set).not.toHaveBeenCalled();
});

it('login sem MFA segue devolvendo a sessão (cookies gravados)', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionResponse()));
  const outcome = await loginBackend({ email: 'a@movivo.app', password: 'x' });
  expect(outcome.kind).toBe('session');
  expect(mocks.set).toHaveBeenCalledWith(BFF_ACCESS_COOKIE, 'access', expect.any(Object));
  expect(mocks.set).toHaveBeenCalledWith(BFF_REFRESH_COOKIE, 'sess.secret', expect.any(Object));
});

it('copia o prazo restante do refresh da API, sem reiniciar os 30 dias', async () => {
  const response = sessionResponse();
  response.headers.set('set-cookie', 'movivo_refresh=sess.secret; Max-Age=86400; Path=/');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  await loginBackend({ email: 'a@movivo.app', password: 'x' });
  expect(mocks.set).toHaveBeenCalledWith(
    BFF_REFRESH_COOKIE,
    'sess.secret',
    expect.objectContaining({ maxAge: 86_400, httpOnly: true, sameSite: 'strict', path: '/' }),
  );
});

it('mfa/verify: sucesso grava a sessão; erro repassa status e mensagem da API (429 incluso)', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(sessionResponse()));
  const session = await mfaVerifyBackend({ challengeToken: CHALLENGE, code: '123456' });
  expect(session.role).toBe('ADMIN');
  expect(mocks.set).toHaveBeenCalledWith(BFF_REFRESH_COOKIE, 'sess.secret', expect.any(Object));

  mocks.set.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ message: 'Muitas tentativas de código. Aguarde 15 minutos.' }),
        {
          status: 429,
        },
      ),
    ),
  );
  await expect(
    mfaVerifyBackend({ challengeToken: CHALLENGE, code: '000000' }),
  ).rejects.toMatchObject({
    status: 429,
    message: expect.stringContaining('Muitas tentativas'),
  });
  expect(mocks.set).not.toHaveBeenCalled();
});

it('mfa/setup desenha o QR no servidor (PNG em data URL) e repassa a chave', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          secret: 'JBSWY3DPEHPK3PXP',
          otpauthUri: 'otpauth://totp/MOVIVO:a%40movivo.app?secret=JBSWY3DPEHPK3PXP&issuer=MOVIVO',
          account: 'a@movivo.app',
        }),
        { status: 200 },
      ),
    ),
  );
  const view = await mfaSetupBackend({ challengeToken: CHALLENGE });
  expect(view.secret).toBe('JBSWY3DPEHPK3PXP');
  expect(view.account).toBe('a@movivo.app');
  expect(view.qrDataUrl).toMatch(/^data:image\/png;base64,/);
});

it('mfa/enable devolve sessão + códigos de recuperação; sem códigos é erro 502', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValueOnce(sessionResponse({ recoveryCodes: ['AAAAA-BBBBB', 7] })),
  );
  const result = await mfaEnableBackend({ challengeToken: CHALLENGE, code: '123456' });
  expect(result.recoveryCodes).toEqual(['AAAAA-BBBBB']);
  expect(mocks.set).toHaveBeenCalledWith(BFF_ACCESS_COOKIE, 'access', expect.any(Object));

  mocks.set.mockClear();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sessionResponse()));
  await expect(
    mfaEnableBackend({ challengeToken: CHALLENGE, code: '123456' }),
  ).rejects.toMatchObject({
    status: 502,
  });
  expect(mocks.set).not.toHaveBeenCalled();
});
