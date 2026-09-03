/**
 * Unit — `AuthService` (US-1.4): login (Argon2id), refresh rotation, detecção de reuse,
 * logout. O banco e a criptografia são mockados; a lógica de rotação/reuse é o foco.
 * A prova ponta a ponta (com Postgres/Redis reais) está em `test/auth.int-spec.ts`.
 */
import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service';

/** Chain builder thenable que imita o query builder do Drizzle e resolve para `result`. */
function q<T>(result: T) {
  const b: Record<string, unknown> = {};
  for (const m of [
    'from',
    'where',
    'for',
    'limit',
    'values',
    'set',
    'returning',
    'onConflictDoUpdate',
  ]) {
    b[m] = () => b;
  }
  b.then = (resolve: (v: T) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return b as never;
}

let tx: {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};
let db: { runAsSystem: ReturnType<typeof vi.fn>; runAsUser: ReturnType<typeof vi.fn> };
let tokens: Record<string, ReturnType<typeof vi.fn>>;
let denylist: { revoke: ReturnType<typeof vi.fn>; isRevoked: ReturnType<typeof vi.fn> };
let passwords: { verify: ReturnType<typeof vi.fn>; hash: ReturnType<typeof vi.fn> };
let service: AuthService;

const config = { jwt: { refreshTtlSeconds: 2_592_000, accessTtl: '15m' }, isProduction: false };
const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() };
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const GOOD_SECRET = 'a'.repeat(64);

beforeEach(() => {
  tx = { select: vi.fn(), insert: vi.fn(), update: vi.fn() };
  db = {
    runAsSystem: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    runAsUser: vi.fn(async (_u: string, _r: string, cb: (t: unknown) => unknown) => cb(tx)),
  };
  tokens = {
    generateRefreshSecret: vi.fn(() => 'newsecret'),
    hashRefreshSecret: vi.fn((x: string) => `hash:${x}`),
    safeEqualHash: vi.fn((a: string, b: string) => a === b),
    signAccessToken: vi.fn((sub: string, _role, jti: string) => ({
      token: `access:${sub}`,
      jti: jti ?? 'gen',
      expiresAt: 9_999_999_999,
    })),
  };
  denylist = { revoke: vi.fn(async () => undefined), isRevoked: vi.fn() };
  passwords = { verify: vi.fn(), hash: vi.fn() };
  service = new AuthService(
    logger as never,
    db as never,
    tokens as never,
    denylist as never,
    passwords as never,
    config as never,
  );
});

describe('login', () => {
  it('emite access + cookie de refresh para credencial válida', async () => {
    tx.select.mockReturnValueOnce(q([{ id: 'u1', role: 'PROFESSIONAL', passwordHash: 'ph' }]));
    passwords.verify.mockResolvedValue(true);
    tx.insert.mockReturnValueOnce(q([{ id: 'sess-1' }]));

    const result = await service.login({ email: 'p@movivo.app', password: 'x' });

    expect(result.accessToken).toBe('access:u1');
    expect(result.refreshCookie).toBe('sess-1.newsecret');
    expect(result.user).toEqual({ id: 'u1', role: 'PROFESSIONAL' });
    // hash do refresh persistido, nunca o segredo em claro.
    expect(tokens.hashRefreshSecret).toHaveBeenCalledWith('newsecret');
  });

  it('recusa quando o e-mail não existe (verificação ainda roda — anti-timing)', async () => {
    tx.select.mockReturnValueOnce(q([]));
    passwords.verify.mockResolvedValue(false);
    await expect(service.login({ email: 'x@y.z', password: 'x' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(passwords.verify).toHaveBeenCalledWith(null, 'x');
  });

  it('recusa senha errada', async () => {
    tx.select.mockReturnValueOnce(q([{ id: 'u1', role: 'ADMIN', passwordHash: 'ph' }]));
    passwords.verify.mockResolvedValue(false);
    await expect(service.login({ email: 'p@movivo.app', password: 'bad' })).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('refresh — rotation', () => {
  const session = {
    id: SESSION_ID,
    userId: 'u1',
    refreshTokenHash: `hash:${GOOD_SECRET}`,
    jti: 'old-jti',
    familyId: 'fam-1',
    expiresAt: new Date(Date.now() + 100_000),
    revokedAt: null,
  };

  it('valida, invalida o anterior e emite um par novo na mesma família', async () => {
    tx.select
      .mockReturnValueOnce(q([session])) // lookup da sessão
      .mockReturnValueOnce(q([{ role: 'PROFESSIONAL' }])); // role do usuário
    tx.update.mockReturnValueOnce(q(undefined)); // revoga a linha atual
    tx.insert.mockReturnValueOnce(q([{ id: 'sess-2' }])); // nova sessão

    const result = await service.refresh(`${SESSION_ID}.${GOOD_SECRET}`);

    expect(result.refreshCookie).toBe('sess-2.newsecret');
    expect(result.accessToken).toBe('access:u1');
    // o refresh antigo foi revogado (update) e seu jti denylistado.
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(denylist.revoke).toHaveBeenCalledWith('old-jti', expect.any(Number));
  });

  it('recusa cookie ausente', async () => {
    await expect(service.refresh(undefined)).rejects.toThrow(UnauthorizedException);
  });

  it('recusa quando a sessão não existe', async () => {
    tx.select.mockReturnValueOnce(q([]));
    await expect(service.refresh(`${SESSION_ID}.${GOOD_SECRET}`)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('recusa quando o segredo não bate o hash', async () => {
    tx.select.mockReturnValueOnce(q([{ ...session, refreshTokenHash: 'hash:outro' }]));
    await expect(service.refresh(`${SESSION_ID}.${GOOD_SECRET}`)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('recusa refresh expirado', async () => {
    tx.select.mockReturnValueOnce(q([{ ...session, expiresAt: new Date(Date.now() - 1) }]));
    await expect(service.refresh(`${SESSION_ID}.${GOOD_SECRET}`)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('recusa cookie com UUID ou segredo fora do contrato antes de consultar o banco', async () => {
    await expect(service.refresh('sess-1.secret')).rejects.toThrow(UnauthorizedException);
    expect(db.runAsSystem).not.toHaveBeenCalled();
  });
});

describe('refresh — detecção de reuse', () => {
  it('reapresentar um refresh já revogado invalida a família inteira', async () => {
    const revoked = {
      id: SESSION_ID,
      userId: 'u1',
      refreshTokenHash: `hash:${GOOD_SECRET}`,
      jti: 'old-jti',
      familyId: 'fam-1',
      expiresAt: new Date(Date.now() + 100_000),
      revokedAt: new Date(),
    };
    tx.select.mockReturnValueOnce(q([revoked]));
    tx.update.mockReturnValueOnce(q([{ jti: 'j1' }, { jti: 'j2' }])); // família revogada (returning)

    await expect(service.refresh(`${SESSION_ID}.${GOOD_SECRET}`)).rejects.toThrow(/reutilizado/i);
    expect(denylist.revoke).toHaveBeenCalledWith('j1', expect.any(Number));
    expect(denylist.revoke).toHaveBeenCalledWith('j2', expect.any(Number));
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('logout', () => {
  it('denylista o jti do access e revoga a sessão', async () => {
    tx.update.mockReturnValueOnce(q(undefined));
    await service.logout('u1', 'PROFESSIONAL', 'jti-x');
    expect(denylist.revoke).toHaveBeenCalledWith('jti-x', expect.any(Number));
    expect(db.runAsUser).toHaveBeenCalledWith('u1', 'PROFESSIONAL', expect.any(Function));
  });
});

describe('getProfile', () => {
  it('devolve nome e avatar cadastrados da conta', async () => {
    tx.select.mockReturnValueOnce(q([{ name: 'Ana Souza', avatarPath: 'abc.jpg' }]));
    await expect(service.getProfile('u1')).resolves.toEqual({
      name: 'Ana Souza',
      avatarPath: 'abc.jpg',
    });
    expect(db.runAsSystem).toHaveBeenCalledWith(expect.any(Function));
  });

  it('devolve null quando a conta não tem nome/avatar cadastrado ou não existe', async () => {
    tx.select.mockReturnValueOnce(q([]));
    await expect(service.getProfile('u1')).resolves.toEqual({ name: null, avatarPath: null });
  });
});
