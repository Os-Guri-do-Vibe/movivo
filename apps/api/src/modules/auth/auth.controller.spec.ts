/**
 * Unit — `AuthController` (US-1.4): fluxo HTTP e opções do cookie de refresh.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthController } from './auth.controller';

let auth: {
  login: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
};
let res: { cookie: ReturnType<typeof vi.fn>; clearCookie: ReturnType<typeof vi.fn> };
let controller: AuthController;

const config = { jwt: { refreshTtlSeconds: 2_592_000 }, isProduction: false };

beforeEach(() => {
  auth = {
    login: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(async () => undefined),
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

    const out = await controller.login({ email: 'p@movivo.app', password: 'senha' }, res as never);

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
    await expect(controller.login({ email: 'nao-email' }, res as never)).rejects.toBeTruthy();
  });
});

describe('POST /auth/refresh', () => {
  it('lê o cookie do request e rotaciona', async () => {
    auth.refresh.mockResolvedValue({
      accessToken: 'access2',
      refreshCookie: 'sess2.secret2',
      user: { id: 'u1', role: 'ADMIN' },
    });
    const req = { cookies: { movivo_refresh: 'sess.secret' } };

    const out = await controller.refresh(req as never, res as never);

    expect(auth.refresh).toHaveBeenCalledWith('sess.secret');
    expect(out.accessToken).toBe('access2');
    expect(res.cookie).toHaveBeenCalledWith('movivo_refresh', 'sess2.secret2', expect.any(Object));
  });
});

describe('POST /auth/logout', () => {
  it('revoga a sessão e limpa o cookie', async () => {
    await controller.logout({ userId: 'u1', role: 'PROFESSIONAL', jti: 'j1' }, res as never);
    expect(auth.logout).toHaveBeenCalledWith('u1', 'PROFESSIONAL', 'j1');
    expect(res.clearCookie).toHaveBeenCalledWith('movivo_refresh', expect.any(Object));
  });
});

describe('endpoints de sanidade', () => {
  it('GET /auth/me devolve o usuário autenticado', () => {
    expect(controller.me({ userId: 'u1', role: 'USER', jti: 'j1' })).toEqual({
      userId: 'u1',
      role: 'USER',
    });
  });

  it('GET /auth/admin/ping devolve ok com o papel', () => {
    expect(controller.adminPing({ userId: 'u1', role: 'ADMIN', jti: 'j1' })).toEqual({
      ok: true,
      role: 'ADMIN',
    });
  });
});
