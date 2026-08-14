/**
 * Cap table e distribuição por sócio (US-8.7).
 *
 * ## O lucro não é recalculado aqui
 * `distribution()` lê o `profit` de `ControlCenterService.finance()` — a mesma fonte que
 * o painel Financeiro exibe (regime de CAIXA desde a US-8.5). Reimplementar a apuração
 * daria dois números com o mesmo nome divergindo em silêncio, que é exatamente o que a
 * sprint proíbe. Tolerância zero contra o painel vem de ser literalmente o mesmo número.
 *
 * ## Escrita substitui a composição inteira
 * Não existe "editar a participação de um sócio": alterar uma linha isolada deixaria o
 * cap table aberto por construção. `replace()` fecha todas as vigentes e abre a nova
 * composição na mesma transação. O serviço valida a soma antes (400 legível); o trigger
 * `trg_partners_share_total` valida de novo no commit (pega também SQL manual).
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  PARTNER_DISTRIBUTION_CAVEATS,
  TOTAL_SHARE_BASIS_POINTS,
  replacePartnersSchema,
  type PartnerDistributionResponse,
} from '@movivo/shared';
import { asc, isNull } from 'drizzle-orm';

import { partners } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { AuditService } from './audit.service';
import { ControlCenterService } from './control-center.service';

const TIMEZONE = 'America/Sao_Paulo' as const;

@Injectable()
export class PartnersService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly audit: AuditService,
    private readonly controlCenter: ControlCenterService,
  ) {}

  async distribution(): Promise<PartnerDistributionResponse> {
    const [rows, finance] = await Promise.all([this.current(), this.controlCenter.finance()]);
    const { profit } = finance.data;

    // `profit.value` vem em reais; a distribuição é feita em centavos inteiros para que
    // a soma das partes seja conferível sem erro de ponto flutuante.
    const profitCents = Math.round((profit.value ?? 0) * 100);
    const profitAvailable = profit.value !== null;

    const dataQuality = profitAvailable
      ? []
      : ['Sem lucro apurado no período: a distribuição por sócio é exibida como R$ 0,00.'];

    return {
      data: {
        period: new Intl.DateTimeFormat('sv-SE', {
          timeZone: TIMEZONE,
          year: 'numeric',
          month: '2-digit',
        }).format(new Date()),
        profitCents,
        profitAvailable,
        profitDefinition: profit.definition,
        partners: rows.map((row) => ({
          id: row.id,
          name: row.name,
          shareBasisPoints: row.shareBasisPoints,
          validFrom: row.validFrom,
          validTo: row.validTo,
          notes: row.notes,
          // Truncado, nunca arredondado: arredondar cada parte pode somar mais que o
          // lucro. O resíduo de centavos fica na empresa, que é onde ele já está.
          amountCents: Math.trunc((profitCents * row.shareBasisPoints) / TOTAL_SHARE_BASIS_POINTS),
        })),
        totalBasisPoints: rows.reduce((sum, row) => sum + row.shareBasisPoints, 0),
        caveats: [...PARTNER_DISTRIBUTION_CAVEATS],
      },
      meta: { generatedAt: new Date().toISOString(), timezone: TIMEZONE, dataQuality },
    };
  }

  /** Substitui a composição vigente inteira a partir de `validFrom`. */
  async replace(actor: AuthenticatedUser, body: unknown) {
    const parsed = replacePartnersSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_INPUT', issues: parsed.error.issues });
    }
    const input = parsed.data;

    const total = input.partners.reduce((sum, partner) => sum + partner.shareBasisPoints, 0);
    if (total !== TOTAL_SHARE_BASIS_POINTS) {
      throw new BadRequestException({
        code: 'CAP_TABLE_NOT_CLOSED',
        message: `A soma das participações é ${total} pontos-base e deve ser exatamente ${TOTAL_SHARE_BASIS_POINTS} (100%).`,
      });
    }

    const rows = await this.db.runAsSystem(async (tx) => {
      await tx.update(partners).set({ validTo: input.validFrom }).where(isNull(partners.validTo));
      const inserted = await tx
        .insert(partners)
        .values(
          input.partners.map((partner) => ({
            name: partner.name,
            shareBasisPoints: partner.shareBasisPoints,
            validFrom: input.validFrom,
            notes: partner.notes ?? null,
            createdBy: actor.userId,
          })),
        )
        .returning();
      const [first] = inserted;
      if (!first) throw new BadRequestException('Não foi possível gravar a composição.');
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action: 'partners.composition.replace',
        entityType: 'partners',
        entityId: first.id,
        changes: {
          validFrom: input.validFrom,
          reason: input.reason,
          partners: inserted.map((row) => ({
            name: row.name,
            shareBasisPoints: row.shareBasisPoints,
          })),
        },
      });
      return inserted;
    });

    return {
      data: {
        partners: rows.map((row) => ({
          id: row.id,
          name: row.name,
          shareBasisPoints: row.shareBasisPoints,
          validFrom: row.validFrom,
          validTo: row.validTo,
          notes: row.notes,
        })),
      },
      meta: { generatedAt: new Date().toISOString(), timezone: TIMEZONE, dataQuality: [] },
    };
  }

  private current() {
    return this.db.runAsSystem((tx) =>
      tx.select().from(partners).where(isNull(partners.validTo)).orderBy(asc(partners.name)),
    );
  }
}
