import { describe, expect, it, vi } from 'vitest';

import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { DatabaseHealthService } from '../../core/database';
import type { RedisHealthService } from '../../core/redis';
import type { AuditService } from './audit.service';
import { ControlCenterService } from './control-center.service';

function query(rows: unknown[]) {
  const chain = {
    from: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    groupBy: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
    then: <TResult1 = unknown[], TResult2 = never>(
      onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise.resolve(rows).then(onfulfilled, onrejected),
  };
  return chain;
}

const ACTOR = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'SUPPORT',
  jti: 'j1',
} as const;

function serviceWithSystemResults(...results: unknown[][]) {
  const select = vi.fn();
  for (const rows of results) select.mockImplementationOnce(() => query(rows));
  const tx = { select };
  const db = {
    runAsSystem: vi.fn((callback: (value: unknown) => Promise<unknown>) => callback(tx)),
    runAsUser: vi.fn(
      (_id: string, _role: string, callback: (value: unknown) => Promise<unknown>) => callback(tx),
    ),
  } as unknown as TenantDatabase;
  const audit = { append: vi.fn().mockResolvedValue(undefined) };
  const service = new ControlCenterService(
    db,
    { ping: vi.fn().mockResolvedValue({ latencyMs: 2 }) } as unknown as DatabaseHealthService,
    { ping: vi.fn().mockResolvedValue({ latencyMs: 3 }) } as unknown as RedisHealthService,
    audit as unknown as AuditService,
  );
  return { service, db, audit };
}

describe('ControlCenterService projections', () => {
  it('suprime segmentos de marketing com menos de 10 registros', async () => {
    const { service } = serviceWithSystemResults(
      [
        {
          formStarted: 20,
          formSubmitted: 18,
          protocolActive: 15,
          subscriptionActive: 12,
        },
      ],
      [
        { value: 'GAIN_STRENGTH', total: 9 },
        { value: 'LOSE_FAT', total: 10 },
      ],
      [{ value: 'HOME', total: 8 }],
      [{ value: 'MORNING', total: 11 }],
    );

    const response = await service.marketing();

    expect(response.data.segments).toEqual([
      { dimension: 'PREFERRED_PERIOD', value: 'MORNING', count: 11 },
    ]);
    expect(response.data.suppressedSegments).toBe(3);
    expect(response.data.acquisition).toMatchObject({ value: null, status: 'UNAVAILABLE' });
    expect(JSON.stringify(response)).not.toMatch(/phone|email|parq|pain|health/i);
  });

  it('suprime também totais de funil entre 1 e 9', async () => {
    const { service } = serviceWithSystemResults(
      [
        {
          formStarted: 12,
          formSubmitted: 9,
          protocolActive: 1,
          subscriptionActive: 0,
        },
      ],
      [],
      [],
      [],
    );

    const response = await service.marketing();

    expect(response.data.funnel.formStarted).toMatchObject({ value: 12, status: 'AVAILABLE' });
    expect(response.data.funnel.formSubmitted).toMatchObject({ value: null, status: 'UNAVAILABLE' });
    expect(response.data.funnel.protocolActive).toMatchObject({ value: null, status: 'UNAVAILABLE' });
    expect(response.data.funnel.subscriptionActive).toMatchObject({ value: 0, status: 'AVAILABLE' });
  });

  it('não devolve valor de segmento fora do vocabulário fechado', async () => {
    const { service } = serviceWithSystemResults(
      [
        {
          formStarted: 20,
          formSubmitted: 20,
          protocolActive: 20,
          subscriptionActive: 20,
        },
      ],
      [{ value: 'pessoa@example.com', total: 12 }],
      [],
      [],
    );

    const response = await service.marketing();

    expect(response.data.segments).toEqual([]);
    expect(response.data.suppressedSegments).toBe(1);
    expect(JSON.stringify(response)).not.toContain('pessoa@example.com');
  });

  it('financeiro retorna apenas agregados reais e marca fontes ausentes', async () => {
    const { service } = serviceWithSystemResults(
      [{ active: 7, contractedMrr: '273.00' }],
      [{ cost: '12.34567' }],
    );

    const response = await service.finance();

    expect(response.data.activeSubscriptions.value).toBe(7);
    expect(response.data.contractedMrr.value).toBe(273);
    expect(response.data.aiCost.value).toBe(12.34567);
    expect(response.data.receivedRevenue.status).toBe('UNAVAILABLE');
    expect(JSON.stringify(response.data)).not.toMatch(/phoneNumber|email|userId/);
  });

  it('suporte expõe somente contato e status operacional', async () => {
    const customer = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Pessoa',
      email: 'pessoa@example.com',
      phoneNumber: '+5511999999999',
      status: 'ACTIVE',
      subscriptionStatus: 'ACTIVE',
    };
    const { service, db, audit } = serviceWithSystemResults([customer]);

    const response = await service.support(ACTOR);

    expect(response.data.customers).toEqual([customer]);
    expect(JSON.stringify(response.data)).not.toMatch(/parq|protocol|checkin|conversation|pain/i);
    // A2: nada de `runAsSystem` — a listagem passa pela RLS no contexto do ator.
    expect(db.runAsSystem).not.toHaveBeenCalled();
    expect(db.runAsUser).toHaveBeenCalledWith(ACTOR.userId, ACTOR.role, expect.any(Function));
    // A3: acesso em massa a PII deixa rastro com ator, evento próprio e volume.
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: ACTOR.userId,
        action: 'SUPPORT_CUSTOMER_LIST_VIEWED',
        changes: expect.objectContaining({ recordCount: 1 }),
      }),
    );
  });

  it('audita a listagem de alunos com o volume de PII devolvido', async () => {
    const { service, audit } = serviceWithSystemResults([{ id: 'a' }, { id: 'b' }]);

    await service.students({ ...ACTOR, role: 'PROFESSIONAL' });

    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: ACTOR.userId,
        action: 'STUDENTS_LIST_VIEWED',
        changes: expect.objectContaining({ recordCount: 2 }),
      }),
    );
  });

  it('não inventa latência zero quando nenhum job possui amostra', async () => {
    const { service } = serviceWithSystemResults([
      { total: 0, failed: 0, dlq: 0, averageLatency: null },
    ]);

    const response = await service.system();

    expect(response.data.aiAverageLatency).toMatchObject({
      value: null,
      status: 'UNAVAILABLE',
    });
  });
});
