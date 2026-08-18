import { createHash } from 'node:crypto';
import type { ProtocolStructure } from '@movivo/shared';
import { describe, expect, it, vi } from 'vitest';

import type { TenantDatabase } from '../../core/database/tenant-database.service';
import { protocols } from '../../core/database/schema';
import { ProtocolRepository, signatureHash } from './protocol.repository';

const content: ProtocolStructure = {
  promptVersion: 'v1',
  goal: 'GAIN_MUSCLE',
  phase: 'ADAPTACAO',
  weeklyFrequency: 3,
  sessions: [
    {
      dayLabel: 'A',
      focus: 'Full',
      exercises: [
        {
          exerciseId: 'goblet_squat',
          name: 'Agachamento',
          sets: 3,
          reps: { min: 8, max: 12 },
          loadStrategy: 'DOUBLE_PROGRESSION',
          restSeconds: 90,
        },
      ],
    },
  ],
};

describe('signatureHash (US-2.4)', () => {
  it('é o SHA-256 hex (64 chars) do conteúdo e é determinístico', () => {
    const hash = signatureHash(content);
    expect(hash).toHaveLength(64);
    expect(hash).toBe(createHash('sha256').update(JSON.stringify(content)).digest('hex'));
    expect(signatureHash(content)).toBe(hash);
  });

  it('muda quando o conteúdo muda (detecta adulteração)', () => {
    const tampered = { ...content, weeklyFrequency: 4 };
    expect(signatureHash(tampered)).not.toBe(signatureHash(content));
  });
});

function repositoryWithSigner(professionalId: string | undefined) {
  const execute = vi.fn(async () =>
    professionalId === undefined ? [] : [{ professional_id: professionalId }],
  );
  const protocolValues = vi.fn();
  const tx = {
    execute,
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        if (table === protocols) {
          protocolValues(values);
          return { returning: async () => [{ id: 'protocol-1' }] };
        }
        return Promise.resolve([]);
      },
    }),
  } as never;
  const db = {
    runAsUser: vi.fn((_userId, _role, callback: (value: unknown) => Promise<unknown>) =>
      callback(tx),
    ),
  } as unknown as TenantDatabase;
  return { repository: new ProtocolRepository(db), execute, protocolValues };
}

const persistInput = {
  userId: '11111111-1111-4111-8111-111111111111',
  content,
  constraints: {},
  parqFlags: [],
  approvalStatus: 'AUTO_APPROVED' as const,
  status: 'ACTIVE' as const,
  humanReviewRequired: false,
  reviewUrgency: null,
  totalWeeks: 12,
  generatedBy: 'AI_WITH_RULES',
  modelVersion: 'gpt-4.1',
  promptVersion: 'v1',
  signed: true,
};

describe('ProtocolRepository assinatura automatica', () => {
  it('usa somente o CREF real retornado pelo lookup estreito do titular', async () => {
    const professionalId = '22222222-2222-4222-8222-222222222222';
    const { repository, execute, protocolValues } = repositoryWithSigner(professionalId);
    await expect(repository.persist(persistInput)).resolves.toMatchObject({
      professionalId,
      alreadyExisted: false,
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(protocolValues).toHaveBeenCalledWith(
      expect.objectContaining({ professionalId, approvalStatus: 'AUTO_APPROVED' }),
    );
  });

  it('falha fechado sem CREF ativo explicitamente atribuido', async () => {
    const { repository, protocolValues } = repositoryWithSigner(undefined);
    await expect(repository.persist(persistInput)).rejects.toThrow(
      'Nenhum profissional CREF ativo atribuido',
    );
    expect(protocolValues).not.toHaveBeenCalled();
  });

  it('nao faz lookup de profissional para protocolo pendente', async () => {
    const { repository, execute, protocolValues } = repositoryWithSigner(undefined);
    await expect(
      repository.persist({
        ...persistInput,
        signed: false,
        status: 'PENDING_SIGNATURE',
        approvalStatus: 'PENDING_REVIEW',
        humanReviewRequired: true,
        reviewUrgency: 'OPTIONAL' as const,
      }),
    ).resolves.toMatchObject({ professionalId: null });
    expect(execute).not.toHaveBeenCalled();
    expect(protocolValues).toHaveBeenCalledWith(expect.objectContaining({ professionalId: null }));
  });
});

function repositoryForAutoRelease(
  row: {
    content: ProtocolStructure;
    version: number;
    approvalStatus: string;
    reviewUrgency: string | null;
  } | null,
  professionalId = 'cref-1',
) {
  const execute = vi.fn(async () => [{ professional_id: professionalId }]);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const updateWhere = vi.fn(async () => []);
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({ for: () => ({ limit: async () => (row ? [row] : []) }) }),
      }),
    }),
    update: () => ({ set: updateSet }),
    execute,
  } as never;
  const db = {
    runAsUser: vi.fn((_userId, _role, callback: (value: unknown) => Promise<unknown>) =>
      callback(tx),
    ),
  } as unknown as TenantDatabase;
  return { repository: new ProtocolRepository(db), updateSet, updateWhere, execute };
}

describe('ProtocolRepository.autoRelease (fila do profissional — "Disponível para Revisão")', () => {
  it('libera protocolo PENDING_REVIEW/OPTIONAL: assina metodologia e ativa', async () => {
    const { repository, updateSet, execute } = repositoryForAutoRelease({
      content,
      version: 1,
      approvalStatus: 'PENDING_REVIEW',
      reviewUrgency: 'OPTIONAL',
    });
    await expect(repository.autoRelease('u1', 'p1')).resolves.toEqual({
      released: true,
      version: 1,
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ACTIVE',
        approvalStatus: 'AUTO_APPROVED',
        professionalId: 'cref-1',
        humanReviewRequired: false,
      }),
    );
  });

  it('não libera protocolo MANDATORY (nunca sai sozinho)', async () => {
    const { repository, updateSet, execute } = repositoryForAutoRelease({
      content,
      version: 1,
      approvalStatus: 'PENDING_REVIEW',
      reviewUrgency: 'MANDATORY',
    });
    await expect(repository.autoRelease('u1', 'p1')).resolves.toMatchObject({ released: false });
    expect(updateSet).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('não libera se o CREF já assinou (approvalStatus mudou) — idempotente', async () => {
    const { repository, updateSet } = repositoryForAutoRelease({
      content,
      version: 2,
      approvalStatus: 'HUMAN_APPROVED',
      reviewUrgency: 'OPTIONAL',
    });
    await expect(repository.autoRelease('u1', 'p1')).resolves.toMatchObject({ released: false });
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('protocolo inexistente → released: false, sem tocar o banco', async () => {
    const { repository, updateSet } = repositoryForAutoRelease(null);
    await expect(repository.autoRelease('u1', 'p1')).resolves.toEqual({
      released: false,
      version: 0,
    });
    expect(updateSet).not.toHaveBeenCalled();
  });
});
