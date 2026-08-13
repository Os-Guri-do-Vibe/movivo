/**
 * Escrita financeira do Control Center (US-8.4) — lançamento e estorno de despesa, e
 * vigência de preço de modelo.
 *
 * ## Não existe edição
 * Este serviço tem `create` e `reverse`. **Não tem `update`**, e isso é a feature, não a
 * lacuna: corrigir um lançamento é gravar o estorno (mesma linha com sinal invertido) e
 * depois o lançamento certo. O banco reforça (`buildExpensesImmutabilitySql`): a role de
 * runtime não tem UPDATE nem DELETE em `expenses`.
 *
 * ## Auditoria
 * Toda escrita chama `AuditService.append` **na mesma transação** — se a auditoria falhar,
 * o lançamento não existe. É o mecanismo append-only com hash chain da Sprint 1; não há
 * trilha paralela.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  createExpenseSchema,
  createModelPricingSchema,
  reverseExpenseSchema,
} from '@movivo/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { expenses, modelPricing } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { AuditService } from './audit.service';

const TIMEZONE = 'America/Sao_Paulo' as const;
/** Teto do extrato exibido no painel. Mais que isso é caso de exportação, não de tela. */
const LEDGER_LIMIT = 200;

/** Meses somados a cada materialização, por periodicidade. */
const PERIOD_MONTHS = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 } as const;

/** `YYYY-MM-DD` em UTC — `occurred_on` é `date`, sem hora, então não há questão de fuso. */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Soma meses preservando o dia; dia 31 em mês curto cai no último dia do mês. */
function addMonths(day: string, months: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date, lastDay));
  return isoDay(target);
}

@Injectable()
export class FinanceService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  /** Extrato do livro-caixa, mais recente primeiro. Estornos aparecem como linha própria. */
  async ledger() {
    const rows = await this.db.runAsSystem((tx) =>
      tx
        .select()
        .from(expenses)
        .orderBy(desc(expenses.occurredOn), desc(expenses.createdAt))
        .limit(LEDGER_LIMIT),
    );
    return this.envelope({
      expenses: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  }

  async createExpense(actor: AuthenticatedUser, body: unknown) {
    const input = this.parse(createExpenseSchema, body);
    const row = await this.db.runAsSystem(async (tx) => {
      const [inserted] = await tx
        .insert(expenses)
        .values({
          occurredOn: input.occurredOn,
          amountCents: input.amountCents,
          currency: input.currency,
          category: input.category,
          supplier: input.supplier,
          description: input.description,
          isRecurring: input.isRecurring,
          recurrencePeriod: input.recurrencePeriod ?? null,
          receiptRef: input.receiptRef ?? null,
          createdBy: actor.userId,
        })
        .returning();
      if (!inserted) throw new BadRequestException('Não foi possível lançar a despesa.');
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action: 'finance.expense.create',
        entityType: 'expenses',
        entityId: inserted.id,
        changes: {
          occurredOn: inserted.occurredOn,
          amountCents: inserted.amountCents,
          category: inserted.category,
          supplier: inserted.supplier,
        },
      });
      return inserted;
    });
    return this.envelope({ expense: { ...row, createdAt: row.createdAt.toISOString() } });
  }

  /**
   * Estorno: linha nova de sinal contrário apontando para a original. A original
   * permanece intacta — é isso que torna o extrato conferível.
   */
  async reverseExpense(actor: AuthenticatedUser, expenseId: string, body: unknown) {
    const input = this.parse(reverseExpenseSchema, body);
    const row = await this.db.runAsSystem(async (tx) => {
      const [original] = await tx.select().from(expenses).where(eq(expenses.id, expenseId)).limit(1);
      if (!original) throw new NotFoundException('Despesa inexistente.');
      if (original.reversesExpenseId) {
        throw new ConflictException('Uma linha de estorno não pode ser estornada.');
      }
      const [existing] = await tx
        .select({ id: expenses.id })
        .from(expenses)
        .where(eq(expenses.reversesExpenseId, expenseId))
        .limit(1);
      if (existing) throw new ConflictException('Esta despesa já foi estornada.');

      const [inserted] = await tx
        .insert(expenses)
        .values({
          occurredOn: original.occurredOn,
          amountCents: -original.amountCents,
          currency: original.currency,
          category: original.category,
          supplier: original.supplier,
          description: `Estorno de "${original.description}" — ${input.reason}`,
          receiptRef: original.receiptRef,
          reversesExpenseId: original.id,
          createdBy: actor.userId,
        })
        .returning();
      if (!inserted) throw new BadRequestException('Não foi possível estornar a despesa.');
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action: 'finance.expense.reverse',
        entityType: 'expenses',
        entityId: inserted.id,
        changes: {
          reversedExpenseId: original.id,
          amountCents: inserted.amountCents,
          reason: input.reason,
        },
      });
      return inserted;
    });
    return this.envelope({ expense: { ...row, createdAt: row.createdAt.toISOString() } });
  }

  /**
   * Materializa **uma linha por período** de cada despesa recorrente até `today`.
   *
   * Idempotente por construção: o índice único `(recurring_parent_id, occurred_on)` +
   * `onConflictDoNothing` fazem rodar duas vezes no mesmo dia não duplicar nada.
   *
   * ponytail: sem agendador — hoje é acionado pelo endpoint
   * `POST /control-center/finance/expenses/materialize-recurring`. TODO(Sprint 9): job
   * repeatable diário no BullMQ (o `QueueManager` ainda não tem repeatable configurado).
   */
  async materializeRecurring(actor: AuthenticatedUser, today = isoDay(new Date())) {
    const created = await this.db.runAsSystem(async (tx) => {
      const parents = await tx
        .select()
        .from(expenses)
        .where(
          and(
            eq(expenses.isRecurring, true),
            isNull(expenses.recurringParentId),
            isNull(expenses.reversesExpenseId),
          ),
        );

      const rows = parents.flatMap((parent) => {
        const months = PERIOD_MONTHS[parent.recurrencePeriod as keyof typeof PERIOD_MONTHS];
        if (!months) return [];
        const periods: string[] = [];
        // Cada período é calculado a partir da data-âncora da linha-mãe, nunca da data
        // anterior: iterar em cadeia faria o dia 31 virar 30 permanentemente depois de
        // passar por um mês curto. A linha-mãe já É o primeiro período; as filhas
        // começam no seguinte.
        for (let step = 1; step <= 240; step += 1) {
          const day = addMonths(parent.occurredOn, months * step);
          if (day > today) break;
          periods.push(day);
        }
        return periods.map((occurredOn) => ({
          occurredOn,
          amountCents: parent.amountCents,
          currency: parent.currency,
          category: parent.category,
          supplier: parent.supplier,
          description: parent.description,
          isRecurring: false,
          recurringParentId: parent.id,
          receiptRef: parent.receiptRef,
          createdBy: parent.createdBy,
        }));
      });
      if (rows.length === 0) return [];

      const inserted = await tx
        .insert(expenses)
        .values(rows)
        .onConflictDoNothing({ target: [expenses.recurringParentId, expenses.occurredOn] })
        .returning({ id: expenses.id, occurredOn: expenses.occurredOn });
      const [first] = inserted;
      if (first) {
        await this.audit.append(tx, {
          actorId: actor.userId,
          userId: actor.userId,
          action: 'finance.expense.materialize_recurring',
          entityType: 'expenses',
          entityId: first.id,
          changes: { created: inserted.length, upTo: today },
        });
      }
      return inserted;
    });
    return this.envelope({ created: created.length });
  }

  /**
   * Nova vigência de preço: fecha o preço vigente do mesmo modelo em `validFrom` e insere
   * a linha nova. O preço antigo continua na tabela — é ele que precifica o job de mês
   * passado. Mudar o preço hoje **não** altera custo histórico.
   */
  async createModelPricing(actor: AuthenticatedUser, body: unknown) {
    const input = this.parse(createModelPricingSchema, body);
    const row = await this.db.runAsSystem(async (tx) => {
      await tx
        .update(modelPricing)
        .set({ validTo: input.validFrom })
        .where(
          and(
            eq(modelPricing.model, input.model),
            isNull(modelPricing.validTo),
            sql`${modelPricing.validFrom} < ${input.validFrom}`,
          ),
        );
      const [inserted] = await tx
        .insert(modelPricing)
        .values({
          model: input.model,
          inputPricePer1kCents: String(input.inputPricePer1kCents),
          outputPricePer1kCents: String(input.outputPricePer1kCents),
          currency: input.currency,
          validFrom: input.validFrom,
          createdBy: actor.userId,
        })
        .returning();
      if (!inserted) throw new BadRequestException('Não foi possível gravar o preço.');
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action: 'finance.model_pricing.create',
        entityType: 'model_pricing',
        entityId: inserted.id,
        changes: {
          model: inserted.model,
          inputPricePer1kCents: inserted.inputPricePer1kCents,
          outputPricePer1kCents: inserted.outputPricePer1kCents,
          currency: inserted.currency,
          validFrom: inserted.validFrom,
        },
      });
      return inserted;
    });
    return this.envelope({ pricing: { ...row, createdAt: row.createdAt.toISOString() } });
  }

  async modelPricingHistory() {
    const rows = await this.db.runAsSystem((tx) =>
      tx.select().from(modelPricing).orderBy(modelPricing.model, desc(modelPricing.validFrom)),
    );
    return this.envelope({
      pricing: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    });
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
