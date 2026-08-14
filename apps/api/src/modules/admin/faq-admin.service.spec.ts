import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { FaqService } from '../../core/agent-config/faq.service';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import type { AuditService } from './audit.service';
import { FaqAdminService } from './faq-admin.service';

const ACTOR = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'ADMIN',
  jti: 'j1',
} as const as AuthenticatedUser;

const FAQ_KEY = '33333333-3333-4333-8333-333333333333';

const VALID = {
  canonicalQuestion: 'Posso treinar em casa sem equipamento',
  answer: 'Sim. O protocolo assinado pelo profissional CREF adapta os exercicios ao que voce tem.',
  changeNote: 'primeira versao',
};

/** Linha devolvida por `list()` — o formato que o envelope serializa. */
function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    faqKey: FAQ_KEY,
    canonicalQuestion: VALID.canonicalQuestion,
    answer: VALID.answer,
    version: 1,
    status: 'PUBLISHED',
    changeNote: 'nota',
    createdAt: new Date('2026-08-13T12:00:00.000Z'),
    createdBy: 'Mariana',
    ...overrides,
  };
}

/**
 * `selects` são consumidos em ordem pelas chamadas a `tx.select`; `executes` idem para
 * `tx.execute` (locks devolvem vazio, a busca de colisão devolve o que for enfileirado).
 */
function faqWith(options: {
  selects?: unknown[][];
  executes?: unknown[][];
  inserted?: unknown[];
} = {}) {
  const { selects = [], executes = [] } = options;
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
  const execute = vi.fn();
  for (const rows of executes) execute.mockImplementationOnce(async () => rows);
  execute.mockImplementation(async () => []);
  const tx = {
    select,
    execute,
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
  const service = new FaqAdminService(
    db,
    { invalidate } as unknown as FaqService,
    audit as unknown as AuditService,
  );
  return { service, audit, inserted, invalidate, execute };
}

describe('FaqAdminService.list', () => {
  it('marca como corrente apenas a versão mais recente de cada faqKey', async () => {
    const { service } = faqWith({
      selects: [
        [
          listRow({ id: 'a', version: 3 }),
          listRow({ id: 'b', version: 2 }),
          listRow({ id: 'c', version: 1, faqKey: '66666666-6666-4666-8666-666666666666' }),
        ],
      ],
    });

    const response = await service.list();

    expect(response.data.versions.map((v) => [v.id, v.current])).toEqual([
      ['a', true],
      ['b', false],
      ['c', true],
    ]);
  });
});

describe('FaqAdminService.publish', () => {
  it('cria a v1 com faqKey novo e audita como faq.publish', async () => {
    const { service, audit, inserted, invalidate } = faqWith({ selects: [[{ max: 0 }], []] });

    await service.publish(ACTOR, VALID);

    expect(inserted[0]).toMatchObject({
      version: 1,
      status: 'PUBLISHED',
      normalizedQuestion: 'posso treinar em casa sem equipamento',
      createdBy: ACTOR.userId,
    });
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'faq.publish', entityType: 'faq_entry' }),
    );
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('nova versão do mesmo faqKey incrementa a versão e audita como faq.update', async () => {
    const { service, audit, inserted } = faqWith({ selects: [[{ max: 4 }], []] });

    await service.publish(ACTOR, { ...VALID, faqKey: FAQ_KEY });

    expect(inserted[0]).toMatchObject({ faqKey: FAQ_KEY, version: 5 });
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'faq.update' }),
    );
  });

  it('recusa corpo fora do contrato antes de tocar o banco', async () => {
    const { service, inserted } = faqWith();
    await expect(service.publish(ACTOR, { answer: 'curta' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(inserted).toHaveLength(0);
  });

  it('recusa publicação que não passa no simulador de configuração', async () => {
    const { service, inserted } = faqWith();
    await expect(
      service.publish(ACTOR, {
        ...VALID,
        answer: 'Este e o diagnostico do seu quadro e o tratamento com resultado garantido.',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(inserted).toHaveLength(0);
  });

  it('recusa segunda entrada publicada para a mesma pergunta canônica', async () => {
    const { service, inserted } = faqWith({ executes: [[], [], [{ faq_key: 'outro' }]] });

    await expect(service.publish(ACTOR, VALID)).rejects.toBeInstanceOf(BadRequestException);
    expect(inserted).toHaveLength(0);
  });
});

describe('FaqAdminService.rollback', () => {
  it('reescreve a versão alvo como uma versão NOVA, sem mutar o histórico', async () => {
    const { service, audit, inserted } = faqWith({
      selects: [[{ canonicalQuestion: VALID.canonicalQuestion, answer: VALID.answer }], [{ max: 7 }], []],
    });

    await service.rollback(ACTOR, {
      faqKey: FAQ_KEY,
      targetVersion: 2,
      changeNote: 'voltando a v2',
    });

    expect(inserted[0]).toMatchObject({ faqKey: FAQ_KEY, version: 8, status: 'PUBLISHED' });
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'faq.rollback' }),
    );
  });

  it('404 quando a versão alvo não existe', async () => {
    const { service } = faqWith({ selects: [[]] });
    await expect(
      service.rollback(ACTOR, { faqKey: FAQ_KEY, targetVersion: 9, changeNote: 'inexistente' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('FaqAdminService.retire', () => {
  it('grava uma versão RETIRED preservando pergunta e resposta correntes', async () => {
    const { service, audit, inserted } = faqWith({
      selects: [
        [{ canonicalQuestion: VALID.canonicalQuestion, answer: VALID.answer, status: 'PUBLISHED' }],
        [{ max: 2 }],
        [],
      ],
    });

    await service.retire(ACTOR, { faqKey: FAQ_KEY, changeNote: 'saiu do escopo' });

    expect(inserted[0]).toMatchObject({ version: 3, status: 'RETIRED' });
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'faq.retire' }),
    );
  });

  it('não retira duas vezes o mesmo FAQ', async () => {
    const { service } = faqWith({
      selects: [
        [{ canonicalQuestion: VALID.canonicalQuestion, answer: VALID.answer, status: 'RETIRED' }],
      ],
    });
    await expect(
      service.retire(ACTOR, { faqKey: FAQ_KEY, changeNote: 'de novo' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404 quando o FAQ não existe', async () => {
    const { service } = faqWith({ selects: [[]] });
    await expect(
      service.retire(ACTOR, { faqKey: FAQ_KEY, changeNote: 'inexistente' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

/** Guarda contra regressão de tipo: `ConflictException` não é usado neste serviço. */
describe('contrato de erro', () => {
  it('colisão de pergunta é 400 (entrada corrigível), não 409', async () => {
    const { service } = faqWith({ executes: [[], [], [{ faq_key: 'outro' }]] });
    await expect(service.publish(ACTOR, VALID)).rejects.not.toBeInstanceOf(ConflictException);
  });
});
