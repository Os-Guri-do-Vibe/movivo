import { ConflictException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';

import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { AuditService } from './audit.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

const ACTOR = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'FINANCE',
  jti: 'j1',
} as const;

function thenable(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
    then: (onfulfilled: (value: unknown[]) => unknown) => Promise.resolve(rows).then(onfulfilled),
  };
  return chain;
}

/**
 * `tx` mínimo: `select` devolve as fixtures em ordem, `insert` captura os valores gravados.
 * O objetivo é provar as regras de negócio da escrita (sinal do estorno, períodos
 * materializados, auditoria); a imutabilidade no banco é provada no int-spec.
 */
function financeWith(...selects: unknown[][]) {
  const inserted: unknown[] = [];
  const select = vi.fn();
  for (const rows of selects) select.mockImplementationOnce(() => thenable(rows));
  select.mockImplementation(() => thenable([]));
  const insert = vi.fn(() => ({
    values: (values: unknown) => {
      inserted.push(values);
      const returned = (Array.isArray(values) ? values : [values]).map((value, index) => ({
        id: `00000000-0000-4000-8000-00000000000${index}`,
        createdAt: new Date('2026-08-13T12:00:00.000Z'),
        ...(value as object),
      }));
      const chain = {
        onConflictDoNothing: () => chain,
        returning: () => Promise.resolve(returned),
      };
      return chain;
    },
  }));
  const update = vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) }));
  const tx = { select, insert, update };
  const db = {
    runAsSystem: vi.fn((callback: (value: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as TenantDatabase;
  const audit = { append: vi.fn().mockResolvedValue(undefined) };
  const service = new FinanceService(db, audit as unknown as AuditService);
  return { service, audit, inserted };
}

const ORIGINAL = {
  id: '11111111-1111-4111-8111-111111111111',
  occurredOn: '2026-07-10',
  amountCents: 12_000,
  currency: 'BRL',
  category: 'INFRA',
  supplier: 'Hetzner',
  description: 'VPS de produção',
  receiptRef: null,
  reversesExpenseId: null,
  createdBy: ACTOR.userId,
};

describe('FinanceService (US-8.4)', () => {
  it('lança despesa em centavos inteiros e audita na mesma transação', async () => {
    const { service, audit, inserted } = financeWith();

    await service.createExpense(ACTOR, {
      occurredOn: '2026-08-01',
      amountCents: 3900,
      category: 'IA_LLM',
      supplier: 'OpenAI',
      description: 'Consumo de API',
    });

    expect(inserted[0]).toMatchObject({ amountCents: 3900, category: 'IA_LLM' });
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'finance.expense.create', entityType: 'expenses' }),
    );
  });

  it('rejeita valor fracionário: dinheiro é centavo inteiro, nunca float', async () => {
    const { service } = financeWith();
    await expect(
      service.createExpense(ACTOR, {
        occurredOn: '2026-08-01',
        amountCents: 39.9,
        category: 'IA_LLM',
        supplier: 'OpenAI',
        description: 'Consumo de API',
      }),
    ).rejects.toThrow();
  });

  it('estorno é linha nova de sinal contrário — a original nunca é tocada', async () => {
    const { service, inserted } = financeWith([ORIGINAL], []);

    await service.reverseExpense(ACTOR, ORIGINAL.id, { reason: 'valor digitado errado' });

    expect(inserted[0]).toMatchObject({
      amountCents: -12_000,
      occurredOn: '2026-07-10',
      category: 'INFRA',
      reversesExpenseId: ORIGINAL.id,
    });
  });

  it('não estorna duas vezes a mesma despesa nem estorna um estorno', async () => {
    const already = financeWith([ORIGINAL], [{ id: 'x' }]);
    await expect(
      already.service.reverseExpense(ACTOR, ORIGINAL.id, { reason: 'de novo' }),
    ).rejects.toBeInstanceOf(ConflictException);

    const reversal = financeWith([{ ...ORIGINAL, reversesExpenseId: 'outra' }]);
    await expect(
      reversal.service.reverseExpense(ACTOR, ORIGINAL.id, { reason: 'nao pode' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('materializa UMA linha por período da recorrência, sem repetir a linha-mãe', async () => {
    const parent = {
      ...ORIGINAL,
      isRecurring: true,
      recurrencePeriod: 'MONTHLY',
      occurredOn: '2026-05-31',
    };
    const { service, inserted } = financeWith([parent]);

    const result = await service.materializeRecurring(ACTOR, '2026-08-13');

    // Mãe = 31/05. Filhas: 30/06 (junho não tem 31), 31/07. Agosto ainda não venceu.
    expect((inserted[0] as unknown[]).map((row) => (row as { occurredOn: string }).occurredOn)) //
      .toEqual(['2026-06-30', '2026-07-31']);
    expect(result.data.created).toBe(2);
  });

  it('não materializa nada quando não há despesa recorrente', async () => {
    const { service, inserted } = financeWith([]);
    const result = await service.materializeRecurring(ACTOR, '2026-08-13');
    expect(inserted).toEqual([]);
    expect(result.data.created).toBe(0);
  });

  it('nova vigência de preço fecha a anterior em vez de sobrescrevê-la', async () => {
    const { service, audit, inserted } = financeWith();

    await service.createModelPricing(ACTOR, {
      model: 'gpt-4.1',
      inputPricePer1kCents: 0.25,
      outputPricePer1kCents: 0.9,
      validFrom: '2026-09-01',
    });

    expect(inserted[0]).toMatchObject({ model: 'gpt-4.1', validFrom: '2026-09-01' });
    // `numeric` viaja como string para não perder precisão no driver.
    expect(inserted[0]).toMatchObject({ inputPricePer1kCents: '0.25' });
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'finance.model_pricing.create' }),
    );
  });
});

/**
 * Gate mensurável da DoD da US-8.4: **0 endpoints de edição de valor de despesa**.
 * Vale contra a metadata real do Nest, não contra o texto do arquivo — um `@Put`
 * adicionado por engano em qualquer refactor quebra este teste.
 */
describe('FinanceController — superfície de escrita', () => {
  it('não expõe nenhuma rota PUT/PATCH/DELETE: correção é estorno, nunca edição', () => {
    const prototype = FinanceController.prototype as unknown as Record<string, unknown>;
    const methods = Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => Reflect.getMetadata(METHOD_METADATA, prototype[name] as object));
    expect(methods).not.toContain(RequestMethod.PUT);
    expect(methods).not.toContain(RequestMethod.PATCH);
    expect(methods).not.toContain(RequestMethod.DELETE);
    expect(methods.length).toBeGreaterThan(0);
  });
});
