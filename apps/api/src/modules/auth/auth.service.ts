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

  /** Autentica uma conta interna por e-mail + senha (Argon2id) e emite o par de tokens. */
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

    const rotation = await this.db.runAsSystem(async (tx) => {
      // O lock torna consumo+substituição uma única operação. Sem ele, dois refreshes
      // concorrentes poderiam validar a mesma linha viva e emitir dois descendentes.
      const [session] = await tx
        .select()
        .from(authSessions)
        .where(eq(authSessions.id, parsed.sessionId))
        .for('update')
        .limit(1);

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

      // REUSE: com a linha travada, invalida inclusive qualquer descendente que uma
      // rotação concorrente tenha criado antes de liberar o lock.
      if (session.revokedAt !== null) {
        const rows = await tx
          .update(authSessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(authSessions.familyId, session.familyId), isNull(authSessions.revokedAt)))
          .returning({ jti: authSessions.jti });
        return {
          kind: 'REUSE' as const,
          userId: session.userId,
          familyId: session.familyId,
          jtis: rows.map((row) => row.jti),
        };
      }

      if (session.expiresAt.getTime() <= Date.now()) {
        throw new UnauthorizedException('Refresh token expirado.');
      }

      const [user] = await tx
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1);
      if (!user) throw new UnauthorizedException('Usuário da sessão não encontrado.');

      const jti = randomUUID();
      const secret = this.tokens.generateRefreshSecret();
      const refreshTokenHash = this.tokens.hashRefreshSecret(secret);
      const expiresAt = new Date(Date.now() + this.config.jwt.refreshTtlSeconds * 1000);

      await tx
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(eq(authSessions.id, session.id));
      const [created] = await tx
        .insert(authSessions)
        .values({
          userId: session.userId,
          refreshTokenHash,
          jti,
          familyId: session.familyId,
          expiresAt,
        })
        .returning({ id: authSessions.id });
      if (!created) throw new Error('Falha ao criar a sessão de autenticação.');

      return {
        kind: 'ROTATED' as const,
        userId: session.userId,
        role: user.role,
        oldJti: session.jti,
        newJti: jti,
        refreshCookie: `${created.id}.${secret}`,
      };
    });

    const denyUntil = this.accessDenyUntil();
    if (rotation.kind === 'REUSE') {
      await Promise.all(rotation.jtis.map((jti) => this.denylist.revoke(jti, denyUntil)));
      this.logger.warn(
        {
          event: 'auth_refresh_reuse',
          userId: rotation.userId,
          familyId: rotation.familyId,
        },
        'refresh reuse — família invalidada',
      );
      throw new UnauthorizedException(
        'Refresh token reutilizado — sessão encerrada por segurança.',
      );
    }

    await this.denylist.revoke(rotation.oldJti, denyUntil);
    const access = this.tokens.signAccessToken(rotation.userId, rotation.role, rotation.newJti);
    return {
      accessToken: access.token,
      refreshCookie: rotation.refreshCookie,
      user: { id: rotation.userId, role: rotation.role },
    };
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
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        sessionId,
      ) ||
      !/^[0-9a-f]{64}$/i.test(secret)
    )
      return null;
    return { sessionId, secret };
  }
}
