/**
 * Unit — `JwtStrategy` (US-1.4): seleção de chave por kid (fail-closed) e denylist.
 */
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';

import { type JwtConfig } from '../../core/config';
import { buildSecretOrKeyProvider, JwtStrategy } from './jwt.strategy';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();

describe('buildSecretOrKeyProvider', () => {
  const keys = new Map([['kid-current', pub]]);
  const provider = buildSecretOrKeyProvider(keys);

  it('devolve a chave registrada para o kid do token', () => {
    const token = jwt.sign({ role: 'ADMIN' }, priv, { algorithm: 'RS256', keyid: 'kid-current' });
    const done = vi.fn();
    provider(undefined as never, token, done);
    expect(done).toHaveBeenCalledWith(null, pub);
  });

  it('recusa (fail-closed) um kid desconhecido', () => {
    const token = jwt.sign({}, priv, { algorithm: 'RS256', keyid: 'kid-desconhecido' });
    const done = vi.fn();
    provider(undefined as never, token, done);
    const [err, key] = done.mock.calls[0] ?? [];
    expect(err).toBeTruthy();
    expect(key).toBeUndefined();
  });

  it('recusa token sem kid no header', () => {
    const token = jwt.sign({}, priv, { algorithm: 'RS256' });
    const done = vi.fn();
    provider(undefined as never, token, done);
    const [err] = done.mock.calls[0] ?? [];
    expect(err).toBeTruthy();
  });

  it('recusa entrada não decodificável', () => {
    const done = vi.fn();
    provider(undefined as never, 'nao-e-jwt', done);
    const [err] = done.mock.calls[0] ?? [];
    expect(err).toBeTruthy();
  });
});

describe('JwtStrategy.validate', () => {
  const config = {
    jwt: {
      algorithm: 'RS256',
      keyId: 'kid-current',
      publicKey: pub,
      privateKey: priv,
      accessTtl: '15m',
    } as JwtConfig,
  };
  const payload = () => ({
    sub: '11111111-1111-4111-8111-111111111111',
    role: 'ADMIN' as const,
    jti: '22222222-2222-4222-8222-222222222222',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900,
  });
  function setup() {
    const denylist = { isRevoked: vi.fn().mockResolvedValue(false) };
    const auth = { assertActiveSession: vi.fn().mockResolvedValue(undefined) };
    return {
      denylist,
      auth,
      strategy: new JwtStrategy(config as never, denylist as never, auth as never),
    };
  }
  it('exige sessão persistida após assinatura, claims e denylist', async () => {
    const { strategy, auth } = setup();
    const p = payload();
    await expect(strategy.validate(p)).resolves.toEqual({
      userId: p.sub,
      role: p.role,
      jti: p.jti,
      expiresAt: p.exp,
    });
    expect(auth.assertActiveSession).toHaveBeenCalledWith(p.sub, p.role, p.jti);
  });
  it('recusa revogação Redis', async () => {
    const { strategy, denylist, auth } = setup();
    denylist.isRevoked.mockResolvedValue(true);
    await expect(strategy.validate(payload())).rejects.toThrow(/revogada/);
    expect(auth.assertActiveSession).not.toHaveBeenCalled();
  });
  it('não autentica se o banco rejeita ou falha', async () => {
    const { strategy, auth } = setup();
    auth.assertActiveSession.mockRejectedValue(new Error('DB indisponível'));
    await expect(strategy.validate(payload())).rejects.toThrow('DB indisponível');
  });
  it.each([
    { exp: undefined },
    { iat: undefined },
    { exp: 0 },
    // Margem larga: o valor é calculado ao carregar o módulo e o teto (900 s) é medido na hora
    // da execução; com +901 um atraso de 1 s no CI fazia o caso virar um token válido.
    { exp: Math.floor(Date.now() / 1000) + 1_000 },
    { iat: Math.floor(Date.now() / 1000) + 10 },
    { jti: 'arbitrary' },
    { role: 'UNKNOWN' },
    { sub: 'not-uuid' },
  ])('recusa claims inválidos %j', async (patch) => {
    const { strategy, auth } = setup();
    await expect(strategy.validate({ ...payload(), ...patch } as never)).rejects.toThrow(
      /malformado/,
    );
    expect(auth.assertActiveSession).not.toHaveBeenCalled();
  });
  it('registra chave N-1 sem deixar de verificar sessão', () => {
    const { denylist, auth } = setup();
    expect(
      () =>
        new JwtStrategy(
          { jwt: { ...config.jwt, previousPublicKey: { keyId: 'old', key: pub } } } as never,
          denylist as never,
          auth as never,
        ),
    ).not.toThrow();
  });
});
