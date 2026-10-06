/**
 * `JwtStrategy` — validação do access token RS256 (US-1.4 / TASK-1.4.1 — Sato §9.1).
 *
 * Regras de segurança materializadas:
 *  - **`algorithms: ['RS256']` explícito**: recusa `alg:none` e `HS256`. Sem isto, um
 *    atacante assinaria um token `HS256` usando a chave pública como segredo HMAC — o
 *    ataque clássico de confusão de algoritmo.
 *  - **Seleção de chave por `kid`**: aceita a chave corrente (N) e a anterior (N-1),
 *    permitindo rotação sem downtime (Sato §9.3). `kid` desconhecido ⇒ recusado.
 *  - **Denylist por `jti`**: após validar assinatura/expiração, checa o Redis — um token
 *    revogado por logout/reuse é recusado mesmo dentro da janela de 15min.
 *  - **Sessão persistida obrigatória**: jti/titular/prazo/revogação e papel atual são
 *    conferidos no PostgreSQL em cada operação; cache não concede autenticação.
 */
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ControlCenterRole } from '@movivo/shared';
import { PassportStrategy } from '@nestjs/passport';
import jwt from 'jsonwebtoken';
import {
  ExtractJwt,
  Strategy,
  type SecretOrKeyProvider,
  type StrategyOptionsWithoutRequest,
} from 'passport-jwt';

import { AppConfigService, parseDurationSeconds } from '../../core/config';
import { type TenantRole } from '../../core/database';
import { TokenDenylistService } from './token-denylist.service';
import { AuthService } from './auth.service';

export interface AuthenticatedUser {
  userId: string;
  role: TenantRole;
  jti: string;
  /** Preenchido somente após validação criptográfica; usado para limitar streams. */
  expiresAt?: number;
}

interface JwtPayload {
  sub: string;
  role: TenantRole;
  jti: string;
  iat: number;
  exp: number;
}

export const JWT_STRATEGY = 'jwt';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Seleciona a chave pública pelo `kid` do header do token, para o `secretOrKeyProvider`
 * do passport-jwt. Extraído para ser testável isoladamente: `kid` ausente/desconhecido
 * ⇒ recusado (fail-closed), aceitando apenas a chave N e a N-1 registradas.
 */
export function buildSecretOrKeyProvider(keys: ReadonlyMap<string, string>): SecretOrKeyProvider {
  return (_req: unknown, rawToken: string, done: (err: unknown, key?: string) => void) => {
    try {
      const decoded = jwt.decode(rawToken, { complete: true });
      const kid = decoded?.header.kid;
      const key = kid ? keys.get(kid) : undefined;
      if (!key) {
        done(new UnauthorizedException('Chave de assinatura desconhecida.'), undefined);
        return;
      }
      done(null, key);
    } catch (error) {
      done(error as Error, undefined);
    }
  };
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, JWT_STRATEGY) {
  constructor(
    private readonly config: AppConfigService,
    @Inject(TokenDenylistService) private readonly denylist: TokenDenylistService,
    private readonly auth: AuthService,
  ) {
    const jwtConfig = config.jwt;
    const keys = new Map<string, string>([[jwtConfig.keyId, jwtConfig.publicKey]]);
    if (jwtConfig.previousPublicKey) {
      keys.set(jwtConfig.previousPublicKey.keyId, jwtConfig.previousPublicKey.key);
    }

    const options: StrategyOptionsWithoutRequest = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Fixa o algoritmo: RS256 e nada mais (recusa alg:none/HS256).
      algorithms: ['RS256'],
      // A chave é escolhida por `kid` do header (aceita N e N-1 — Sato §9.3).
      secretOrKeyProvider: buildSecretOrKeyProvider(keys),
    };
    super(options);
  }

  /** Passa só depois de assinatura+expiração válidas. Aqui aplicamos a denylist. */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const now = Math.floor(Date.now() / 1000);
    if (
      typeof payload?.sub !== 'string' ||
      !UUID_RE.test(payload.sub) ||
      typeof payload.jti !== 'string' ||
      !UUID_RE.test(payload.jti) ||
      !Object.values(ControlCenterRole).includes(payload.role) ||
      !Number.isSafeInteger(payload.iat) ||
      !Number.isSafeInteger(payload.exp) ||
      payload.iat > now ||
      payload.exp <= now ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > parseDurationSeconds(this.config.jwt.accessTtl)
    ) {
      throw new UnauthorizedException('Token de acesso malformado ou expirado.');
    }
    if (await this.denylist.isRevoked(payload.jti)) {
      throw new UnauthorizedException('Sessão revogada.');
    }

    await this.auth.assertActiveSession(payload.sub, payload.role, payload.jti);
    return { userId: payload.sub, role: payload.role, jti: payload.jti, expiresAt: payload.exp };
  }
}
