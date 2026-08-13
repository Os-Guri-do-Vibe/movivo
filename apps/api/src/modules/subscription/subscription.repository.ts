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
import {
  lifecycleMarkerFor,
  recordLifecycleTransition,
  type TransitionActor,
} from './subscription-lifecycle';

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
    const row = await this.db.runAsUser(values.userId, 'USER', async (tx) => {
      const [inserted] = await tx.insert(subscriptions).values(values).returning();
      if (!inserted) return null;
      // Primeira transição do titular: `from` é nulo por definição (nasce no funil).
      const marker = lifecycleMarkerFor(null, inserted.status);
      if (marker) {
        await recordLifecycleTransition(tx, {
          userId: values.userId,
          toStatus: marker,
          actor: 'SYSTEM',
        });
      }
      return inserted;
    });
    if (!row) throw new Error('subscription insert não retornou linha');
    return row;
  }

  /**
   * Único ponto de escrita de `subscriptions` no código — por isso a emissão da transição
   * de ciclo de vida (US-8.3) vive aqui e não em cada caso de uso: nenhum caminho de mudança
   * de estado pode escapar por esquecimento. Mesma transação do UPDATE: ou os dois acontecem,
   * ou nenhum, e o funil nunca fica dessincronizado do estado.
   */
  async patch(
    userId: string,
    id: string,
    values: Partial<NewSubscriptionRow>,
    transition: { actor: TransitionActor; reason?: string | null } = { actor: 'SYSTEM' },
  ): Promise<void> {
    await this.db.runAsUser(userId, 'USER', async (tx) => {
      if (!values.status) {
        await tx.update(subscriptions).set(values).where(eq(subscriptions.id, id));
        return;
      }
      const [before] = await tx
        .select({ status: subscriptions.status })
        .from(subscriptions)
        .where(eq(subscriptions.id, id));
      await tx.update(subscriptions).set(values).where(eq(subscriptions.id, id));
      const marker = lifecycleMarkerFor(before?.status ?? null, values.status);
      if (marker) {
        await recordLifecycleTransition(tx, {
          userId,
          toStatus: marker,
          actor: transition.actor,
          reason: transition.reason ?? null,
        });
      }
    });
  }
}
