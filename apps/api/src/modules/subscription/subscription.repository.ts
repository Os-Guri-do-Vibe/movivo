/**
 * I/O de `subscriptions` sob RLS (US-4.1). Mapeamento Drizzle sem ramo, escopado por titular
 * via `runAsUser` — mesma categoria dos outros `*.repository.ts` (fora da cobertura unitária,
 * provado pela integração contra Postgres real).
 */
import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';

import {
  subscriptions,
  type NewSubscriptionRow,
  type SubscriptionRow,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';

@Injectable()
export class SubscriptionRepository {
  constructor(private readonly db: TenantDatabase) {}

  /** Assinatura vigente do titular (a mais recente). `null` se não houver. */
  async findByUserId(userId: string): Promise<SubscriptionRow | null> {
    const [row] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId))
        .orderBy(desc(subscriptions.createdAt))
        .limit(1),
    );
    return row ?? null;
  }

  async insert(values: NewSubscriptionRow): Promise<SubscriptionRow> {
    const [row] = await this.db.runAsUser(values.userId, 'USER', (tx) =>
      tx.insert(subscriptions).values(values).returning(),
    );
    if (!row) throw new Error('subscription insert não retornou linha');
    return row;
  }

  async patch(userId: string, id: string, values: Partial<NewSubscriptionRow>): Promise<void> {
    await this.db.runAsUser(userId, 'USER', async (tx) => {
      await tx.update(subscriptions).set(values).where(eq(subscriptions.id, id));
    });
  }
}
