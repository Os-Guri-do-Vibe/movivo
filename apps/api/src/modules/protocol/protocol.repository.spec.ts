import { createHash } from 'node:crypto';
import type { ProtocolStructure } from '@movivo/shared';
import { describe, expect, it, vi } from 'vitest';

import type {
  TenantDatabase,
  TenantTransaction,
} from '../../core/database/tenant-database.service';
import { protocols } from '../../core/database/schema';
import {
  ProtocolRepository,
  signatureHash,
  supersedePreviousActiveProtocols,
} from './protocol.repository';

const content: ProtocolStructure = {
  promptVersion: 'v1',
  goal: 'GAIN_MUSCLE',
  phase: 'ADAPTACAO',
  phaseDurationWeeks: 3,
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

const SESSION_ID = '33333333-3333-4333-8333-333333333333';

const persistInput = {
  userId: '11111111-1111-4111-8111-111111111111',
  content,
  constraints: {},
  parqFlags: [],
  approvalStatus: 'AUTO_APPROVED' as const,
  status: 'ACTIVE' as const,
  humanReviewRequired: false,
  reviewUrgency: null,
  anamnesisSessionId: SESSION_ID,
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
    // 2 chamadas a `execute`: lookup do CREF (`assignedActiveProfessional`) + cálculo do
    // próximo nº de mesociclo (`nextMesocycleNumber`, `SELECT ... FOR UPDATE`).
    expect(execute).toHaveBeenCalledTimes(2);
    expect(protocolValues).toHaveBeenCalledWith(
      expect.objectContaining({ professionalId, approvalStatus: 'AUTO_APPROVED' }),
    );
  });

  // 2026-08-24: é este vínculo que permite à assinatura CREF liberar o PAR-Q da sessão
  // certa (`release_parq_on_signature` deriva a sessão do protocolo, não do cliente).
  it('grava a sessão de anamnese que originou o protocolo', async () => {
    const { repository, protocolValues } = repositoryWithSigner(
      '22222222-2222-4222-8222-222222222222',
    );
    await repository.persist(persistInput);
    expect(protocolValues).toHaveBeenCalledWith(
      expect.objectContaining({ anamnesisSessionId: SESSION_ID }),
    );
  });

  it('aceita protocolo sem sessão vinculada (linha anterior à migração 0035)', async () => {
    const { repository, protocolValues } = repositoryWithSigner(
      '22222222-2222-4222-8222-222222222222',
    );
    await repository.persist({ ...persistInput, anamnesisSessionId: null });
    expect(protocolValues).toHaveBeenCalledWith(
      expect.objectContaining({ anamnesisSessionId: null }),
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
    // Nenhum lookup de PROFISSIONAL acontece (é isso que `professionalId: null` acima já
    // comprova) — a única chamada a `execute` é `nextMesocycleNumber`, que roda sempre,
    // independente de `signed`.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(protocolValues).toHaveBeenCalledWith(expect.objectContaining({ professionalId: null }));
  });
});

describe('ProtocolRepository.persist — numeração de mesociclo (renovação)', () => {
  /**
   * `execute` responde por ordem de chamada: 1ª = CREF (se `signed`), 2ª = `nextMesocycleNumber`
   * (achado 2026-09-10: `FOR UPDATE` não pode vir com agregação — a query deixou de ser
   * `SELECT max(...) FOR UPDATE`, uma linha por protocolo existente; o máximo agora é
   * calculado em código. `null` = nenhuma linha, mesma semântica de "titular sem protocolo").
   */
  function repositoryWithMesocycleHistory(maxMesocycle: number | null, professionalId?: string) {
    const calls: unknown[] = [];
    const execute = vi.fn(async (query: unknown) => {
      calls.push(query);
      if (professionalId !== undefined && calls.length === 1) {
        return [{ professional_id: professionalId }];
      }
      return maxMesocycle === null ? [] : [{ mesocycle_number: maxMesocycle }];
    });
    const protocolValues = vi.fn();
    const tx = {
      execute,
      insert: (table: unknown) => ({
        values: (values: unknown) => {
          if (table === protocols) {
            protocolValues(values);
            return { returning: async () => [{ id: 'protocol-n' }] };
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
    return { repository: new ProtocolRepository(db), protocolValues };
  }

  it('primeiro mesociclo do titular (sem linha nenhuma): mesocycleNumber = 1', async () => {
    const { repository, protocolValues } = repositoryWithMesocycleHistory(null, 'cref-1');
    await repository.persist(persistInput);
    expect(protocolValues).toHaveBeenCalledWith(
      expect.objectContaining({ mesocycleNumber: 1, mesocycleName: 'Mesociclo 1: Adaptação' }),
    );
  });

  it('renovação: mesocycleNumber = MAX(existente) + 1, não reaproveita `version`', async () => {
    const { repository, protocolValues } = repositoryWithMesocycleHistory(2, 'cref-1');
    await repository.persist({
      ...persistInput,
      anamnesisSessionId: null,
      renewalSessionId: 'renewal-1',
    });
    expect(protocolValues).toHaveBeenCalledWith(
      expect.objectContaining({
        mesocycleNumber: 3,
        mesocycleName: 'Mesociclo 3: Adaptação',
        version: 1,
        renewalSessionId: 'renewal-1',
      }),
    );
  });

  it('protocolo PENDING (sem assinatura) também calcula mesocycleNumber, sem lookup de CREF', async () => {
    const { repository, protocolValues } = repositoryWithMesocycleHistory(null);
    await repository.persist({
      ...persistInput,
      signed: false,
      status: 'PENDING_SIGNATURE',
      approvalStatus: 'PENDING_REVIEW',
      humanReviewRequired: true,
      reviewUrgency: 'OPTIONAL' as const,
      renewalSessionId: 'renewal-2',
    });
    expect(protocolValues).toHaveBeenCalledWith(
      expect.objectContaining({ mesocycleNumber: 1, professionalId: null }),
    );
  });
});

function repositoryForAutoRelease(
  row: {
    content: ProtocolStructure;
    version: number;
    approvalStatus: string;
    reviewUrgency: string | null;
    mesocycleName?: string;
    startDate?: Date;
    endDate?: Date;
    totalWeeks?: number;
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
    const startDate = new Date('2026-08-22T00:00:00.000Z');
    const endDate = new Date('2026-11-14T00:00:00.000Z');
    const { repository, updateSet, execute } = repositoryForAutoRelease({
      content,
      version: 1,
      approvalStatus: 'PENDING_REVIEW',
      reviewUrgency: 'OPTIONAL',
      mesocycleName: 'Mesociclo 1: Adaptação',
      startDate,
      endDate,
      totalWeeks: 12,
    });
    await expect(repository.autoRelease('u1', 'p1')).resolves.toEqual({
      released: true,
      version: 1,
      content,
      mesocycleName: 'Mesociclo 1: Adaptação',
      startDate,
      endDate,
      totalWeeks: 12,
      signatureHash: expect.any(String),
      signedAt: expect.any(Date),
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

  it('ao liberar, supersede qualquer outro protocolo ACTIVE do mesmo titular (renovação de mesociclo)', async () => {
    const { repository, updateSet } = repositoryForAutoRelease({
      content,
      version: 1,
      approvalStatus: 'PENDING_REVIEW',
      reviewUrgency: 'OPTIONAL',
    });
    await repository.autoRelease('u1', 'p2');
    // Duas chamadas de `set`: ativa `p2` e supersede o mesociclo anterior ACTIVE do titular.
    expect(updateSet).toHaveBeenCalledTimes(2);
    expect(updateSet).toHaveBeenCalledWith({ status: 'SUPERSEDED' });
  });
});

describe('supersedePreviousActiveProtocols', () => {
  it('marca SUPERSEDED só outros protocolos ACTIVE do mesmo titular, nunca o que está ativando', async () => {
    const where = vi.fn(async () => []);
    const set = vi.fn(() => ({ where }));
    const tx = { update: vi.fn(() => ({ set })) } as unknown as TenantTransaction;

    await supersedePreviousActiveProtocols(tx, 'user-1', 'protocol-new');

    expect(tx.update).toHaveBeenCalledWith(protocols);
    expect(set).toHaveBeenCalledWith({ status: 'SUPERSEDED' });
    expect(where).toHaveBeenCalledOnce();
  });
});
