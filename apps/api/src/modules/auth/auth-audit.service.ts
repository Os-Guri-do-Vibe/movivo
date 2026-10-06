/**
 * `AuthAuditService` — trilha imutável dos acessos às contas internas (LGPD Art. 37/46:
 * quem entrou, quando e de onde, num sistema que abre dado de saúde de todos os titulares).
 *
 * Grava em `audit_logs` (append-only, hash encadeado), a mesma trilha das leituras de dado
 * de saúde, para que o painel de auditoria mostre o acesso e o uso lado a lado. Antes disto,
 * login/logout/troca de senha só existiam no log da aplicação (rotação curta, sem garantia).
 *
 * Convenção da trilha para eventos sem titular: `userId = actorId = entityId = staff.id`
 * (o "sentinela" já usado pelo `AuditService`, ver `audit-logs.ts`).
 *
 * Decisões:
 *  - **Best-effort**: falha ao auditar NUNCA derruba o login/logout (a trilha não pode virar
 *    um ponto único de falha da autenticação); o erro vai para o log estruturado, alto.
 *  - **Falha de login só de conta que existe** (há `staff.id` para ser o ator) e no máximo
 *    **uma por conta a cada 5 min**: sem isso um atacante martelando um e-mail conhecido
 *    encheria uma tabela append-only (e a trava global da cadeia de hash). A contagem de
 *    tentativas do período vai no evento seguinte (`attemptsSinceLast`).
 *  - IP e user-agent entram em `changes` (dado de acesso de funcionário/sócio, finalidade de
 *    segurança); o user-agent é truncado.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { TenantDatabase } from '../../core/database';
import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import { REDIS_KEY_BUILDER, RedisKeyBuilder } from '../../core/redis/redis-key.util';
import { AuditService } from '../admin/audit.service';

/** De onde veio a requisição (preenchido pelo controller; opcional em chamadas internas). */
export interface AccessMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/** IP e user-agent da requisição (`trust proxy` já resolve o IP real atrás do Nginx). */
export function accessMetaFrom(req: Request): AccessMeta {
  return { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null };
}

export const AUTH_AUDIT_ACTIONS = {
  login: 'AUTH_LOGIN',
  loginFailed: 'AUTH_LOGIN_FAILED',
  logout: 'AUTH_LOGOUT',
  refreshReuse: 'AUTH_REFRESH_REUSE_DETECTED',
  passwordChanged: 'AUTH_PASSWORD_CHANGED',
  mfaEnrolled: 'AUTH_MFA_ENROLLED',
  mfaFailed: 'AUTH_MFA_FAILED',
  mfaRecoveryUsed: 'AUTH_MFA_RECOVERY_USED',
  mfaReset: 'AUTH_MFA_RESET',
} as const;

export type AuthAuditAction = (typeof AUTH_AUDIT_ACTIONS)[keyof typeof AUTH_AUDIT_ACTIONS];

/** Janela de dedupe das falhas de login por conta. */
const FAILED_LOGIN_AUDIT_WINDOW_SECONDS = 300;
const MAX_USER_AGENT_LENGTH = 160;

@Injectable()
export class AuthAuditService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly db: TenantDatabase,
    private readonly audit: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
  ) {
    this.logger.setContext(AuthAuditService.name);
  }

  /** Registra um evento de acesso da conta `staffId`. Nunca lança. */
  async record(
    action: AuthAuditAction,
    staffId: string,
    meta: AccessMeta = {},
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await this.db.runAsSystem((tx) =>
        this.audit.append(tx, {
          actorId: staffId,
          userId: staffId,
          action,
          entityType: 'staff',
          entityId: staffId,
          changes: { ...extra, ...this.describe(meta) },
        }),
      );
    } catch (error) {
      this.logger.error(
        { event: 'auth_audit_failed', action, userId: staffId, err: error },
        'falha ao gravar a trilha de acesso',
      );
    }
  }

  /**
   * Falha de login de conta existente, no máximo 1 por conta a cada 5 min. As demais só
   * incrementam um contador, que sai junto do próximo registro.
   */
  async recordFailedLogin(staffId: string, meta: AccessMeta = {}): Promise<void> {
    await this.recordDeduped(AUTH_AUDIT_ACTIONS.loginFailed, staffId, meta, {
      reason: 'invalid_credentials',
    });
  }

  /** Código MFA errado (TOTP ou recuperação), com o mesmo dedupe por conta da falha de login. */
  async recordFailedMfa(staffId: string, meta: AccessMeta = {}): Promise<void> {
    await this.recordDeduped(AUTH_AUDIT_ACTIONS.mfaFailed, staffId, meta, {
      reason: 'invalid_code',
    });
  }

  /** Grava `action` no máx. 1x por janela/conta; `attemptsSinceLast` leva a contagem do período. */
  private async recordDeduped(
    action: AuthAuditAction,
    staffId: string,
    meta: AccessMeta,
    extra: Record<string, unknown>,
  ): Promise<void> {
    try {
      const counter = this.keys.global('auth-audit', action, staffId, 'count');
      const window = this.keys.global('auth-audit', action, staffId, 'window');
      const attempts = await this.redis.incr(counter);
      if (attempts === 1) await this.redis.expire(counter, FAILED_LOGIN_AUDIT_WINDOW_SECONDS * 4);
      const first = await this.redis.set(
        window,
        '1',
        'EX',
        FAILED_LOGIN_AUDIT_WINDOW_SECONDS,
        'NX',
      );
      if (first !== 'OK') return;
      await this.redis.del(counter);
      await this.record(action, staffId, meta, { ...extra, attemptsSinceLast: attempts });
    } catch (error) {
      // Redis fora: audita sem dedupe é pior que perder o registro (flood). Só loga.
      this.logger.error(
        { event: 'auth_audit_failed', action, err: error },
        'falha ao registrar tentativa na trilha de acesso',
      );
    }
  }

  private describe(meta: AccessMeta): Record<string, string> {
    const out: Record<string, string> = {};
    if (meta.ip) out.ip = meta.ip.slice(0, 64);
    if (meta.userAgent) out.userAgent = meta.userAgent.slice(0, MAX_USER_AGENT_LENGTH);
    return out;
  }
}
