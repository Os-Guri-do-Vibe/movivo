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
export class WorkoutAccessService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly config: AppConfigService,
  ) {}

  async createMagicLink(userId: string, workoutSessionId?: string): Promise<string> {
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
    return `${this.config.whatsapp.publicSiteUrl}/treino/acessar#token=${token}`;
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
