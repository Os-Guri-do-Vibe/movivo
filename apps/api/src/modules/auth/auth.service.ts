/**
 * `AuthService` — login, refresh rotation e logout (US-1.4 / TASK-1.4.2 — Sato §9.1 / ADR-006).
 *
 * Invariantes de segurança que este serviço protege:
 *  - **Nunca o refresh em claro no banco**: persiste-se SHA-256 (`TokenService`). O
 *    cookie carrega `<sessionId>.<segredo>`; o lookup é por `sessionId` (PK) e o
 *    segredo é comparado em tempo constante contra o hash.
 *  - **Rotation**: todo refresh bem-sucedido invalida a linha anterior e emite um par
 *    novo na mesma `family_id`, preservando o prazo absoluto do primeiro par.
 *  - **Detecção de reuse**: reapresentar um refresh já rotacionado (revogado) invalida
 *    **toda a família** — indício de roubo (Sato §9.1). Os `jti` da família vão para a
 *    denylist para matar os access tokens ainda vivos.
 *  - **Logout**: coloca o `jti` do access na denylist Redis (TTL = janela do access) e
 *    revoga toda a família transacionalmente no banco, autoridade para access/refresh.
 *
 * Toda operação em `auth_sessions`/`staff` roda em `runAsSystem`: o login acontece antes
 * de existir contexto de sessão, e a RLS libera essas linhas via `app.current_role='SYSTEM'`
 * (contexto privilegiado e bem delimitado — ver `TenantDatabase`).
 */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { LoginInput } from '@movivo/shared';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { AppConfigService, parseDurationSeconds } from '../../core/config';
import { TenantDatabase, type TenantRole, type TenantTransaction } from '../../core/database';
import { authSessions, staff } from '../../core/database/schema';
import { AUTH_AUDIT_ACTIONS, AuthAuditService, type AccessMeta } from './auth-audit.service';
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
    private readonly trail: AuthAuditService,
  ) {
    this.logger.setContext(AuthService.name);
  }

  /** Autentica uma conta interna por e-mail + senha (Argon2id) e emite o par de tokens. */
  async login(input: LoginInput, meta: AccessMeta = {}): Promise<LoginResult> {
    const user = await this.db.runAsSystem(async (tx) => {
      const [row] = await tx
        .select({ id: staff.id, role: staff.role, passwordHash: staff.passwordHash })
        .from(staff)
        .where(eq(staff.email, input.email))
        .limit(1);
      return row;
    });

    // Verifica sempre (contra o dummy quando não há conta) para não vazar timing.
    const ok = await this.passwords.verify(user?.passwordHash ?? null, input.password);
    if (!user || !ok) {
      // Só conta existente tem `staff.id` para ser o ator da trilha (e-mail desconhecido
      // fica de fora, por design — ver `AuthAuditService`).
      if (user) await this.trail.recordFailedLogin(user.id, meta);
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const result = await this.issueSession(user.id, user.role, randomUUID(), user.passwordHash);
    await this.trail.record(AUTH_AUDIT_ACTIONS.login, user.id, meta, { role: user.role });
    this.logger.info({ event: 'auth_login', userId: user.id, role: user.role }, 'login');
    return { ...result, user: { id: user.id, role: user.role } };
  }

  /**
   * Rotaciona o refresh: valida o atual, invalida-o e emite um par novo. Reuse de um
   * refresh já revogado invalida a família inteira.
   */
  async refresh(cookieValue: string | undefined, meta: AccessMeta = {}): Promise<LoginResult> {
    const parsed = this.parseRefreshCookie(cookieValue);
    if (!parsed) throw new UnauthorizedException('Refresh token ausente ou malformado.');

    const rotation = await this.db.runAsSystem(async (tx) => {
      const [lookup] = await tx
        .select({
          familyId: authSessions.familyId,
          userId: authSessions.userId,
          refreshTokenHash: authSessions.refreshTokenHash,
        })
        .from(authSessions)
        .where(eq(authSessions.id, parsed.sessionId))
        .limit(1);
      if (
        !lookup ||
        !this.tokens.safeEqualHash(
          lookup.refreshTokenHash,
          this.tokens.hashRefreshSecret(parsed.secret),
        )
      ) {
        throw new UnauthorizedException('Refresh token inválido.');
      }
      await this.lockFamily(tx, lookup.familyId);
      // Ordem de locks igual à troca de senha: staff antes de auth_sessions.
      const [user] = await tx
        .select({ role: staff.role })
        .from(staff)
        .where(eq(staff.id, lookup.userId))
        .for('update')
        .limit(1);
      if (!user) throw new UnauthorizedException('Usuário da sessão não encontrado.');
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

      const jti = randomUUID();
      const secret = this.tokens.generateRefreshSecret();
      const refreshTokenHash = this.tokens.hashRefreshSecret(secret);
      const expiresAt = session.expiresAt;

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
      await this.trail.record(AUTH_AUDIT_ACTIONS.refreshReuse, rotation.userId, meta, {
        familyId: rotation.familyId,
        sessionsRevoked: rotation.jtis.length,
      });
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

  /** Nome e avatar da conta autenticada, para exibição em UI (ex: cabeçalho do dashboard). */
  async getProfile(userId: string): Promise<{ name: string | null; avatarPath: string | null }> {
    const [row] = await this.db.runAsSystem((tx) =>
      tx
        .select({ name: staff.name, avatarPath: staff.avatarPath })
        .from(staff)
        .where(eq(staff.id, userId))
        .limit(1),
    );
    return { name: row?.name ?? null, avatarPath: row?.avatarPath ?? null };
  }

  /** O banco é a autoridade: Redis perdido/limpo não ressuscita uma sessão. */
  async assertActiveSession(userId: string, role: TenantRole, jti: string): Promise<void> {
    if (role === 'USER') throw new UnauthorizedException('Conta interna inválida.');
    const [session] = await this.db.runAsSystem((tx) =>
      tx
        .select({ id: authSessions.id })
        .from(authSessions)
        .innerJoin(staff, eq(staff.id, authSessions.userId))
        .where(
          and(
            eq(authSessions.userId, userId),
            eq(authSessions.jti, jti),
            isNull(authSessions.revokedAt),
            gt(authSessions.expiresAt, new Date()),
            eq(staff.role, role),
          ),
        )
        .limit(1),
    );
    if (!session) throw new UnauthorizedException('Sessão inválida ou revogada.');
  }

  /** Mantém o contrato Bearer e encerra toda a família, inclusive rotação concorrente. */
  async logout(
    userId: string,
    _role: TenantRole,
    jti: string,
    meta: AccessMeta = {},
  ): Promise<void> {
    const rows = await this.db.runAsSystem(async (tx) => {
      const [session] = await tx
        .select({ familyId: authSessions.familyId })
        .from(authSessions)
        .where(and(eq(authSessions.userId, userId), eq(authSessions.jti, jti)))
        .limit(1);
      if (!session) throw new UnauthorizedException('Sessão inválida.');
      await this.lockFamily(tx, session.familyId);
      return this.revokeFamily(tx, session.familyId);
    });
    await Promise.all(rows.map((row) => this.denylist.revoke(row.jti, this.accessDenyUntil())));
    await this.trail.record(AUTH_AUDIT_ACTIONS.logout, userId, meta);
    this.logger.info({ event: 'auth_logout', userId }, 'logout');
  }

  /** Logout pelo refresh funciona mesmo quando o access expirou; nunca emite outro token. */
  async logoutRefresh(cookieValue: string | undefined, meta: AccessMeta = {}): Promise<void> {
    const parsed = this.parseRefreshCookie(cookieValue);
    if (!parsed) throw new UnauthorizedException('Refresh token ausente ou malformado.');
    const result = await this.db.runAsSystem(async (tx) => {
      const [session] = await tx
        .select()
        .from(authSessions)
        .where(eq(authSessions.id, parsed.sessionId))
        .limit(1);
      if (
        !session ||
        !this.tokens.safeEqualHash(
          session.refreshTokenHash,
          this.tokens.hashRefreshSecret(parsed.secret),
        )
      )
        throw new UnauthorizedException('Refresh token inválido.');
      await this.lockFamily(tx, session.familyId);
      return { userId: session.userId, rows: await this.revokeFamily(tx, session.familyId) };
    });
    await Promise.all(
      result.rows.map((row) => this.denylist.revoke(row.jti, this.accessDenyUntil())),
    );
    await this.trail.record(AUTH_AUDIT_ACTIONS.logout, result.userId, meta);
    this.logger.info({ event: 'auth_logout', userId: result.userId }, 'logout');
  }

  private async lockFamily(tx: TenantTransaction, familyId: string): Promise<void> {
    // Todas as gerações usam o mesmo lock transacional: logout/reuse não deixam descendentes vivos.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${familyId}, 0))`);
  }

  private revokeFamily(tx: TenantTransaction, familyId: string) {
    return tx
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(authSessions.familyId, familyId), isNull(authSessions.revokedAt)))
      .returning({ jti: authSessions.jti });
  }

  // --- helpers -------------------------------------------------------------

  /** Cria uma nova linha de sessão (na `familyId` dada) e emite access + cookie de refresh. */
  private async issueSession(
    userId: string,
    role: TenantRole,
    familyId: string,
    passwordHash: string | null,
  ): Promise<Omit<LoginResult, 'user'>> {
    const jti = randomUUID();
    const secret = this.tokens.generateRefreshSecret();
    const refreshTokenHash = this.tokens.hashRefreshSecret(secret);
    const expiresAt = new Date(Date.now() + this.config.jwt.refreshTtlSeconds * 1000);

    const sessionId = await this.db.runAsSystem(async (tx) => {
      const [current] = await tx
        .select({ passwordHash: staff.passwordHash, role: staff.role })
        .from(staff)
        .where(eq(staff.id, userId))
        .for('update')
        .limit(1);
      if (!current || current.passwordHash !== passwordHash || current.role !== role) {
        throw new UnauthorizedException('Credenciais alteradas durante o login.');
      }
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
