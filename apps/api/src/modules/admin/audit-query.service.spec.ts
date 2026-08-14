import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { AuditQueryService } from './audit-query.service';
import type { AuditService } from './audit.service';

const ACTOR = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'ADMIN',
  jti: 'j1',
} as const as AuthenticatedUser;

const EVENT = {
  id: '44444444-4444-4444-8444-444444444444',
  actorId: ACTOR.userId,
  actorName: 'Mariana',
  subjectId: '55555555-5555-4555-8555-555555555555',
  action: 'faq.publish',
  entityType: 'faq_entry',
  entityId: '66666666-6666-4666-8666-666666666666',
  createdAt: new Date('2026-08-13T12:00:00.000Z'),
};

/**
 * Captura o `where` construído por `filters()` sem falar SQL: o mock guarda o objeto e o
 * teste só checa se um filtro foi (ou não) aplicado. O SQL em si é provado na integração.
 */
function auditWith(rows: { events?: unknown[]; total?: number } = {}) {
  const { events = [EVENT], total = events?.length ?? 1 } = rows;
  const wheres: unknown[] = [];
  const offsets: unknown[] = [];
  const limits: unknown[] = [];
  const chainFor = (result: unknown[]) => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      leftJoin: () => chain,
      where: (value: unknown) => {
        wheres.push(value);
        return chain;
      },
      orderBy: () => chain,
      limit: (value: unknown) => {
        limits.push(value);
        return chain;
      },
      offset: (value: unknown) => {
        offsets.push(value);
        return Promise.resolve(result);
      },
      then: (onfulfilled: (value: unknown[]) => unknown) =>
        Promise.resolve(result).then(onfulfilled),
    };
    return chain;
  };
  const tx = {
    select: vi
      .fn()
      .mockImplementationOnce(() => chainFor(events))
      .mockImplementationOnce(() => chainFor([{ total }])),
    selectDistinct: vi
      .fn()
      .mockImplementationOnce(() => chainFor([{ id: ACTOR.userId, name: 'Mariana' }]))
      .mockImplementationOnce(() => chainFor([{ action: 'faq.publish' }])),
  };
  const db = {
    runAsSystem: vi.fn((cb: (value: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as TenantDatabase;
  const audit = { append: vi.fn().mockResolvedValue(undefined) };
  const service = new AuditQueryService(db, audit as unknown as AuditService);
  return { service, audit, wheres, offsets, limits };
}

describe('AuditQueryService.search', () => {
  it('serializa o evento e devolve a paginação calculada', async () => {
    const { service, offsets, limits } = auditWith({ total: 45 });

    const response = await service.search(ACTOR, { page: 2, pageSize: 20 });

    expect(response.data.events[0]).toMatchObject({
      id: EVENT.id,
      actorName: 'Mariana',
      createdAt: '2026-08-13T12:00:00.000Z',
    });
    expect(response.data.pagination).toEqual({
      page: 2,
      pageSize: 20,
      total: 45,
      totalPages: 3,
    });
    expect(limits[0]).toBe(20);
    expect(offsets[0]).toBe(20);
    expect(response.data.actions).toEqual(['faq.publish']);
  });

  it('resultado vazio devolve zero páginas, não uma página vazia', async () => {
    const { service } = auditWith({ events: [], total: 0 });
    const response = await service.search(ACTOR, {});
    expect(response.data.pagination).toMatchObject({ total: 0, totalPages: 0 });
    expect(response.data.events).toEqual([]);
  });

  it('a própria consulta ao log é auditada com os filtros usados', async () => {
    const { service, audit } = auditWith();

    await service.search(ACTOR, { actorId: ACTOR.userId, action: 'faq.publish' });

    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'AUDIT_LOG_VIEWED',
        entityType: 'audit_search',
        changes: expect.objectContaining({ actorId: ACTOR.userId, action: 'faq.publish' }),
      }),
    );
  });

  it('sem filtro nenhum a busca não aplica cláusula WHERE', async () => {
    const { service, wheres } = auditWith();
    await service.search(ACTOR, {});
    expect(wheres[0]).toBeUndefined();
  });

  it.each([
    ['ator', { actorId: ACTOR.userId }],
    ['ação', { action: 'faq.publish' }],
    ['data inicial', { from: '2026-08-01' }],
    ['data final', { to: '2026-08-31' }],
  ])('aplica cláusula WHERE ao filtrar por %s', async (_label, query) => {
    const { service, wheres } = auditWith();
    await service.search(ACTOR, query);
    expect(wheres[0]).toBeDefined();
  });

  it('recusa intervalo invertido antes de consultar o banco', async () => {
    const { service, audit } = auditWith();
    await expect(
      service.search(ACTOR, { from: '2026-08-31', to: '2026-08-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('recusa query fora do contrato', async () => {
    const { service } = auditWith();
    await expect(service.search(ACTOR, { page: 0 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.search(ACTOR, { from: 'ontem' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
