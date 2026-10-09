/**
 * Unit — `AuthService` (US-1.4): login (Argon2id), refresh rotation, detecção de reuse,
 * logout. O banco e a criptografia são mockados; a lógica de rotação/reuse é o foco.
 * A prova ponta a ponta (com Postgres/Redis reais) está em `test/auth.int-spec.ts`.
 */
import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService, isMfaChallenge, type LoginResult } from './auth.service';

/** Chain builder thenable que imita o query builder do Drizzle e resolve para `result`. */
function q<T>(result: T) {
  const b: Record<string, unknown> = {};
  for (const m of [
    'from',
    'innerJoin',
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
  execute: ReturnType<typeof vi.fn>;
};
let db: { runAsSystem: ReturnType<typeof vi.fn>; runAsUser: ReturnType<typeof vi.fn> };
let tokens: Record<string, ReturnType<typeof vi.fn>>;
let denylist: { revoke: ReturnType<typeof vi.fn>; isRevoked: ReturnType<typeof vi.fn> };
let passwords: { verify: ReturnType<typeof vi.fn>; hash: ReturnType<typeof vi.fn> };
let trail: {
  record: ReturnType<typeof vi.fn>;
  recordFailedLogin: ReturnType<typeof vi.fn>;
};
let mfa: {
  modeFor: ReturnType<typeof vi.fn>;
  createChallenge: ReturnType<typeof vi.fn>;
  verifyLogin: ReturnType<typeof vi.fn>;
  enable: ReturnType<typeof vi.fn>;
  beginSetup: ReturnType<typeof vi.fn>;
};
let service: AuthService;

const config = { jwt: { refreshTtlSeconds: 2_592_000, accessTtl: '15m' }, isProduction: false };
const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() };
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const GOOD_SECRET = 'a'.repeat(64);
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

beforeEach(() => {
  tx = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    execute: vi.fn().mockResolvedValue([]),
  };
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
  trail = {
    record: vi.fn(async () => undefined),
    recordFailedLogin: vi.fn(async () => undefined),
  };
  mfa = {
    modeFor: vi.fn(() => null),
    createChallenge: vi.fn(async () => 'c'.repeat(64)),
    verifyLogin: vi.fn(),
    enable: vi.fn(),
    beginSetup: vi.fn(),
  };
  service = new AuthService(
    logger as never,
    db as never,
    tokens as never,
    denylist as never,
    passwords as never,
    config as never,
    trail as never,
    mfa as never,
  );
});

describe('login', () => {
  it('emite access + cookie de refresh para credencial válida', async () => {
    tx.select.mockReturnValueOnce(q([{ id: 'u1', role: 'PROFESSIONAL', passwordHash: 'ph' }]));
    passwords.verify.mockResolvedValue(true);
    tx.select.mockReturnValueOnce(q([{ passwordHash: 'ph', role: 'PROFESSIONAL' }]));
    tx.insert.mockReturnValueOnce(q([{ id: 'sess-1' }]));

    const result = (await service.login(
      { email: 'p@movivo.app', password: 'x' },
      META,
    )) as LoginResult;

    expect(trail.record).toHaveBeenCalledWith('AUTH_LOGIN', 'u1', META, { role: 'PROFESSIONAL' });
    expect(trail.recordFailedLogin).not.toHaveBeenCalled();
    expect(result.accessToken).toBe('access:u1');
    expect(result.refreshCookie).toBe('sess-1.newsecret');
    expect(result.refreshExpiresAt).toBeInstanceOf(Date);
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
    // Sem conta não há ator para a trilha: nada é gravado (e-mail desconhecido só vai ao rate limit).
    expect(trail.recordFailedLogin).not.toHaveBeenCalled();
    expect(trail.record).not.toHaveBeenCalled();
  });

  it('recusa senha errada', async () => {
    tx.select.mockReturnValueOnce(q([{ id: 'u1', role: 'ADMIN', passwordHash: 'ph' }]));
    passwords.verify.mockResolvedValue(false);
    await expect(service.login({ email: 'p@movivo.app', password: 'bad' }, META)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(trail.recordFailedLogin).toHaveBeenCalledWith('u1', META);
    expect(trail.record).not.toHaveBeenCalled();
  });
});

describe('login — segundo fator (MFA)', () => {
  const account = {
    id: 'u1',
    role: 'ADMIN',
    passwordHash: 'ph',
    mfaEnabledAt: new Date(),
  };

  it('senha certa + MFA ativo: devolve só o desafio — NENHUMA sessão, cookie ou AUTH_LOGIN', async () => {
    tx.select.mockReturnValueOnce(q([account]));
    passwords.verify.mockResolvedValue(true);
    mfa.modeFor.mockReturnValueOnce('VERIFY');

    const result = await service.login({ email: 'a@movivo.app', password: 'x' }, META);

    expect(isMfaChallenge(result)).toBe(true);
    expect(result).toEqual({ mfa: { step: 'verify', challengeToken: 'c'.repeat(64) } });
    expect(mfa.createChallenge).toHaveBeenCalledWith('u1', 'VERIFY', 'ph');
    expect(tx.insert).not.toHaveBeenCalled(); // nenhuma linha em auth_sessions
    expect(tokens.signAccessToken).not.toHaveBeenCalled();
    expect(trail.record).not.toHaveBeenCalled();
  });

  it('conta sem MFA numa instalação que exige: desafio de inscrição (setup)', async () => {
    tx.select.mockReturnValueOnce(q([{ ...account, mfaEnabledAt: null }]));
    passwords.verify.mockResolvedValue(true);
    mfa.modeFor.mockReturnValueOnce('SETUP');

    const result = await service.login({ email: 'a@movivo.app', password: 'x' });

    expect(result).toEqual({ mfa: { step: 'setup', challengeToken: 'c'.repeat(64) } });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('senha ERRADA nunca cria desafio (não revela se a conta tem MFA)', async () => {
    tx.select.mockReturnValueOnce(q([account]));
    passwords.verify.mockResolvedValue(false);
    await expect(service.login({ email: 'a@movivo.app', password: 'x' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(mfa.createChallenge).not.toHaveBeenCalled();
  });

  it('completeMfaLogin emite a sessão e audita o método do 2º fator', async () => {
    mfa.verifyLogin.mockResolvedValueOnce({
      userId: 'u1',
      role: 'ADMIN',
      passwordHash: 'ph',
      method: 'totp',
    });
    tx.select.mockReturnValueOnce(q([{ passwordHash: 'ph', role: 'ADMIN' }]));
    tx.insert.mockReturnValueOnce(q([{ id: 'sess-9' }]));

    const result = await service.completeMfaLogin('c'.repeat(64), '123456', META);

    expect(mfa.verifyLogin).toHaveBeenCalledWith('c'.repeat(64), '123456', META);
    expect(result.refreshCookie).toBe('sess-9.newsecret');
    expect(result.user).toEqual({ id: 'u1', role: 'ADMIN' });
    expect(trail.record).toHaveBeenCalledWith('AUTH_LOGIN', 'u1', META, {
      role: 'ADMIN',
      mfa: 'totp',
    });
  });

  it('código errado não emite sessão (a exceção do MfaService sobe)', async () => {
    mfa.verifyLogin.mockRejectedValueOnce(new UnauthorizedException('Código inválido.'));
    await expect(service.completeMfaLogin('c'.repeat(64), '000000')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('enableMfa devolve sessão + códigos de recuperação', async () => {
    mfa.enable.mockResolvedValueOnce({
      userId: 'u1',
      role: 'ADMIN',
      passwordHash: 'ph',
      method: 'enrollment',
      recoveryCodes: ['AAAAA-BBBBB'],
    });
    tx.select.mockReturnValueOnce(q([{ passwordHash: 'ph', role: 'ADMIN' }]));
    tx.insert.mockReturnValueOnce(q([{ id: 'sess-10' }]));

    const result = await service.enableMfa('c'.repeat(64), '123456', META);

    expect(result.recoveryCodes).toEqual(['AAAAA-BBBBB']);
    expect(result.refreshCookie).toBe('sess-10.newsecret');
    expect(trail.record).toHaveBeenCalledWith('AUTH_LOGIN', 'u1', META, {
      role: 'ADMIN',
      mfa: 'enrollment',
    });
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
      .mockReturnValueOnce(q([session]))
      .mockReturnValueOnce(q([{ role: 'PROFESSIONAL' }]))
      .mockReturnValueOnce(q([session]));
    tx.update.mockReturnValueOnce(q(undefined)); // revoga a linha atual
    tx.insert.mockReturnValueOnce(q([{ id: 'sess-2' }])); // nova sessão

    const result = await service.refresh(`${SESSION_ID}.${GOOD_SECRET}`);

    expect(result.refreshCookie).toBe('sess-2.newsecret');
    expect(result.refreshExpiresAt).toEqual(session.expiresAt);
    expect(tx.execute).toHaveBeenCalledTimes(1);
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
    tx.select
      .mockReturnValueOnce(q([session]))
      .mockReturnValueOnce(q([{ role: 'PROFESSIONAL' }]))
      .mockReturnValueOnce(q([{ ...session, refreshTokenHash: 'hash:outro' }]));
    await expect(service.refresh(`${SESSION_ID}.${GOOD_SECRET}`)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('recusa refresh expirado', async () => {
    tx.select
      .mockReturnValueOnce(q([session]))
      .mockReturnValueOnce(q([{ role: 'PROFESSIONAL' }]))
      .mockReturnValueOnce(q([{ ...session, expiresAt: new Date(Date.now() - 1) }]));
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
  it('rejeita refresh concorrente recente sem invalidar o descendente', async () => {
    const revoked = {
      id: SESSION_ID,
      userId: 'u1',
      refreshTokenHash: `hash:${GOOD_SECRET}`,
      jti: 'old-jti',
      familyId: 'fam-1',
      expiresAt: new Date(Date.now() + 100_000),
      revokedAt: new Date(),
    };
    tx.select
      .mockReturnValueOnce(q([revoked]))
      .mockReturnValueOnce(q([{ role: 'PROFESSIONAL' }]))
      .mockReturnValueOnce(q([revoked]))
      .mockReturnValueOnce(q([{ id: 'descendant' }]));

    await expect(service.refresh(`${SESSION_ID}.${GOOD_SECRET}`, META)).rejects.toThrow(
      /já renovada/i,
    );
    expect(tx.update).not.toHaveBeenCalled();
    expect(denylist.revoke).not.toHaveBeenCalled();
  });

  it('refresh após logout recente não é confundido com rotação concorrente', async () => {
    const revoked = {
      id: SESSION_ID,
      userId: 'u1',
      refreshTokenHash: `hash:${GOOD_SECRET}`,
      jti: 'old-jti',
      familyId: 'fam-1',
      expiresAt: new Date(Date.now() + 100_000),
      revokedAt: new Date(),
    };
    tx.select
      .mockReturnValueOnce(q([revoked]))
      .mockReturnValueOnce(q([{ role: 'PROFESSIONAL' }]))
      .mockReturnValueOnce(q([revoked]))
      .mockReturnValueOnce(q([]));
    tx.update.mockReturnValueOnce(q([]));

    await expect(service.refresh(`${SESSION_ID}.${GOOD_SECRET}`)).rejects.toThrow(/reutilizado/i);
    expect(tx.update).toHaveBeenCalledTimes(1);
  });

  it('reapresentar um refresh já revogado invalida a família inteira', async () => {
    const revoked = {
      id: SESSION_ID,
      userId: 'u1',
      refreshTokenHash: `hash:${GOOD_SECRET}`,
      jti: 'old-jti',
      familyId: 'fam-1',
      expiresAt: new Date(Date.now() + 100_000),
      revokedAt: new Date(Date.now() - 60_000),
    };
    tx.select
      .mockReturnValueOnce(q([revoked]))
      .mockReturnValueOnce(q([{ role: 'PROFESSIONAL' }]))
      .mockReturnValueOnce(q([revoked]));
    tx.update.mockReturnValueOnce(q([{ jti: 'j1' }, { jti: 'j2' }])); // família revogada (returning)

    await expect(service.refresh(`${SESSION_ID}.${GOOD_SECRET}`, META)).rejects.toThrow(
      /reutilizado/i,
    );
    expect(trail.record).toHaveBeenCalledWith('AUTH_REFRESH_REUSE_DETECTED', 'u1', META, {
      familyId: 'fam-1',
      sessionsRevoked: 2,
    });
    expect(denylist.revoke).toHaveBeenCalledWith('j1', expect.any(Number));
    expect(denylist.revoke).toHaveBeenCalledWith('j2', expect.any(Number));
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('logout', () => {
  it('denylista o jti do access e revoga a sessão', async () => {
    tx.select.mockReturnValueOnce(q([{ familyId: 'fam-1' }]));
    tx.update.mockReturnValueOnce(q([{ jti: 'jti-x' }]));
    await service.logout('u1', 'PROFESSIONAL', 'jti-x', META);
    expect(trail.record).toHaveBeenCalledWith('AUTH_LOGOUT', 'u1', META);
    expect(denylist.revoke).toHaveBeenCalledWith('jti-x', expect.any(Number));
    expect(db.runAsSystem).toHaveBeenCalledWith(expect.any(Function));
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

describe('logoutRefresh e sessão persistida', () => {
  it('revoga toda a família pelo segredo mesmo com refresh antigo/expirado', async () => {
    tx.select.mockReturnValueOnce(
      q([
        {
          id: SESSION_ID,
          userId: 'u1',
          familyId: 'fam-1',
          refreshTokenHash: `hash:${GOOD_SECRET}`,
          revokedAt: new Date(),
          expiresAt: new Date(0),
        },
      ]),
    );
    tx.update.mockReturnValueOnce(q([{ jti: 'descendant' }]));
    await service.logoutRefresh(`${SESSION_ID}.${GOOD_SECRET}`, META);
    expect(trail.record).toHaveBeenCalledWith('AUTH_LOGOUT', 'u1', META);
    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(denylist.revoke).toHaveBeenCalledWith('descendant', expect.any(Number));
  });
  it('não revoga com segredo adulterado', async () => {
    tx.select.mockReturnValueOnce(q([{ refreshTokenHash: 'other' }]));
    await expect(service.logoutRefresh(`${SESSION_ID}.${GOOD_SECRET}`)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(tx.update).not.toHaveBeenCalled();
  });
  it('nega sessão ausente/revogada mesmo se a denylist estiver vazia', async () => {
    tx.select.mockReturnValueOnce(q([]));
    await expect(service.assertActiveSession('u1', 'ADMIN', 'jti')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
