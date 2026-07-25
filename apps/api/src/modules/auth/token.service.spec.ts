/**
 * Unit — `TokenService` (US-1.4): assinatura RS256, hashing e comparação segura.
 */
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';

import { type JwtConfig } from '../../core/config';
import { TokenService } from './token.service';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = {
  private: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  public: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
};

const jwtConfig: JwtConfig = {
  algorithm: 'RS256',
  keyId: 'kid-test',
  privateKey: pem.private,
  publicKey: pem.public,
  previousPublicKey: undefined,
  accessTtl: '15m',
  refreshTtl: '30d',
  refreshTtlSeconds: 30 * 86_400,
};

const service = new TokenService({ jwt: jwtConfig } as never);

describe('TokenService.signAccessToken', () => {
  it('assina em RS256 com kid, sub, role e jti no header/claims', () => {
    const issued = service.signAccessToken('user-1', 'PROFESSIONAL', 'jti-1');
    const decoded = jwt.decode(issued.token, { complete: true });
    expect(decoded?.header.alg).toBe('RS256');
    expect(decoded?.header.kid).toBe('kid-test');
    const payload = decoded?.payload as jwt.JwtPayload;
    expect(payload.sub).toBe('user-1');
    expect(payload.role).toBe('PROFESSIONAL');
    expect(payload.jti).toBe('jti-1');
    expect(issued.jti).toBe('jti-1');
    expect(issued.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('o token é verificável com a chave pública e RS256', () => {
    const issued = service.signAccessToken('user-2', 'ADMIN');
    const verified = jwt.verify(issued.token, pem.public, { algorithms: ['RS256'] });
    expect((verified as jwt.JwtPayload).sub).toBe('user-2');
  });

  it('gera um jti quando não é fornecido', () => {
    const issued = service.signAccessToken('user-3', 'USER');
    expect(issued.jti).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('TokenService refresh hashing', () => {
  it('generateRefreshSecret devolve 64 chars hex (256 bits)', () => {
    const secret = service.generateRefreshSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(service.generateRefreshSecret()).not.toBe(secret);
  });

  it('hashRefreshSecret é determinístico e diferente do segredo', () => {
    const secret = 'abc123';
    const hash = service.hashRefreshSecret(secret);
    expect(hash).toBe(service.hashRefreshSecret(secret));
    expect(hash).not.toBe(secret);
    expect(hash).toHaveLength(64);
  });

  it('safeEqualHash compara em tempo constante: igual → true, diferente/tamanho → false', () => {
    const h = service.hashRefreshSecret('x');
    expect(service.safeEqualHash(h, h)).toBe(true);
    expect(service.safeEqualHash(h, service.hashRefreshSecret('y'))).toBe(false);
    expect(service.safeEqualHash(h, 'curto')).toBe(false);
  });
});
