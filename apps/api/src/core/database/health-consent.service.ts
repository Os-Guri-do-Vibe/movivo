import { Injectable } from '@nestjs/common';
import { CONSENT_TEXTS } from '@movivo/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { consents } from './schema';
import { TenantDatabase } from './tenant-database.service';

/** Gate transversal para qualquer novo tratamento de dado de saude do titular. */
@Injectable()
export class HealthConsentService {
  constructor(private readonly db: TenantDatabase) {}

  async hasActiveForUser(userId: string): Promise<boolean> {
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ id: consents.id })
        .from(consents)
        .where(
          and(
            eq(consents.userId, userId),
            eq(consents.consentType, 'HEALTH_DATA'),
            eq(consents.version, CONSENT_TEXTS.HEALTH_DATA.version),
            eq(consents.accepted, true),
            isNull(consents.revokedAt),
          ),
        )
        .limit(1),
    );
    return rows.length > 0;
  }

  /** Revoga todas as provas HEALTH_DATA vigentes; o historico e preservado. */
  async revokeForUser(userId: string): Promise<boolean> {
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx.execute<{ revoked: boolean }>(
        sql`SELECT public.revoke_health_data_consent(${userId}::uuid) AS revoked`,
      ),
    );
    return rows[0]?.revoked ?? false;
  }
}
