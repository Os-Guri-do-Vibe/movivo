import { describe, expect, it, vi } from 'vitest';
import type { ProtocolStructure } from '@movivo/shared';

import type { TenantDatabase } from '../../core/database/tenant-database.service';
import {
  protocolSubstitutionRequests,
  protocols,
  protocolVersions,
} from '../../core/database/schema';
import { ExerciseCatalogProvider } from './exercise-catalog-provider.service';
import { ProtocolSubstitutionRepository } from './protocol-substitution.repository';
import { ValidationService } from './validation/validation.service';

const CATALOG = new ExerciseCatalogProvider().getAll();
const FLEXAO = CATALOG.find((ex) => ex.id === 'flexao');
if (!FLEXAO) throw new Error('fixture: exercício "flexao" ausente do catálogo');
const AGACHAMENTO_BARRA = CATALOG.find((ex) => ex.id === 'agachamento_barra');
if (!AGACHAMENTO_BARRA)
  throw new Error('fixture: exercício "agachamento_barra" ausente do catálogo');

const content: ProtocolStructure = {
  promptVersion: 'v1',
  goal: 'GAIN_MUSCLE',
  phase: 'ADAPTACAO',
  phaseDurationWeeks: 3,
  weeklyFrequency: 1,
  sessions: [
    {
      dayLabel: 'A',
      focus: 'Full',
      exercises: [
        {
          exerciseId: 'flexao_diamante',
          name: 'Flexão Diamante',
          sets: 3,
          reps: { min: 8, max: 12 },
          loadStrategy: 'BODYWEIGHT',
          restSeconds: 60,
        },
      ],
    },
  ],
};

/**
 * Fake de `tx` mínimo pro que `release()`/`createPending()` de fato usam: uma fila de
 * resultados de `SELECT ... FOR UPDATE` (consumida na ordem em que os selects acontecem) +
 * gravação dos `UPDATE`/`INSERT` emitidos, pra afirmar o que foi (ou não) escrito.
 */
function fakeTx(selectResults: unknown[][]) {
  const updates: Array<{ table: unknown; values: unknown }> = [];
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  let selectCall = 0;

  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: () => ({
            limit: async () => selectResults[selectCall++] ?? [],
          }),
          limit: async () => selectResults[selectCall++] ?? [],
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: async () => {
          updates.push({ table, values });
          return [];
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        return { returning: async () => [{ id: 'sub-request-1' }] };
      },
    }),
  };
  return { tx, updates, inserts };
}

function repositoryWith(selectResults: unknown[][]) {
  const { tx, updates, inserts } = fakeTx(selectResults);
  const runAsUser = vi.fn((_userId: string, _role: string, cb: (tx: unknown) => Promise<unknown>) =>
    cb(tx),
  );
  const db = { runAsUser } as unknown as TenantDatabase;
  return {
    repository: new ProtocolSubstitutionRepository(db, new ValidationService()),
    updates,
    inserts,
    runAsUser,
  };
}

const PENDING_REQUEST = {
  id: 'sub-request-1',
  protocolId: 'protocol-1',
  userId: 'user-1',
  status: 'PENDING',
  baseVersion: 3,
  proposedContent: content,
  diff: { type: 'EXERCISE_SUBSTITUTION', from: {}, to: {}, sessionsAffected: ['A'] },
  changeReason: 'teste',
};

const ACTIVE_PROTOCOL_ROW = {
  id: 'protocol-1',
  version: 3,
  status: 'ACTIVE',
  mesocycleName: 'Mesociclo 1',
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-02-01'),
  totalWeeks: 4,
};

describe('ProtocolSubstitutionRepository.release', () => {
  it('aplica a troca quando a proposta está PENDING e o protocolo continua ACTIVE na mesma versão', async () => {
    const { repository, updates, inserts } = repositoryWith([
      [PENDING_REQUEST],
      [ACTIVE_PROTOCOL_ROW],
    ]);
    const result = await repository.release({ userId: 'user-1', role: 'USER' }, 'sub-request-1');

    expect(result).toMatchObject({ released: true, version: 4, protocolId: 'protocol-1' });
    const protocolUpdate = updates.find((u) => u.table === protocols);
    expect(protocolUpdate?.values).toMatchObject({ version: 4, content });
    const versionInsert = inserts.find((i) => i.table === protocolVersions);
    expect(versionInsert?.values).toMatchObject({
      protocolId: 'protocol-1',
      userId: 'user-1', // do titular da PROPOSTA, não do ator que libera
      version: 4,
      generatedBy: 'AI_SUBSTITUTION',
    });
    const requestUpdate = updates.find((u) => u.table === protocolSubstitutionRequests);
    expect(requestUpdate?.values).toMatchObject({ status: 'RELEASED' });
  });

  it('idempotente: proposta que já não está PENDING vira no-op, sem tocar `protocols`', async () => {
    const { repository, updates } = repositoryWith([[{ ...PENDING_REQUEST, status: 'RELEASED' }]]);
    const result = await repository.release({ userId: 'user-1', role: 'USER' }, 'sub-request-1');
    expect(result).toEqual({ released: false });
    expect(updates.find((u) => u.table === protocols)).toBeUndefined();
  });

  it('protocolo mudou de versão desde que a proposta nasceu → descarta em vez de aplicar sobre estado obsoleto', async () => {
    const { repository, updates } = repositoryWith([
      [PENDING_REQUEST],
      [{ ...ACTIVE_PROTOCOL_ROW, version: 5 }], // um profissional editou/assinou nesse meio-tempo
    ]);
    const result = await repository.release({ userId: 'user-1', role: 'USER' }, 'sub-request-1');
    expect(result).toEqual({ released: false });
    const requestUpdate = updates.find((u) => u.table === protocolSubstitutionRequests);
    expect(requestUpdate?.values).toMatchObject({ status: 'DISCARDED' });
    expect(updates.find((u) => u.table === protocols)).toBeUndefined();
  });

  it('protocolo não está mais ACTIVE → descarta em vez de aplicar', async () => {
    const { repository, updates } = repositoryWith([
      [PENDING_REQUEST],
      [{ ...ACTIVE_PROTOCOL_ROW, status: 'PENDING_SIGNATURE' }],
    ]);
    const result = await repository.release({ userId: 'user-1', role: 'USER' }, 'sub-request-1');
    expect(result).toEqual({ released: false });
    expect(updates.find((u) => u.table === protocols)).toBeUndefined();
  });

  it('staff (profissional/admin) libera com a própria identidade, não a do titular', async () => {
    const { repository, runAsUser } = repositoryWith([[PENDING_REQUEST], [ACTIVE_PROTOCOL_ROW]]);
    await repository.release({ userId: 'staff-1', role: 'PROFESSIONAL' }, 'sub-request-1');
    expect(runAsUser).toHaveBeenCalledWith('staff-1', 'PROFESSIONAL', expect.any(Function));
  });
});

describe('ProtocolSubstitutionRepository.discard', () => {
  it('marca a proposta como DISCARDED com o ator que recusou', async () => {
    const { repository, updates } = repositoryWith([[PENDING_REQUEST]]);
    const result = await repository.discard({ userId: 'staff-1', role: 'ADMIN' }, 'sub-request-1');
    expect(result).toEqual({ discarded: true, protocolId: 'protocol-1', userId: 'user-1' });
    const requestUpdate = updates.find((u) => u.table === protocolSubstitutionRequests);
    expect(requestUpdate?.values).toMatchObject({ status: 'DISCARDED', decidedBy: 'staff-1' });
  });

  it('proposta que já não está PENDING → no-op', async () => {
    const { repository, updates } = repositoryWith([[{ ...PENDING_REQUEST, status: 'RELEASED' }]]);
    const result = await repository.discard({ userId: 'staff-1', role: 'ADMIN' }, 'sub-request-1');
    expect(result).toEqual({ discarded: false, protocolId: null, userId: null });
    expect(updates).toHaveLength(0);
  });
});

describe('ProtocolSubstitutionRepository.createPending', () => {
  it('corrida com uma pendência concorrente (unique violation) → alreadyPending, sem lançar', async () => {
    const runAsUser = vi.fn(() => {
      const error = new Error('duplicate key') as Error & { code: string };
      error.code = '23505';
      throw error;
    });
    const db = { runAsUser } as unknown as TenantDatabase;
    const repository = new ProtocolSubstitutionRepository(db, new ValidationService());
    const result = await repository.createPending({
      userId: 'user-1',
      protocolId: 'protocol-1',
      baseVersion: 3,
      fromExerciseId: 'a',
      fromExerciseName: 'A',
      toExerciseId: 'b',
      toExerciseName: 'B',
      proposedContent: content,
      diff: {
        type: 'EXERCISE_SUBSTITUTION',
        from: { id: 'a', name: 'A' },
        to: { id: 'b', name: 'B' },
        sessionsAffected: ['A'],
      },
      changeReason: 'teste',
    });
    expect(result).toEqual({ created: false, alreadyPending: true });
  });
});

describe('ProtocolSubstitutionRepository.createCatalogGapPending', () => {
  it('cria sem substituto real — toExerciseId null, catalogGap true, reviewUrgency MANDATORY', async () => {
    const { tx, inserts } = fakeTx([]);
    const runAsUser = vi.fn(
      (_userId: string, _role: string, cb: (tx: unknown) => Promise<unknown>) => cb(tx),
    );
    const db = { runAsUser } as unknown as TenantDatabase;
    const repository = new ProtocolSubstitutionRepository(db, new ValidationService());
    const result = await repository.createCatalogGapPending({
      userId: 'user-1',
      protocolId: 'protocol-1',
      baseVersion: 3,
      fromExerciseId: 'flexao_diamante',
      fromExerciseName: 'Flexão Diamante',
      requestedExerciseName: 'supino reto máquina',
      changeReason: 'teste',
    });
    expect(result).toEqual({ created: true, id: 'sub-request-1' });
    const insert = inserts.find((i) => i.table === protocolSubstitutionRequests);
    expect(insert?.values).toMatchObject({
      toExerciseId: null,
      toExerciseName: 'supino reto máquina',
      proposedContent: null,
      diff: null,
      reviewUrgency: 'MANDATORY',
      catalogGap: true,
    });
  });

  it('corrida com uma pendência concorrente (unique violation) → alreadyPending, sem lançar', async () => {
    const runAsUser = vi.fn(() => {
      const error = new Error('duplicate key') as Error & { code: string };
      error.code = '23505';
      throw error;
    });
    const db = { runAsUser } as unknown as TenantDatabase;
    const repository = new ProtocolSubstitutionRepository(db, new ValidationService());
    const result = await repository.createCatalogGapPending({
      userId: 'user-1',
      protocolId: 'protocol-1',
      baseVersion: 3,
      fromExerciseId: 'flexao_diamante',
      fromExerciseName: 'Flexão Diamante',
      requestedExerciseName: 'supino reto máquina',
      changeReason: 'teste',
    });
    expect(result).toEqual({ created: false, alreadyPending: true });
  });
});

describe('ProtocolSubstitutionRepository.attachCatalogExerciseAndRelease', () => {
  const CATALOG_GAP_REQUEST = {
    id: 'sub-request-1',
    protocolId: 'protocol-1',
    userId: 'user-1',
    status: 'PENDING',
    catalogGap: true,
    baseVersion: 3,
    fromExerciseId: 'flexao_diamante',
    fromExerciseName: 'Flexão Diamante',
    toExerciseId: null,
    toExerciseName: 'supino reto máquina',
    proposedContent: null,
    diff: null,
    changeReason: 'teste',
  };

  const ACTIVE_PROTOCOL_FULL_ROW = {
    id: 'protocol-1',
    version: 3,
    status: 'ACTIVE',
    content,
    constraints: { level: 'INICIANTE', location: 'HOME', equipment: [], injuryTags: [] },
    parQFlags: [],
    mesocycleName: 'Mesociclo 1',
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-02-01'),
    totalWeeks: 4,
  };

  it('recomputa a troca contra o protocolo vivo, revalida e aplica quando a validação passa', async () => {
    const { repository, updates, inserts } = repositoryWith([
      [CATALOG_GAP_REQUEST],
      [ACTIVE_PROTOCOL_FULL_ROW],
    ]);
    const result = await repository.attachCatalogExerciseAndRelease(
      { userId: 'staff-1', role: 'ADMIN' },
      'sub-request-1',
      FLEXAO,
    );
    expect(result).toMatchObject({ released: true, version: 4, protocolId: 'protocol-1' });
    const requestUpdate = updates.find(
      (u) =>
        u.table === protocolSubstitutionRequests &&
        (u.values as { toExerciseId?: string }).toExerciseId,
    );
    expect(requestUpdate?.values).toMatchObject({
      toExerciseId: FLEXAO.id,
      toExerciseName: FLEXAO.name,
    });
    const versionInsert = inserts.find((i) => i.table === protocolVersions);
    expect(versionInsert?.values).toMatchObject({ protocolId: 'protocol-1', version: 4 });
    const statusUpdate = updates.find(
      (u) => u.table === protocolSubstitutionRequests && (u.values as { status?: string }).status,
    );
    expect(statusUpdate?.values).toMatchObject({ status: 'RELEASED' });
  });

  it('exercício publicado quebra a validação do protocolo inteiro → VALIDATION_FAILED, nada é escrito', async () => {
    const { repository, updates } = repositoryWith([
      [CATALOG_GAP_REQUEST],
      [ACTIVE_PROTOCOL_FULL_ROW],
    ]);
    // `agachamento_barra` exige nível INTERMEDIARIO — o protocolo fixture é INICIANTE.
    const result = await repository.attachCatalogExerciseAndRelease(
      { userId: 'staff-1', role: 'ADMIN' },
      'sub-request-1',
      AGACHAMENTO_BARRA,
    );
    expect(result).toMatchObject({ released: false, reason: 'VALIDATION_FAILED' });
    if (!result.released && result.reason === 'VALIDATION_FAILED') {
      expect(result.violations).toContain('EXERCISE_LEVEL_TOO_HIGH');
    }
    expect(updates).toHaveLength(0);
  });

  it('protocolo mudou de versão desde que a proposta nasceu → STALE, descarta em vez de aplicar', async () => {
    const { repository, updates } = repositoryWith([
      [CATALOG_GAP_REQUEST],
      [{ ...ACTIVE_PROTOCOL_FULL_ROW, version: 5 }],
    ]);
    const result = await repository.attachCatalogExerciseAndRelease(
      { userId: 'staff-1', role: 'ADMIN' },
      'sub-request-1',
      FLEXAO,
    );
    expect(result).toEqual({ released: false, reason: 'STALE' });
    const requestUpdate = updates.find((u) => u.table === protocolSubstitutionRequests);
    expect(requestUpdate?.values).toMatchObject({ status: 'DISCARDED' });
  });

  it('proposta não é catalogGap (ou não está PENDING) → NOT_FOUND, sem tocar nada', async () => {
    const { repository, updates } = repositoryWith([
      [{ ...CATALOG_GAP_REQUEST, catalogGap: false }],
    ]);
    const result = await repository.attachCatalogExerciseAndRelease(
      { userId: 'staff-1', role: 'ADMIN' },
      'sub-request-1',
      FLEXAO,
    );
    expect(result).toEqual({ released: false, reason: 'NOT_FOUND' });
    expect(updates).toHaveLength(0);
  });
});
