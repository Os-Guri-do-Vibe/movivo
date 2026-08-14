import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { L1GuardrailService } from '../../core/agent-config/l1-guardrail.service';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import type { AuditService } from './audit.service';
import { L1GuardrailAdminService } from './l1-guardrail-admin.service';

const ACTOR = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'ADMIN',
  jti: 'j1',
} as const as AuthenticatedUser;

const RULE_KEY = '33333333-3333-4333-8333-333333333333';

const VALID = {
  label: 'Encaminhamento clinico',
  scope: 'INPUT' as const,
  phrases: ['dor no joelho', 'senti uma fisgada'],
  action: 'FLAG' as const,
  changeNote: 'primeira versao',
};

function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    ruleKey: RULE_KEY,
    label: VALID.label,
    scope: VALID.scope,
    phrases: VALID.phrases,
    action: VALID.action,
    version: 1,
    status: 'PUBLISHED',
    changeNote: 'nota',
    createdAt: new Date('2026-08-13T12:00:00.000Z'),
    createdBy: 'Mariana',
    ...overrides,
  };
}

function guardrailWith(selects: unknown[][] = []) {
  const inserted: unknown[] = [];
  const chainFor = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(rows),
      then: (onfulfilled: (value: unknown[]) => unknown) =>
        Promise.resolve(rows).then(onfulfilled),
    };
    return chain;
  };
  const select = vi.fn();
  for (const rows of selects) select.mockImplementationOnce(() => chainFor(rows));
  select.mockImplementation(() => chainFor([]));
  const tx = {
    select,
    execute: vi.fn(async () => []),
    insert: () => ({
      values: (values: unknown) => {
        inserted.push(values);
        return { returning: async () => [{ id: '55555555-5555-4555-8555-555555555555' }] };
      },
    }),
  };
  const db = {
    runAsSystem: vi.fn((cb: (value: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as TenantDatabase;
  const audit = { append: vi.fn().mockResolvedValue(undefined) };
  const invalidate = vi.fn();
  const service = new L1GuardrailAdminService(
    db,
    { invalidate } as unknown as L1GuardrailService,
    audit as unknown as AuditService,
  );
  return { service, audit, inserted, invalidate };
}

describe('L1GuardrailAdminService.list', () => {
  it('marca como corrente apenas a versão mais recente de cada ruleKey', async () => {
    const { service } = guardrailWith([
      [
        listRow({ id: 'a', version: 2 }),
        listRow({ id: 'b', version: 1 }),
        listRow({ id: 'c', ruleKey: '66666666-6666-4666-8666-666666666666' }),
      ],
    ]);

    const response = await service.list();

    expect(response.data.versions.map((v) => [v.id, v.current])).toEqual([
      ['a', true],
      ['b', false],
      ['c', true],
    ]);
  });
});

describe('L1GuardrailAdminService.publish', () => {
  it('cria a v1 com ruleKey novo, invalida o cache de runtime e audita', async () => {
    const { service, audit, inserted, invalidate } = guardrailWith([[{ max: 0 }], []]);

    await service.publish(ACTOR, VALID);

    expect(inserted[0]).toMatchObject({
      version: 1,
      status: 'PUBLISHED',
      action: 'FLAG',
      createdBy: ACTOR.userId,
    });
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'ai_guardrail.publish',
        entityType: 'ai_guardrail_rule',
      }),
    );
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('nova versão do mesmo ruleKey incrementa a versão e audita como update', async () => {
    const { service, audit, inserted } = guardrailWith([[{ max: 3 }], []]);

    await service.publish(ACTOR, { ...VALID, ruleKey: RULE_KEY });

    expect(inserted[0]).toMatchObject({ ruleKey: RULE_KEY, version: 4 });
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'ai_guardrail.update' }),
    );
  });

  it.each([
    ['sem frase alguma', { ...VALID, phrases: [] }],
    ['frases duplicadas', { ...VALID, phrases: ['dor no joelho', 'Dor No Joelho'] }],
    ['ação fora do contrato fechado', { ...VALID, action: 'BLOCK' }],
    ['escopo desconhecido', { ...VALID, scope: 'SIDEWAYS' }],
  ])('recusa %s sem tocar o banco', async (_label, body) => {
    const { service, inserted } = guardrailWith();
    await expect(service.publish(ACTOR, body)).rejects.toBeInstanceOf(BadRequestException);
    expect(inserted).toHaveLength(0);
  });
});

describe('L1GuardrailAdminService.rollback', () => {
  it('reescreve a versão alvo como versão NOVA, preservando o histórico', async () => {
    const { service, audit, inserted } = guardrailWith([
      [{ label: VALID.label, scope: 'BOTH', phrases: VALID.phrases, action: 'FLAG' }],
      [{ max: 5 }],
      [],
    ]);

    await service.rollback(ACTOR, {
      ruleKey: RULE_KEY,
      targetVersion: 2,
      changeNote: 'voltando a v2',
    });

    expect(inserted[0]).toMatchObject({ ruleKey: RULE_KEY, version: 6, scope: 'BOTH' });
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'ai_guardrail.rollback' }),
    );
  });

  it('404 quando a versão alvo não existe', async () => {
    const { service } = guardrailWith([[]]);
    await expect(
      service.rollback(ACTOR, { ruleKey: RULE_KEY, targetVersion: 9, changeNote: 'nao existe' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('L1GuardrailAdminService.retire', () => {
  it('grava versão RETIRED preservando a regra corrente', async () => {
    const { service, audit, inserted } = guardrailWith([
      [
        {
          label: VALID.label,
          scope: 'INPUT',
          phrases: VALID.phrases,
          action: 'FLAG',
          status: 'PUBLISHED',
        },
      ],
      [{ max: 1 }],
      [],
    ]);

    await service.retire(ACTOR, { ruleKey: RULE_KEY, changeNote: 'nao usamos mais' });

    expect(inserted[0]).toMatchObject({ version: 2, status: 'RETIRED' });
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'ai_guardrail.retire' }),
    );
  });

  it('não retira duas vezes o mesmo guardrail', async () => {
    const { service } = guardrailWith([
      [
        {
          label: VALID.label,
          scope: 'INPUT',
          phrases: VALID.phrases,
          action: 'FLAG',
          status: 'RETIRED',
        },
      ],
    ]);
    await expect(
      service.retire(ACTOR, { ruleKey: RULE_KEY, changeNote: 'de novo' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404 quando o guardrail não existe', async () => {
    const { service } = guardrailWith([[]]);
    await expect(
      service.retire(ACTOR, { ruleKey: RULE_KEY, changeNote: 'nao existe' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
