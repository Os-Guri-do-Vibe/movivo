/**
 * Escrita de investimento em mídia do Control Center (US-8.6 / TASK-8.6.1).
 *
 * Mesmo molde de `FinanceService`: `create` e `reverse`, **sem `update`**. Corrigir um
 * lançamento é gravar o estorno e depois o lançamento certo — `ad_spend` é o numerador do
 * CAC, e um valor que muda em silêncio invalida a decisão de anúncio já tomada sobre o
 * número antigo. O banco reforça (`buildAdSpendImmutabilitySql`): a role de runtime não
 * tem UPDATE nem DELETE em `ad_spend`.
 *
 * Toda escrita chama `AuditService.append` **na mesma transação** — auditoria que falha
 * derruba o lançamento junto.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createAdSpendSchema, reverseAdSpendSchema } from '@movivo/shared';
import { desc, eq } from 'drizzle-orm';
import type { z } from 'zod';

import { adSpend } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { AuditService } from './audit.service';

const TIMEZONE = 'America/Sao_Paulo' as const;
/** Teto do extrato exibido no painel. Mais que isso é caso de exportação, não de tela. */
const LEDGER_LIMIT = 200;

@Injectable()
export class MarketingService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  /** Extrato de investimento, mais recente primeiro. Estornos aparecem como linha própria. */
  async adSpendLedger() {
    const rows = await this.db.runAsSystem((tx) =>
      tx
        .select()
        .from(adSpend)
        .orderBy(desc(adSpend.spentOn), desc(adSpend.createdAt))
        .limit(LEDGER_LIMIT),
    );
    return this.envelope({
      adSpend: rows.map((row) => ({
        id: row.id,
        channel: row.channel,
        campaign: row.campaign,
        spentOn: row.spentOn,
        amountCents: row.amountCents,
        reversesAdSpendId: row.reversesAdSpendId,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  }

  async createAdSpend(actor: AuthenticatedUser, body: unknown) {
    const input = this.parse(createAdSpendSchema, body);
    const row = await this.db.runAsSystem(async (tx) => {
      const [inserted] = await tx
        .insert(adSpend)
        .values({
          channel: input.channel,
          campaign: input.campaign,
          spentOn: input.spentOn,
          amountCents: input.amountCents,
          createdBy: actor.userId,
        })
        .returning();
      if (!inserted) throw new BadRequestException('Não foi possível lançar o investimento.');
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action: 'marketing.ad_spend.create',
        entityType: 'ad_spend',
        entityId: inserted.id,
        changes: {
          channel: inserted.channel,
          campaign: inserted.campaign,
          spentOn: inserted.spentOn,
          amountCents: inserted.amountCents,
        },
      });
      return inserted;
    });
    return this.envelope({ adSpend: { ...row, createdAt: row.createdAt.toISOString() } });
  }

  /**
   * Estorno: linha nova de sinal contrário apontando para a original, que permanece
   * intacta. É isso que torna o histórico de CAC conferível mês a mês.
   */
  async reverseAdSpend(actor: AuthenticatedUser, adSpendId: string, body: unknown) {
    const input = this.parse(reverseAdSpendSchema, body);
    const row = await this.db.runAsSystem(async (tx) => {
      const [original] = await tx.select().from(adSpend).where(eq(adSpend.id, adSpendId)).limit(1);
      if (!original) throw new NotFoundException('Lançamento inexistente.');
      if (original.reversesAdSpendId) {
        throw new ConflictException('Uma linha de estorno não pode ser estornada.');
      }
      const [existing] = await tx
        .select({ id: adSpend.id })
        .from(adSpend)
        .where(eq(adSpend.reversesAdSpendId, adSpendId))
        .limit(1);
      if (existing) throw new ConflictException('Este lançamento já foi estornado.');

      const [inserted] = await tx
        .insert(adSpend)
        .values({
          channel: original.channel,
          campaign: `Estorno de "${original.campaign}" — ${input.reason}`,
          spentOn: original.spentOn,
          amountCents: -original.amountCents,
          reversesAdSpendId: original.id,
          createdBy: actor.userId,
        })
        .returning();
      if (!inserted) throw new BadRequestException('Não foi possível estornar o investimento.');
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action: 'marketing.ad_spend.reverse',
        entityType: 'ad_spend',
        entityId: inserted.id,
        changes: {
          reversedAdSpendId: original.id,
          amountCents: inserted.amountCents,
          reason: input.reason,
        },
      });
      return inserted;
    });
    return this.envelope({ adSpend: { ...row, createdAt: row.createdAt.toISOString() } });
  }

  private parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) {
      throw new BadRequestException({ code: 'INVALID_INPUT', issues: result.error.issues });
    }
    return result.data;
  }

  private envelope<T>(data: T, dataQuality: string[] = []) {
    return {
      data,
      meta: { generatedAt: new Date().toISOString(), timezone: TIMEZONE, dataQuality },
    };
  }
}
