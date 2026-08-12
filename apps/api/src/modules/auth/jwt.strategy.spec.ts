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
      previousPublicKey: undefined,
    } as JwtConfig,
  };

  function roleCacheWith(role: string | null) {
    return { get: vi.fn().mockResolvedValue(role) };
  }

  it('retorna o usuário autenticado quando o jti não está revogado', async () => {
    const denylist = { isRevoked: vi.fn().mockResolvedValue(false) };
    const db = roleCacheWith('PROFESSIONAL');
    const userId = '11111111-1111-4111-8111-111111111111';
    const strategy = new JwtStrategy(config as never, denylist as never, db as never);
    const user = await strategy.validate({ sub: userId, role: 'PROFESSIONAL', jti: 'j1' });
    expect(user).toEqual({ userId, role: 'PROFESSIONAL', jti: 'j1' });
  });

  it('recusa quando o jti está na denylist (logout/reuse)', async () => {
    const denylist = { isRevoked: vi.fn().mockResolvedValue(true) };
    const strategy = new JwtStrategy(
      config as never,
      denylist as never,
      roleCacheWith('USER') as never,
    );
    await expect(
      strategy.validate({
        sub: '11111111-1111-4111-8111-111111111111',
        role: 'USER',
        jti: 'j1',
      }),
    ).rejects.toThrow();
  });

  it('recusa imediatamente quando o papel persistido foi removido', async () => {
    const denylist = { isRevoked: vi.fn().mockResolvedValue(false) };
    const strategy = new JwtStrategy(
      config as never,
      denylist as never,
      roleCacheWith('SUPPORT') as never,
    );
    await expect(
      strategy.validate({
        sub: '11111111-1111-4111-8111-111111111111',
        role: 'ADMIN',
        jti: 'j1',
      }),
    ).rejects.toThrow(/Papel da sessão/);
  });

  it('recusa conta removida e subject malformado', async () => {
    const denylist = { isRevoked: vi.fn().mockResolvedValue(false) };
    const db = roleCacheWith(null);
    const strategy = new JwtStrategy(config as never, denylist as never, db as never);
    await expect(
      strategy.validate({
        sub: '11111111-1111-4111-8111-111111111111',
        role: 'ADMIN',
        jti: 'j1',
      }),
    ).rejects.toThrow(/Papel da sessão/);
    await expect(
      strategy.validate({ sub: 'nao-uuid', role: 'ADMIN', jti: 'j2' }),
    ).rejects.toThrow(/malformado/);
  });

  it('registra a chave N-1 quando configurada (rotação)', () => {
    const withPrev = {
      jwt: {
        ...config.jwt,
        previousPublicKey: { keyId: 'kid-old', key: pub },
      } as JwtConfig,
    };
    const denylist = { isRevoked: vi.fn() };
    expect(
      () => new JwtStrategy(withPrev as never, denylist as never, roleCacheWith('USER') as never),
    ).not.toThrow();
  });
});
