import { Injectable } from '@nestjs/common';
import { uuidSchema } from '@movivo/shared';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';

import { accessLinkTokens, users, type AccessLinkPurpose } from './schema';
import { TenantDatabase } from './tenant-database.service';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Toda verificação consulta o estado autoritativo. Redis perdido ou borda contornada não reativa links. */
@Injectable()
export class AccessLinkService {
  constructor(private readonly db: TenantDatabase) {}

  async issue(
    purpose: AccessLinkPurpose,
    userId: string,
    resourceId: string,
    ttlMs: number,
    now = new Date(),
  ) {
    uuidSchema.parse(userId);
    uuidSchema.parse(resourceId);
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 365 * 24 * 60 * 60 * 1000) {
      throw new RangeError('Validade de link inválida.');
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + ttlMs);
    await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .insert(accessLinkTokens)
        .values({ userId, purpose, resourceId, tokenHash: hash(token), expiresAt })
        .onConflictDoUpdate({
          target: [accessLinkTokens.userId, accessLinkTokens.purpose, accessLinkTokens.resourceId],
          set: { tokenHash: hash(token), expiresAt, revokedAt: null, updatedAt: now },
        }),
    );
    return { token, expiresAt };
  }

  async verify(token: string, purpose: AccessLinkPurpose, now = new Date()) {
    if (!TOKEN_PATTERN.test(token)) return null;
    const [row] = await this.db.runAsSystem((tx) =>
      tx
        .select({
          userId: accessLinkTokens.userId,
          resourceId: accessLinkTokens.resourceId,
          expiresAt: accessLinkTokens.expiresAt,
        })
        .from(accessLinkTokens)
        .innerJoin(users, eq(users.id, accessLinkTokens.userId))
        .where(
          and(
            eq(accessLinkTokens.tokenHash, hash(token)),
            eq(accessLinkTokens.purpose, purpose),
            gt(accessLinkTokens.expiresAt, now),
            isNull(accessLinkTokens.revokedAt),
            isNull(users.anonymizedAt),
          ),
        )
        .limit(1),
    );
    return row ?? null;
  }

  async revoke(token: string): Promise<void> {
    if (!TOKEN_PATTERN.test(token)) return;
    await this.db.runAsSystem((tx) =>
      tx
        .update(accessLinkTokens)
        .set({ revokedAt: new Date() })
        .where(eq(accessLinkTokens.tokenHash, hash(token))),
    );
  }

  async revokeForUser(userId: string): Promise<void> {
    await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .update(accessLinkTokens)
        .set({ revokedAt: new Date() })
        .where(eq(accessLinkTokens.userId, userId)),
    );
  }
}
