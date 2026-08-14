import { ConflictException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';

import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { AuditService } from './audit.service';
import { MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';

const ACTOR = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'MARKETING',
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

/** Mesmo molde do spec de `FinanceService`: prova a regra de negócio da escrita. */
function marketingWith(...selects: unknown[][]) {
  const inserted: unknown[] = [];
  const select = vi.fn();
  for (const rows of selects) select.mockImplementationOnce(() => thenable(rows));
  select.mockImplementation(() => thenable([]));
  const insert = vi.fn(() => ({
    values: (values: unknown) => {
      inserted.push(values);
      return {
        returning: () =>
          Promise.resolve([
            {
              id: '00000000-0000-4000-8000-000000000000',
              createdAt: new Date('2026-08-13T12:00:00.000Z'),
              ...(values as object),
            },
          ]),
      };
    },
  }));
  const tx = { select, insert };
  const db = {
    runAsSystem: vi.fn((callback: (value: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as TenantDatabase;
  const audit = { append: vi.fn().mockResolvedValue(undefined) };
  const service = new MarketingService(db, audit as unknown as AuditService);
  return { service, audit, inserted };
}

const ORIGINAL = {
  id: '11111111-1111-4111-8111-111111111111',
  channel: 'meta_ads',
  campaign: 'lancamento-agosto',
  spentOn: '2026-08-01',
  amountCents: 50_000,
  reversesAdSpendId: null,
  createdBy: ACTOR.userId,
};

describe('MarketingService (US-8.6)', () => {
  it('lança investimento em centavos inteiros e audita na mesma transação', async () => {
    const { service, audit, inserted } = marketingWith();

    await service.createAdSpend(ACTOR, {
      channel: 'meta_ads',
      campaign: 'lancamento-agosto',
      spentOn: '2026-08-01',
      amountCents: 50_000,
    });

    expect(inserted[0]).toMatchObject({ channel: 'meta_ads', amountCents: 50_000 });
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'marketing.ad_spend.create', entityType: 'ad_spend' }),
    );
  });

  it('rejeita valor fracionário e canal fora da taxonomia canônica', async () => {
    const { service } = marketingWith();
    const base = { campaign: 'x', spentOn: '2026-08-01' };
    await expect(
      service.createAdSpend(ACTOR, { ...base, channel: 'meta_ads', amountCents: 39.9 }),
    ).rejects.toThrow();
    await expect(
      service.createAdSpend(ACTOR, { ...base, channel: 'linkedin_ads', amountCents: 1000 }),
    ).rejects.toThrow();
  });

  it('estorno é linha nova de sinal contrário — a original nunca é tocada', async () => {
    const { service, audit, inserted } = marketingWith([ORIGINAL], []);

    await service.reverseAdSpend(ACTOR, ORIGINAL.id, { reason: 'valor digitado errado' });

    expect(inserted[0]).toMatchObject({
      channel: 'meta_ads',
      spentOn: '2026-08-01',
      amountCents: -50_000,
      reversesAdSpendId: ORIGINAL.id,
    });
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'marketing.ad_spend.reverse' }),
    );
  });

  it('não estorna duas vezes o mesmo lançamento nem estorna um estorno', async () => {
    const already = marketingWith([ORIGINAL], [{ id: 'x' }]);
    await expect(
      already.service.reverseAdSpend(ACTOR, ORIGINAL.id, { reason: 'de novo' }),
    ).rejects.toBeInstanceOf(ConflictException);

    const reversal = marketingWith([{ ...ORIGINAL, reversesAdSpendId: 'outra' }]);
    await expect(
      reversal.service.reverseAdSpend(ACTOR, ORIGINAL.id, { reason: 'nao pode' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

/** Gate da DoD: **0 endpoints de edição de valor de investimento**. */
describe('MarketingController — superfície de escrita', () => {
  it('não expõe nenhuma rota PUT/PATCH/DELETE: correção é estorno + relançamento', () => {
    const prototype = MarketingController.prototype as unknown as Record<string, unknown>;
    const methods = Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => Reflect.getMetadata(METHOD_METADATA, prototype[name] as object));
    expect(methods).not.toContain(RequestMethod.PUT);
    expect(methods).not.toContain(RequestMethod.PATCH);
    expect(methods).not.toContain(RequestMethod.DELETE);
    expect(methods.length).toBeGreaterThan(0);
  });
});
