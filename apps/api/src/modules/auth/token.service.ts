/**
 * `TokenService` — emissão de access token RS256 e material do refresh (US-1.4).
 *
 * Separado do `AuthService` (que orquestra login/refresh/logout) porque é a única
 * peça que toca a chave privada e a criptografia de baixo nível. Responsabilidades:
 *  - assinar o **access token** em `RS256` com `kid` no header (rotação — Sato §9.3),
 *    claims mínimos `sub`/`role`/`jti` + `iat`/`exp` (15min);
 *  - gerar o **segredo opaco do refresh** (CSPRNG) e seu hash SHA-256 — no banco só
 *    vive o hash, nunca o token (Sato §9.1);
 *  - comparar hash em **tempo constante** (defesa contra timing attack).
 *
 * A verificação do access token não mora aqui: é do `JwtStrategy` (passport-jwt), que
 * valida `algorithms: ['RS256']` explicitamente e recusa `alg:none`/`HS256`.
 */
import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';

import { AppConfigService } from '../../core/config';
import type { TenantRole } from '../../core/database';

export interface AccessTokenClaims {
  sub: string;
  role: TenantRole;
  jti: string;
}

export interface IssuedAccessToken {
  token: string;
  jti: string;
  /** Epoch (s) de expiração — usado para o TTL da denylist no logout. */
  expiresAt: number;
}

@Injectable()
export class TokenService {
  constructor(private readonly config: AppConfigService) {}

  /** Assina um access token RS256 de 15min com `kid` e claims mínimos. */
  signAccessToken(userId: string, role: TenantRole, jti: string = randomUUID()): IssuedAccessToken {
    const jwtConfig = this.config.jwt;
    const token = jwt.sign({ role }, jwtConfig.privateKey, {
      algorithm: jwtConfig.algorithm,
      subject: userId,
      jwtid: jti,
      keyid: jwtConfig.keyId,
      expiresIn: jwtConfig.accessTtl as jwt.SignOptions['expiresIn'],
    });
    // `exp` é determinístico pelo `decode` — evita reparsear o TTL string aqui.
    const decoded = jwt.decode(token) as { exp: number };
    return { token, jti, expiresAt: decoded.exp };
  }

  /** Gera o segredo opaco do refresh (256 bits) que vai no cookie httpOnly. */
  generateRefreshSecret(): string {
    return randomBytes(32).toString('hex');
  }

  /** Hash SHA-256 (hex) — é o que se persiste em `auth_sessions.refresh_token_hash`. */
  hashRefreshSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  /** Comparação em tempo constante de dois hashes hex de mesmo tamanho. */
  safeEqualHash(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
