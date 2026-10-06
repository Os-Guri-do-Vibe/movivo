/**
 * Unit — `AuthController` (US-1.4): fluxo HTTP e opções do cookie de refresh.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthController } from './auth.controller';

let auth: {
  login: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  logoutRefresh: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
  getProfile: ReturnType<typeof vi.fn>;
  completeMfaLogin: ReturnType<typeof vi.fn>;
  startMfaSetup: ReturnType<typeof vi.fn>;
  enableMfa: ReturnType<typeof vi.fn>;
};
let res: { cookie: ReturnType<typeof vi.fn>; clearCookie: ReturnType<typeof vi.fn> };
let controller: AuthController;

/** Request mínimo: o controller só lê `ip`, `get('user-agent')` e `cookies`. */
const REQ = { ip: '203.0.113.7', get: () => 'vitest', cookies: {} };
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

const config = {
  jwt: { refreshTtlSeconds: 2_592_000 },
  isProduction: false,
  avatarUrl: vi.fn((path: string | null) => (path ? `https://api.test/avatar/${path}` : null)),
};

beforeEach(() => {
  auth = {
    login: vi.fn(),
    refresh: vi.fn(),
    logoutRefresh: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    getProfile: vi.fn(async () => ({ name: 'Ana Souza', avatarPath: 'abc.jpg' })),
    completeMfaLogin: vi.fn(),
    startMfaSetup: vi.fn(),
    enableMfa: vi.fn(),
  };
  res = { cookie: vi.fn(), clearCookie: vi.fn() };
  controller = new AuthController(auth as never, config as never);
});

describe('POST /auth/login', () => {
  it('valida o body, seta o cookie httpOnly/SameSite=Strict e retorna o access', async () => {
    auth.login.mockResolvedValue({
      accessToken: 'access',
      refreshCookie: 'sess.secret',
      user: { id: 'u1', role: 'PROFESSIONAL' },
    });

    const out = await controller.login(
      { email: 'p@movivo.app', password: 'senha' },
      REQ as never,
      res as never,
    );
    expect(auth.login).toHaveBeenCalledWith({ email: 'p@movivo.app', password: 'senha' }, META);

    expect(out).toEqual({ accessToken: 'access', user: { id: 'u1', role: 'PROFESSIONAL' } });
    expect(res.cookie).toHaveBeenCalledWith(
      'movivo_refresh',
      'sess.secret',
      // Secure=false em dev (supertest usa http); vira true em produção.
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'strict',
        path: '/api/v1/auth',
        secure: false,
      }),
    );
  });

  it('recusa body inválido (Zod)', async () => {
    await expect(
      controller.login({ email: 'nao-email' }, REQ as never, res as never),
    ).rejects.toBeTruthy();
  });
});

describe('POST /auth/refresh', () => {
  it('lê o cookie do request e rotaciona', async () => {
    auth.refresh.mockResolvedValue({
      accessToken: 'access2',
      refreshCookie: 'sess2.secret2',
      user: { id: 'u1', role: 'ADMIN' },
    });
    const req = { ...REQ, cookies: { movivo_refresh: 'sess.secret' } };

    const out = await controller.refresh(req as never, res as never);

    expect(auth.refresh).toHaveBeenCalledWith('sess.secret', META);
    expect(out.accessToken).toBe('access2');
    expect(res.cookie).toHaveBeenCalledWith('movivo_refresh', 'sess2.secret2', expect.any(Object));
  });
});

describe('POST /auth/logout', () => {
  it('revoga a sessão e limpa o cookie', async () => {
    await controller.logout(
      { userId: 'u1', role: 'PROFESSIONAL', jti: 'j1' },
      REQ as never,
      res as never,
    );
    expect(auth.logout).toHaveBeenCalledWith('u1', 'PROFESSIONAL', 'j1', META);
    expect(res.clearCookie).toHaveBeenCalledWith('movivo_refresh', expect.any(Object));
  });
});

describe('endpoints de sanidade', () => {
  it('GET /auth/me devolve o usuário autenticado, incluindo nome e avatar cadastrados', async () => {
    await expect(controller.me({ userId: 'u1', role: 'USER', jti: 'j1' })).resolves.toEqual({
      userId: 'u1',
      role: 'USER',
      name: 'Ana Souza',
      avatarUrl: 'https://api.test/avatar/abc.jpg',
      capabilities: [],
    });
    expect(auth.getProfile).toHaveBeenCalledWith('u1');
    expect(config.avatarUrl).toHaveBeenCalledWith('abc.jpg');
  });

  it('GET /auth/admin/ping devolve ok com o papel', () => {
    expect(controller.adminPing({ userId: 'u1', role: 'ADMIN', jti: 'j1' })).toEqual({
      ok: true,
      role: 'ADMIN',
    });
  });
});

it('logout pelo refresh não exige access token', async () => {
  await controller.logoutRefresh(
    { ...REQ, cookies: { movivo_refresh: 'sess.secret' } } as never,
    res as never,
  );
  expect(auth.logoutRefresh).toHaveBeenCalledWith('sess.secret', META);
  expect(res.clearCookie).toHaveBeenCalledWith('movivo_refresh', expect.any(Object));
});

const TOKEN = 'a'.repeat(64);

describe('login com 2º fator (MFA)', () => {
  it('desafio pendente: devolve só o desafio, SEM cookie nem access token', async () => {
    auth.login.mockResolvedValue({ mfa: { step: 'verify', challengeToken: TOKEN } });

    const out = await controller.login(
      { email: 'p@movivo.app', password: 'senha' },
      REQ as never,
      res as never,
    );

    expect(out).toEqual({ mfa: { step: 'verify', challengeToken: TOKEN } });
    expect(res.cookie).not.toHaveBeenCalled();
  });
});

describe('POST /auth/mfa/verify', () => {
  it('resolve o desafio com o código, seta o cookie e devolve o access', async () => {
    auth.completeMfaLogin.mockResolvedValue({
      accessToken: 'access',
      refreshCookie: 'sess.secret',
      user: { id: 'u1', role: 'ADMIN' },
    });

    const out = await controller.mfaVerify(
      { challengeToken: TOKEN, code: '123456' },
      REQ as never,
      res as never,
    );

    expect(auth.completeMfaLogin).toHaveBeenCalledWith(TOKEN, '123456', META);
    expect(out).toEqual({ accessToken: 'access', user: { id: 'u1', role: 'ADMIN' } });
    expect(res.cookie).toHaveBeenCalledWith(
      'movivo_refresh',
      'sess.secret',
      expect.objectContaining({ httpOnly: true, sameSite: 'strict' }),
    );
  });

  it.each([
    ['sem desafio', { code: '123456' }],
    ['desafio malformado', { challengeToken: 'curto', code: '123456' }],
    ['código ausente', { challengeToken: TOKEN }],
    ['código com injeção', { challengeToken: TOKEN, code: "1' OR '1'='1" }],
    ['campo extra (mass assignment)', { challengeToken: TOKEN, code: '123456', role: 'ADMIN' }],
  ])('rejeita corpo inválido: %s', async (_label, body) => {
    await expect(controller.mfaVerify(body, REQ as never, res as never)).rejects.toBeTruthy();
    expect(auth.completeMfaLogin).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
  });
});

describe('POST /auth/mfa/setup e /auth/mfa/enable', () => {
  it('setup devolve segredo e URI do QR do desafio', async () => {
    const setup = {
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/x',
      account: 'a@x.com',
    };
    auth.startMfaSetup.mockResolvedValue(setup);
    await expect(controller.mfaSetup({ challengeToken: TOKEN })).resolves.toEqual(setup);
    expect(auth.startMfaSetup).toHaveBeenCalledWith(TOKEN);
  });

  it('enable entra e devolve os códigos de recuperação UMA vez, sem expor o refresh no corpo', async () => {
    auth.enableMfa.mockResolvedValue({
      accessToken: 'access',
      refreshCookie: 'sess.secret',
      user: { id: 'u1', role: 'ADMIN' },
      recoveryCodes: ['AAAAA-BBBBB'],
    });

    const out = await controller.mfaEnable(
      { challengeToken: TOKEN, code: '123456' },
      REQ as never,
      res as never,
    );

    expect(out).toEqual({
      accessToken: 'access',
      user: { id: 'u1', role: 'ADMIN' },
      recoveryCodes: ['AAAAA-BBBBB'],
    });
    expect(JSON.stringify(out)).not.toContain('sess.secret');
    expect(res.cookie).toHaveBeenCalled();
  });
});
