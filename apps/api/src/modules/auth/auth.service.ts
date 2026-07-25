/**
 * `AuthService` — login, refresh rotation e logout (US-1.4 / TASK-1.4.2 — Sato §9.1 / ADR-006).
 *
 * Invariantes de segurança que este serviço protege:
 *  - **Nunca o refresh em claro no banco**: persiste-se SHA-256 (`TokenService`). O
 *    cookie carrega `<sessionId>.<segredo>`; o lookup é por `sessionId` (PK) e o
 *    segredo é comparado em tempo constante contra o hash.
 *  - **Rotation**: todo refresh bem-sucedido invalida a linha anterior e emite um par
 *    novo na mesma `family_id`.
 *  - **Detecção de reuse**: reapresentar um refresh já rotacionado (revogado) invalida
 *    **toda a família** — indício de roubo (Sato §9.1). Os `jti` da família vão para a
 *    denylist para matar os access tokens ainda vivos.
 *  - **Logout**: coloca o `jti` do access na denylist Redis (TTL = janela do access) e
 *    revoga a sessão.
 *
 * Toda operação em `auth_sessions`/`users` roda em `runAsSystem`: o login acontece antes
 * de existir contexto de titular, e a RLS libera essas linhas via `app.current_role='SYSTEM'`
 * (contexto privilegiado e bem delimitado — ver `TenantDatabase`).
 */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { LoginInput } from '@movivo/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { AppConfigService, parseDurationSeconds } from '../../core/config';
import { TenantDatabase, type TenantRole } from '../../core/database';
import { authSessions, users } from '../../core/database/schema';
import { PasswordService } from './password.service';
import { TokenDenylistService } from './token-denylist.service';
import { TokenService } from './token.service';

export interface LoginResult {
  accessToken: string;
  /** Valor opaco do cookie httpOnly de refresh: `<sessionId>.<segredo>`. */
  refreshCookie: string;
  user: { id: string; role: TenantRole };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly db: TenantDatabase,
    private readonly tokens: TokenService,
    private readonly denylist: TokenDenylistService,
    private readonly passwords: PasswordService,
    private readonly config: AppConfigService,
  ) {
    this.logger.setContext(AuthService.name);
  }

  /** Autentica um profissional/admin por e-mail + senha (Argon2id) e emite o par de tokens. */
  async login(input: LoginInput): Promise<LoginResult> {
    const user = await this.db.runAsSystem(async (tx) => {
      const [row] = await tx
        .select({ id: users.id, role: users.role, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);
      return row;
    });

    // Verifica sempre (contra o dummy quando não há conta) para não vazar timing.
    const ok = await this.passwords.verify(user?.passwordHash ?? null, input.password);
    if (!user || !ok) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const result = await this.issueSession(user.id, user.role, randomUUID());
    this.logger.info({ event: 'auth_login', userId: user.id, role: user.role }, 'login');
    return { ...result, user: { id: user.id, role: user.role } };
  }

  /**
   * Rotaciona o refresh: valida o atual, invalida-o e emite um par novo. Reuse de um
   * refresh já revogado invalida a família inteira.
   */
  async refresh(cookieValue: string | undefined): Promise<LoginResult> {
    const parsed = this.parseRefreshCookie(cookieValue);
    if (!parsed) throw new UnauthorizedException('Refresh token ausente ou malformado.');

    const session = await this.db.runAsSystem(async (tx) => {
      const [row] = await tx
        .select()
        .from(authSessions)
        .where(eq(authSessions.id, parsed.sessionId))
        .limit(1);
      return row;
    });

    // Não existe, ou o segredo não bate o hash (comparação em tempo constante).
    if (
      !session ||
      !this.tokens.safeEqualHash(
        session.refreshTokenHash,
        this.tokens.hashRefreshSecret(parsed.secret),
      )
    ) {
      throw new UnauthorizedException('Refresh token inválido.');
    }

    // REUSE: refresh já rotacionado/revogado reapresentado ⇒ roubo presumido.
    if (session.revokedAt !== null) {
      await this.invalidateFamily(session.familyId);
      this.logger.warn(
        { event: 'auth_refresh_reuse', userId: session.userId, familyId: session.familyId },
        'refresh reuse — família invalidada',
      );
      throw new UnauthorizedException(
        'Refresh token reutilizado — sessão encerrada por segurança.',
      );
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expirado.');
    }

    const [role] = await this.db.runAsSystem(async (tx) => {
      // Rotation: revoga a linha atual e denylista seu jti (mata o access ainda vivo).
      await tx
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(eq(authSessions.id, session.id));
      return tx
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1);
    });
    if (!role) throw new UnauthorizedException('Usuário da sessão não encontrado.');

    await this.denylist.revoke(session.jti, this.accessDenyUntil());
    const result = await this.issueSession(session.userId, role.role, session.familyId);
    return { ...result, user: { id: session.userId, role: role.role } };
  }

  /** Logout: denylista o `jti` do access e revoga a sessão correspondente. */
  async logout(userId: string, role: TenantRole, jti: string): Promise<void> {
    await this.denylist.revoke(jti, this.accessDenyUntil());
    await this.db.runAsUser(userId, role, async (tx) => {
      await tx
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(authSessions.jti, jti), isNull(authSessions.revokedAt)));
    });
    this.logger.info({ event: 'auth_logout', userId }, 'logout');
  }

  // --- helpers -------------------------------------------------------------

  /** Cria uma nova linha de sessão (na `familyId` dada) e emite access + cookie de refresh. */
  private async issueSession(
    userId: string,
    role: TenantRole,
    familyId: string,
  ): Promise<Omit<LoginResult, 'user'>> {
    const jti = randomUUID();
    const secret = this.tokens.generateRefreshSecret();
    const refreshTokenHash = this.tokens.hashRefreshSecret(secret);
    const expiresAt = new Date(Date.now() + this.config.jwt.refreshTtlSeconds * 1000);

    const sessionId = await this.db.runAsSystem(async (tx) => {
      const [created] = await tx
        .insert(authSessions)
        .values({ userId, refreshTokenHash, jti, familyId, expiresAt })
        .returning({ id: authSessions.id });
      if (!created) throw new Error('Falha ao criar a sessão de autenticação.');
      return created.id;
    });

    const access = this.tokens.signAccessToken(userId, role, jti);
    return { accessToken: access.token, refreshCookie: `${sessionId}.${secret}` };
  }

  /** Revoga todas as linhas vivas da família e denylista seus `jti` (reuse detectado). */
  private async invalidateFamily(familyId: string): Promise<void> {
    const jtis = await this.db.runAsSystem(async (tx) => {
      const rows = (await tx
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(authSessions.familyId, familyId), isNull(authSessions.revokedAt)))
        .returning({ jti: authSessions.jti })) as Array<{ jti: string }>;
      return rows.map((r) => r.jti);
    });
    const until = this.accessDenyUntil();
    await Promise.all(jtis.map((jti) => this.denylist.revoke(jti, until)));
  }

  /** Epoch (s) até quando um `jti` fica na denylist: cobre a janela máxima do access. */
  private accessDenyUntil(): number {
    return Math.floor(Date.now() / 1000) + parseDurationSeconds(this.config.jwt.accessTtl);
  }

  /** Extrai `{sessionId, secret}` do cookie `<uuid>.<hex>`. */
  private parseRefreshCookie(
    value: string | undefined,
  ): { sessionId: string; secret: string } | null {
    if (!value) return null;
    const dot = value.indexOf('.');
    if (dot <= 0) return null;
    const sessionId = value.slice(0, dot);
    const secret = value.slice(dot + 1);
    if (!sessionId || !secret) return null;
    return { sessionId, secret };
  }
}
