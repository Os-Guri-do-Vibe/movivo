import { GoneException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';

import { AppConfigService } from '../../core/config';
import { users, workoutAccessTokens } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';

/** Exportado para quem encurta o link (`ShortLinkService`) casar o TTL do alias com o token. */
export const MAGIC_TTL_MS = 48 * 60 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function opaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class TrainingAccessService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly config: AppConfigService,
  ) {}

  /**
   * `options.date` faz o link abrir o diário naquele dia (registro tardio); sem ele, abre hoje.
   * Vai no fragmento, com o token: nunca chega ao servidor nem a log de acesso.
   */
  async createMagicLink(
    userId: string,
    workoutSessionId?: string,
    options: { date?: string; path?: string; next?: string } = {},
  ): Promise<string> {
    const token = opaqueToken();
    await this.db.runAsSystem((tx) =>
      tx.insert(workoutAccessTokens).values({
        userId,
        workoutSessionId,
        kind: 'MAGIC',
        tokenHash: tokenHash(token),
        expiresAt: new Date(Date.now() + MAGIC_TTL_MS),
      }),
    );
    const date = options.date ? `&date=${options.date}` : '';
    const next = options.next ? `&next=${encodeURIComponent(options.next)}` : '';
    return `${this.config.whatsapp.publicSiteUrl}${options.path ?? '/treino/acessar'}#token=${token}${date}${next}`;
  }

  /**
   * Invalida os links ainda não usados do aluno, para que o novo seja o único válido (troca de
   * exercício no mesmo dia, reenvio a pedido). O acesso de quem já abriu o link (token `SESSION`,
   * 30 dias) não muda: ele é o login do navegador, não o link.
   */
  async revokePendingMagicLinks(userId: string): Promise<number> {
    const revoked = await this.db.runAsSystem((tx) =>
      tx
        .update(workoutAccessTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(workoutAccessTokens.userId, userId),
            eq(workoutAccessTokens.kind, 'MAGIC'),
            isNull(workoutAccessTokens.consumedAt),
            isNull(workoutAccessTokens.revokedAt),
          ),
        )
        .returning({ id: workoutAccessTokens.id }),
    );
    return revoked.length;
  }

  async exchange(rawToken: string): Promise<string> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) throw new UnauthorizedException();
    const hash = tokenHash(rawToken);
    const sessionToken = opaqueToken();
    const consumed = await this.db.runAsSystem(async (tx) => {
      const [magic] = await tx
        .update(workoutAccessTokens)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(workoutAccessTokens.tokenHash, hash),
            eq(workoutAccessTokens.kind, 'MAGIC'),
            gt(workoutAccessTokens.expiresAt, new Date()),
            isNull(workoutAccessTokens.consumedAt),
            isNull(workoutAccessTokens.revokedAt),
          ),
        )
        .returning({ userId: workoutAccessTokens.userId });
      if (!magic) return false;
      await tx.insert(workoutAccessTokens).values({
        userId: magic.userId,
        kind: 'SESSION',
        tokenHash: tokenHash(sessionToken),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      });
      return true;
    });
    if (!consumed) throw new GoneException('Este link expirou ou ja foi utilizado.');
    return sessionToken;
  }

  /**
   * Le o primeiro nome do dono do link sem consumir o token (mesma validacao do
   * `exchange`, so que SELECT em vez de UPDATE). Usado so para personalizar a tela
   * de acesso antes do aluno tocar em "Abrir meu treino" - falha em silencio
   * (retorna null) para nunca bloquear o fluxo real de autenticacao.
   */
  async peekFirstName(rawToken: string): Promise<string | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return null;
    const hash = tokenHash(rawToken);
    const [row] = await this.db.runAsSystem((tx) =>
      tx
        .select({ name: users.name })
        .from(workoutAccessTokens)
        .innerJoin(users, eq(users.id, workoutAccessTokens.userId))
        .where(
          and(
            eq(workoutAccessTokens.tokenHash, hash),
            eq(workoutAccessTokens.kind, 'MAGIC'),
            gt(workoutAccessTokens.expiresAt, new Date()),
            isNull(workoutAccessTokens.consumedAt),
            isNull(workoutAccessTokens.revokedAt),
          ),
        )
        .limit(1),
    );
    return row?.name?.trim().split(/\s+/)[0] || null;
  }

  /** Dono do magic link mesmo já consumido ou expirado (só revogado não conta); serve ao reenvio. */
  async findMagicOwner(rawToken: string): Promise<{
    userId: string;
    workoutSessionId: string | null;
    name: string | null;
    timezone: string | null;
  } | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return null;
    const [row] = await this.db.runAsSystem((tx) =>
      tx
        .select({
          userId: workoutAccessTokens.userId,
          workoutSessionId: workoutAccessTokens.workoutSessionId,
          name: users.name,
          timezone: users.timezone,
        })
        .from(workoutAccessTokens)
        .innerJoin(users, eq(users.id, workoutAccessTokens.userId))
        .where(
          and(
            eq(workoutAccessTokens.tokenHash, tokenHash(rawToken)),
            eq(workoutAccessTokens.kind, 'MAGIC'),
            isNull(workoutAccessTokens.revokedAt),
          ),
        )
        .limit(1),
    );
    return row ?? null;
  }

  async requireUser(authorization: string | undefined): Promise<string> {
    const token = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) throw new UnauthorizedException();
    const [row] = await this.db.runAsSystem((tx) =>
      tx
        .select({ id: workoutAccessTokens.id, userId: workoutAccessTokens.userId })
        .from(workoutAccessTokens)
        .where(
          and(
            eq(workoutAccessTokens.tokenHash, tokenHash(token)),
            eq(workoutAccessTokens.kind, 'SESSION'),
            gt(workoutAccessTokens.expiresAt, new Date()),
            isNull(workoutAccessTokens.revokedAt),
          ),
        )
        .limit(1),
    );
    if (!row) throw new UnauthorizedException();
    await this.db.runAsSystem((tx) =>
      tx
        .update(workoutAccessTokens)
        .set({ lastUsedAt: new Date() })
        .where(eq(workoutAccessTokens.id, row.id)),
    );
    return row.userId;
  }
}
