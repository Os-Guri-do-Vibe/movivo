import { describe, expect, it, vi } from 'vitest';
import type { ProtocolStructure } from '@movivo/shared';

import type { TenantDatabase } from '../../core/database/tenant-database.service';
import {
  protocolSubstitutionRequests,
  protocols,
  protocolVersions,
} from '../../core/database/schema';
import { ExerciseCatalogProvider } from './exercise-catalog-provider.service';
import { findSafeCandidates } from './exercise-substitution';
import { applySubstitution } from './protocol-substitution-apply';
import { ProtocolSubstitutionRepository } from './protocol-substitution.repository';
import type { SubstitutionItem } from './protocol-substitution-items';
import { ValidationService } from './validation/validation.service';

const CATALOG_PROVIDER = new ExerciseCatalogProvider();
const CATALOG = CATALOG_PROVIDER.getAll();
const AGACHAMENTO_BARRA = CATALOG.find((ex) => ex.id === 'agachamento_barra');
if (!AGACHAMENTO_BARRA)
  throw new Error('fixture: exercício "agachamento_barra" ausente do catálogo');

/** Exercício de corpo livre no formato de prescrição do protocolo. */
function bodyweight(exerciseId: string, name: string) {
  return {
    exerciseId,
    name,
    sets: 3,
    reps: { min: 8, max: 12 },
    loadStrategy: 'BODYWEIGHT' as const,
    restSeconds: 60,
  };
}

// Cada sessão tem um exercício de base além do alvo: um protocolo de 1 exercício isolado
// reprova em `ISOLATION_AS_BASE` antes mesmo de qualquer troca.
const content: ProtocolStructure = {
  promptVersion: 'v1',
  goal: 'GAIN_MUSCLE',
  phase: 'ADAPTACAO',
  phaseDurationWeeks: 3,
  weeklyFrequency: 1,
  sessions: [
    {
      dayLabel: 'A',
      focus: 'Peito',
      exercises: [bodyweight('flexao', 'Flexão'), bodyweight('flexao_diamante', 'Flexão Diamante')],
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

function newRepository(db: TenantDatabase) {
  return new ProtocolSubstitutionRepository(db, new ValidationService(), CATALOG_PROVIDER);
}

function repositoryWith(selectResults: unknown[][]) {
  const { tx, updates, inserts } = fakeTx(selectResults);
  const runAsUser = vi.fn((_userId: string, _role: string, cb: (tx: unknown) => Promise<unknown>) =>
    cb(tx),
  );
  const db = { runAsUser } as unknown as TenantDatabase;
  return { repository: newRepository(db), updates, inserts, runAsUser };
}

const CONSTRAINTS = {
  level: 'INICIANTE',
  location: 'HOME',
  equipment: [],
  injuryTags: [],
} as const;

/** Duas sessões, cada uma com um alvo de troca — cobre a troca em lote. */
const batchContent: ProtocolStructure = {
  ...content,
  weeklyFrequency: 2,
  sessions: [
    ...content.sessions,
    {
      dayLabel: 'B',
      focus: 'Pernas',
      exercises: [
        bodyweight('agachamento_goblet', 'Agachamento Goblet'),
        bodyweight('afundo', 'Afundo'),
      ],
    },
  ],
};

/** Substitutos seguros que também passam na validação do protocolo inteiro (o que a oferta ao
 * aluno garante desde 2026-09-30) — um candidato que vira `ISOLATION_AS_BASE` não serve de
 * fixture de sucesso. */
function safeOptionsFor(exerciseId: string) {
  const target = CATALOG.find((ex) => ex.id === exerciseId);
  if (!target) throw new Error(`fixture: "${exerciseId}" ausente do catálogo`);
  const validation = new ValidationService();
  return findSafeCandidates(target, CONSTRAINTS, CATALOG).filter(
    (candidate) =>
      validation.validate({
        structure: applySubstitution(batchContent, exerciseId, candidate).content,
        constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], level: 'INICIANTE' },
        parqFlags: [],
      }).action === 'PASS',
  );
}
const DIAMANTE_OPTIONS = safeOptionsFor('flexao_diamante');
const AFUNDO_OPTIONS = safeOptionsFor('afundo');
if (DIAMANTE_OPTIONS.length < 2 || AFUNDO_OPTIONS.length < 1) {
  throw new Error('fixture: os exercícios de teste precisam de substitutos seguros e válidos');
}
const [firstDiamante, secondDiamante] = DIAMANTE_OPTIONS;
const [firstAfundo] = AFUNDO_OPTIONS;
if (!firstDiamante || !secondDiamante || !firstAfundo) throw new Error('fixture');
const DIAMANTE_TO = firstDiamante;
const DIAMANTE_ALT = secondDiamante;
const AFUNDO_TO = firstAfundo;

function item(over: Partial<SubstitutionItem> = {}): SubstitutionItem {
  return {
    fromExerciseId: 'flexao_diamante',
    fromExerciseName: 'Flexão Diamante',
    toExerciseId: DIAMANTE_TO.id,
    toExerciseName: DIAMANTE_TO.name,
    catalogGap: false,
    mandatory: false,
    decision: 'PENDING',
    ...over,
  };
}
const AFUNDO_ITEM = item({
  fromExerciseId: 'afundo',
  fromExerciseName: 'Afundo',
  toExerciseId: AFUNDO_TO.id,
  toExerciseName: AFUNDO_TO.name,
});

const PENDING_REQUEST = {
  id: 'sub-request-1',
  protocolId: 'protocol-1',
  userId: 'user-1',
  status: 'PENDING',
  baseVersion: 3,
  fromExerciseId: 'flexao_diamante',
  fromExerciseName: 'Flexão Diamante',
  toExerciseId: DIAMANTE_TO.id,
  toExerciseName: DIAMANTE_TO.name,
  catalogGap: false,
  reviewUrgency: 'OPTIONAL',
  items: [item()],
  proposedContent: null,
  diff: null,
  changeReason: 'teste',
};

const ACTIVE_PROTOCOL_ROW = {
  id: 'protocol-1',
  version: 3,
  status: 'ACTIVE',
  content,
  constraints: CONSTRAINTS,
  parQFlags: [],
  mesocycleName: 'Mesociclo 1',
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-02-01'),
  totalWeeks: 4,
};

const BATCH_REQUEST = { ...PENDING_REQUEST, items: [item(), AFUNDO_ITEM] };
const BATCH_PROTOCOL_ROW = { ...ACTIVE_PROTOCOL_ROW, content: batchContent };
const USER = { userId: 'user-1', role: 'USER' } as const;
const STAFF = { userId: 'staff-1', role: 'PROFESSIONAL' } as const;

describe('ProtocolSubstitutionRepository.release', () => {
  it('aplica a troca quando a proposta está PENDING e o protocolo continua ACTIVE na mesma versão', async () => {
    const { repository, updates, inserts } = repositoryWith([
      [PENDING_REQUEST],
      [ACTIVE_PROTOCOL_ROW],
    ]);
    const result = await repository.release(USER, 'sub-request-1');

    expect(result).toMatchObject({ released: true, version: 4, protocolId: 'protocol-1' });
    if (!result.released) throw new Error('esperava released');
    expect(result.changes).toEqual([{ from: 'Flexão Diamante', to: DIAMANTE_TO.name }]);
    const protocolUpdate = updates.find((u) => u.table === protocols);
    expect(protocolUpdate?.values).toMatchObject({ version: 4 });
    const applied = (protocolUpdate?.values as { content: ProtocolStructure }).content;
    expect(applied.sessions[0]?.exercises[1]?.exerciseId).toBe(DIAMANTE_TO.id);
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

  it('proposta legada (sem coluna `items`) é lida como um único item das colunas from/to', async () => {
    const { items: _items, ...legacy } = PENDING_REQUEST;
    void _items;
    const { repository, updates } = repositoryWith([
      [{ ...legacy, items: null }],
      [ACTIVE_PROTOCOL_ROW],
    ]);
    const result = await repository.release(USER, 'sub-request-1');
    expect(result).toMatchObject({ released: true });
    expect(updates.find((u) => u.table === protocols)).toBeDefined();
  });

  it('troca em lote: aplica todos os itens numa única versão do protocolo', async () => {
    const { repository, updates, inserts } = repositoryWith([
      [BATCH_REQUEST],
      [BATCH_PROTOCOL_ROW],
    ]);
    const result = await repository.release(STAFF, 'sub-request-1');

    expect(result).toMatchObject({ released: true, version: 4 });
    if (!result.released) throw new Error('esperava released');
    expect(result.changes).toHaveLength(2);
    const applied = (
      updates.find((u) => u.table === protocols)?.values as { content: ProtocolStructure }
    ).content;
    expect(applied.sessions[0]?.exercises[1]?.exerciseId).toBe(DIAMANTE_TO.id);
    expect(applied.sessions[1]?.exercises[1]?.exerciseId).toBe(AFUNDO_TO.id);
    // Uma única versão nova para o lote inteiro.
    expect(inserts.filter((i) => i.table === protocolVersions)).toHaveLength(1);
    const versionDiff = (
      inserts.find((i) => i.table === protocolVersions)?.values as {
        diff: { items: unknown[]; sessionsAffected: string[] };
      }
    ).diff;
    expect(versionDiff.items).toHaveLength(2);
    expect(versionDiff.sessionsAffected).toEqual(['A', 'B']);
    const requestUpdate = updates.find((u) => u.table === protocolSubstitutionRequests);
    expect(requestUpdate?.values).toMatchObject({ status: 'RELEASED', decidedBy: 'staff-1' });
    const finalItems = (requestUpdate?.values as { items: SubstitutionItem[] }).items;
    expect(finalItems.map((i) => i.decision)).toEqual(['APPROVED', 'APPROVED']);
  });

  it('edição do profissional: outro exercício seguro no lugar do proposto', async () => {
    const { repository, updates } = repositoryWith([[BATCH_REQUEST], [BATCH_PROTOCOL_ROW]]);
    const result = await repository.release(STAFF, 'sub-request-1', [
      { index: 0, action: 'APPROVE', toExerciseId: DIAMANTE_ALT.id },
    ]);
    expect(result).toMatchObject({ released: true });
    if (!result.released) throw new Error('esperava released');
    expect(result.changes[0]).toEqual({ from: 'Flexão Diamante', to: DIAMANTE_ALT.name });
    const applied = (
      updates.find((u) => u.table === protocols)?.values as { content: ProtocolStructure }
    ).content;
    expect(applied.sessions[0]?.exercises[1]?.exerciseId).toBe(DIAMANTE_ALT.id);
    // O outro item, sem decisão explícita, é aprovado como está.
    expect(applied.sessions[1]?.exercises[1]?.exerciseId).toBe(AFUNDO_TO.id);
    const requestUpdate = updates.find((u) => u.table === protocolSubstitutionRequests);
    const mirror = requestUpdate?.values as { toExerciseId: string; items: SubstitutionItem[] };
    // Espelho do 1º item nas colunas legadas reflete a edição.
    expect(mirror.toExerciseId).toBe(DIAMANTE_ALT.id);
    expect(mirror.items[0]?.toExerciseId).toBe(DIAMANTE_ALT.id);
  });

  it('descartar um item aplica só os demais', async () => {
    const { repository, updates } = repositoryWith([[BATCH_REQUEST], [BATCH_PROTOCOL_ROW]]);
    const result = await repository.release(STAFF, 'sub-request-1', [
      { index: 0, action: 'DISCARD' },
    ]);
    expect(result).toMatchObject({ released: true });
    if (!result.released) throw new Error('esperava released');
    expect(result.changes).toEqual([{ from: 'Afundo', to: AFUNDO_TO.name }]);
    const applied = (
      updates.find((u) => u.table === protocols)?.values as { content: ProtocolStructure }
    ).content;
    expect(applied.sessions[0]?.exercises[1]?.exerciseId).toBe('flexao_diamante'); // mantido
    expect(applied.sessions[1]?.exercises[1]?.exerciseId).toBe(AFUNDO_TO.id);
    const requestUpdate = updates.find((u) => u.table === protocolSubstitutionRequests);
    const finalItems = (requestUpdate?.values as { items: SubstitutionItem[] }).items;
    expect(finalItems.map((i) => i.decision)).toEqual(['DISCARDED', 'APPROVED']);
  });

  it('todos os itens descartados: descarta a proposta e não toca o protocolo', async () => {
    const { repository, updates } = repositoryWith([[BATCH_REQUEST]]);
    const result = await repository.release(STAFF, 'sub-request-1', [
      { index: 0, action: 'DISCARD' },
      { index: 1, action: 'DISCARD' },
    ]);
    expect(result).toEqual({
      released: false,
      reason: 'ALL_DISCARDED',
      userId: 'user-1',
      protocolId: 'protocol-1',
    });
    expect(updates.find((u) => u.table === protocols)).toBeUndefined();
    const requestUpdate = updates.find((u) => u.table === protocolSubstitutionRequests);
    expect(requestUpdate?.values).toMatchObject({ status: 'DISCARDED', decidedBy: 'staff-1' });
  });

  it('item de catálogo aprovado sem exercício definido → UNRESOLVED_ITEM, nada é escrito', async () => {
    const gapItem = item({
      toExerciseId: null,
      toExerciseName: 'Extensora Unilateral',
      catalogGap: true,
      mandatory: true,
    });
    const { repository, updates } = repositoryWith([[{ ...PENDING_REQUEST, items: [gapItem] }]]);
    const result = await repository.release(STAFF, 'sub-request-1');
    expect(result).toMatchObject({ released: false, reason: 'UNRESOLVED_ITEM' });
    expect(updates).toHaveLength(0);
  });

  it('item de catálogo pode ser descartado enquanto os demais são aprovados', async () => {
    const gapItem = item({
      toExerciseId: null,
      toExerciseName: 'Extensora Unilateral',
      catalogGap: true,
      mandatory: true,
    });
    const { repository } = repositoryWith([
      [{ ...PENDING_REQUEST, items: [gapItem, AFUNDO_ITEM] }],
      [BATCH_PROTOCOL_ROW],
    ]);
    const result = await repository.release(STAFF, 'sub-request-1', [
      { index: 0, action: 'DISCARD' },
    ]);
    expect(result).toMatchObject({ released: true });
  });

  it('edição com índice inexistente ou exercício fora do catálogo → INVALID_EDIT', async () => {
    const a = repositoryWith([[PENDING_REQUEST]]);
    expect(
      await a.repository.release(STAFF, 'sub-request-1', [{ index: 2, action: 'APPROVE' }]),
    ).toMatchObject({
      released: false,
      reason: 'INVALID_EDIT',
    });
    const b = repositoryWith([[PENDING_REQUEST]]);
    expect(
      await b.repository.release(STAFF, 'sub-request-1', [
        { index: 0, action: 'APPROVE', toExerciseId: 'nao_existe_no_catalogo' },
      ]),
    ).toMatchObject({ released: false, reason: 'INVALID_EDIT' });
    expect(a.updates).toHaveLength(0);
    expect(b.updates).toHaveLength(0);
  });

  it('o filtro de segurança vale para a escolha do profissional: exercício inelegível → INVALID_EDIT', async () => {
    // `agachamento_barra` exige nível INTERMEDIARIO — o aluno fixture é INICIANTE.
    const { repository, updates } = repositoryWith([[PENDING_REQUEST], [ACTIVE_PROTOCOL_ROW]]);
    const result = await repository.release(STAFF, 'sub-request-1', [
      { index: 0, action: 'APPROVE', toExerciseId: AGACHAMENTO_BARRA.id },
    ]);
    expect(result).toMatchObject({ released: false, reason: 'INVALID_EDIT' });
    expect(updates).toHaveLength(0);
  });

  it('item obrigatório (inelegível pedido pelo aluno) aprovado como está que quebra a validação → VALIDATION_FAILED, nada é escrito', async () => {
    const mandatoryItem = item({
      toExerciseId: AGACHAMENTO_BARRA.id,
      toExerciseName: AGACHAMENTO_BARRA.name,
      mandatory: true,
    });
    const { repository, updates } = repositoryWith([
      [{ ...PENDING_REQUEST, reviewUrgency: 'MANDATORY', items: [mandatoryItem] }],
      [ACTIVE_PROTOCOL_ROW],
    ]);
    const result = await repository.release(STAFF, 'sub-request-1');
    expect(result).toMatchObject({ released: false, reason: 'VALIDATION_FAILED' });
    if (!result.released && result.reason === 'VALIDATION_FAILED') {
      expect(result.violations).toContain('EXERCISE_LEVEL_TOO_HIGH');
    }
    expect(updates).toHaveLength(0);
  });

  it('idempotente: proposta que já não está PENDING vira no-op, sem tocar `protocols`', async () => {
    const { repository, updates } = repositoryWith([[{ ...PENDING_REQUEST, status: 'RELEASED' }]]);
    const result = await repository.release(USER, 'sub-request-1');
    expect(result).toEqual({ released: false, reason: 'NOT_PENDING' });
    expect(updates.find((u) => u.table === protocols)).toBeUndefined();
  });

  it('protocolo mudou de versão desde que a proposta nasceu → descarta em vez de aplicar sobre estado obsoleto', async () => {
    const { repository, updates } = repositoryWith([
      [PENDING_REQUEST],
      [{ ...ACTIVE_PROTOCOL_ROW, version: 5 }], // um profissional editou/assinou nesse meio-tempo
    ]);
    const result = await repository.release(USER, 'sub-request-1');
    expect(result).toEqual({ released: false, reason: 'STALE' });
    const requestUpdate = updates.find((u) => u.table === protocolSubstitutionRequests);
    expect(requestUpdate?.values).toMatchObject({ status: 'DISCARDED' });
    expect(updates.find((u) => u.table === protocols)).toBeUndefined();
  });

  it('protocolo não está mais ACTIVE → descarta em vez de aplicar', async () => {
    const { repository, updates } = repositoryWith([
      [PENDING_REQUEST],
      [{ ...ACTIVE_PROTOCOL_ROW, status: 'PENDING_SIGNATURE' }],
    ]);
    const result = await repository.release(USER, 'sub-request-1');
    expect(result).toEqual({ released: false, reason: 'STALE' });
    expect(updates.find((u) => u.table === protocols)).toBeUndefined();
  });

  it('staff (profissional/admin) libera com a própria identidade, não a do titular', async () => {
    const { repository, runAsUser } = repositoryWith([[PENDING_REQUEST], [ACTIVE_PROTOCOL_ROW]]);
    await repository.release(STAFF, 'sub-request-1');
    expect(runAsUser).toHaveBeenCalledWith('staff-1', 'PROFESSIONAL', expect.any(Function));
  });

  it('liberação automática (ator USER) não grava `decidedBy`', async () => {
    const { repository, updates } = repositoryWith([[PENDING_REQUEST], [ACTIVE_PROTOCOL_ROW]]);
    await repository.release(USER, 'sub-request-1');
    const requestUpdate = updates.find((u) => u.table === protocolSubstitutionRequests);
    expect(requestUpdate?.values).not.toHaveProperty('decidedBy');
  });
});

describe('ProtocolSubstitutionRepository.discard', () => {
  it('marca a proposta como DISCARDED com o ator que recusou e todos os itens descartados', async () => {
    const { repository, updates } = repositoryWith([[BATCH_REQUEST]]);
    const result = await repository.discard({ userId: 'staff-1', role: 'ADMIN' }, 'sub-request-1');
    expect(result).toEqual({ discarded: true, protocolId: 'protocol-1', userId: 'user-1' });
    const requestUpdate = updates.find((u) => u.table === protocolSubstitutionRequests);
    expect(requestUpdate?.values).toMatchObject({ status: 'DISCARDED', decidedBy: 'staff-1' });
    const items = (requestUpdate?.values as { items: SubstitutionItem[] }).items;
    expect(items.map((i) => i.decision)).toEqual(['DISCARDED', 'DISCARDED']);
  });

  it('proposta que já não está PENDING → no-op', async () => {
    const { repository, updates } = repositoryWith([[{ ...PENDING_REQUEST, status: 'RELEASED' }]]);
    const result = await repository.discard({ userId: 'staff-1', role: 'ADMIN' }, 'sub-request-1');
    expect(result).toEqual({ discarded: false, protocolId: null, userId: null });
    expect(updates).toHaveLength(0);
  });
});

describe('ProtocolSubstitutionRepository.createPending', () => {
  const baseInput = {
    userId: 'user-1',
    protocolId: 'protocol-1',
    baseVersion: 3,
    proposedContent: null,
    diff: null,
    changeReason: 'teste',
  };

  it('grava todos os itens no mesmo registro e espelha o 1º nas colunas legadas', async () => {
    const { repository, inserts } = repositoryWith([]);
    const result = await repository.createPending({ ...baseInput, items: [item(), AFUNDO_ITEM] });
    expect(result).toEqual({ created: true, id: 'sub-request-1' });
    const insert = inserts.find((i) => i.table === protocolSubstitutionRequests);
    expect(insert?.values).toMatchObject({
      fromExerciseId: 'flexao_diamante',
      toExerciseId: DIAMANTE_TO.id,
      reviewUrgency: 'OPTIONAL',
      catalogGap: false,
    });
    expect((insert?.values as { items: unknown[] }).items).toHaveLength(2);
  });

  it('um único item obrigatório torna a proposta inteira MANDATORY', async () => {
    const { repository, inserts } = repositoryWith([]);
    await repository.createPending({
      ...baseInput,
      items: [item(), item({ fromExerciseId: 'afundo', mandatory: true })],
    });
    const insert = inserts.find((i) => i.table === protocolSubstitutionRequests);
    expect(insert?.values).toMatchObject({ reviewUrgency: 'MANDATORY' });
  });

  it('pedido de catálogo: toExerciseId null, catalogGap true, MANDATORY', async () => {
    const { repository, inserts } = repositoryWith([]);
    await repository.createPending({
      ...baseInput,
      items: [
        item({
          toExerciseId: null,
          toExerciseName: 'supino reto máquina',
          catalogGap: true,
          mandatory: true,
        }),
      ],
    });
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

  it('PAR-Q bloqueante (reviewUrgency forçado) torna a proposta MANDATORY', async () => {
    const { repository, inserts } = repositoryWith([]);
    await repository.createPending({ ...baseInput, items: [item()], reviewUrgency: 'MANDATORY' });
    const insert = inserts.find((i) => i.table === protocolSubstitutionRequests);
    expect(insert?.values).toMatchObject({ reviewUrgency: 'MANDATORY' });
  });

  it('corrida com uma pendência concorrente (unique violation) → alreadyPending, sem lançar', async () => {
    const runAsUser = vi.fn(() => {
      const error = new Error('duplicate key') as Error & { code: string };
      error.code = '23505';
      throw error;
    });
    const repository = newRepository({ runAsUser } as unknown as TenantDatabase);
    const result = await repository.createPending({ ...baseInput, items: [item()] });
    expect(result).toEqual({ created: false, alreadyPending: true });
  });
});

describe('ProtocolSubstitutionRepository.attachCatalogExercise', () => {
  const GAP_ITEM = item({
    toExerciseId: null,
    toExerciseName: 'supino reto máquina',
    catalogGap: true,
    mandatory: true,
  });
  const GAP_REQUEST = {
    ...PENDING_REQUEST,
    catalogGap: true,
    reviewUrgency: 'MANDATORY',
    toExerciseId: null,
    toExerciseName: 'supino reto máquina',
    items: [GAP_ITEM, AFUNDO_ITEM],
  };

  it('liga o exercício publicado ao item, revalidando contra o protocolo vivo, SEM aprovar', async () => {
    const { repository, updates, inserts } = repositoryWith([[GAP_REQUEST], [BATCH_PROTOCOL_ROW]]);
    const result = await repository.attachCatalogExercise(STAFF, 'sub-request-1', 0, DIAMANTE_TO);
    expect(result).toEqual({ attached: true, userId: 'user-1' });
    const requestUpdate = updates.find((u) => u.table === protocolSubstitutionRequests);
    const values = requestUpdate?.values as {
      items: SubstitutionItem[];
      catalogGap: boolean;
      toExerciseId: string;
      status?: string;
    };
    expect(values.items[0]).toMatchObject({
      toExerciseId: DIAMANTE_TO.id,
      toExerciseName: DIAMANTE_TO.name,
      catalogGap: false,
    });
    expect(values.catalogGap).toBe(false); // não há mais item de catálogo pendente
    expect(values.toExerciseId).toBe(DIAMANTE_TO.id); // espelho do 1º item
    // Não libera nada: nem status, nem protocolo, nem versão.
    expect(values.status).toBeUndefined();
    expect(updates.find((u) => u.table === protocols)).toBeUndefined();
    expect(inserts.find((i) => i.table === protocolVersions)).toBeUndefined();
  });

  it('exercício publicado inelegível para o aluno → NOT_VIABLE, nada é escrito', async () => {
    // `agachamento_barra` exige nível INTERMEDIARIO — o aluno fixture é INICIANTE.
    const { repository, updates } = repositoryWith([[GAP_REQUEST], [BATCH_PROTOCOL_ROW]]);
    const result = await repository.attachCatalogExercise(
      STAFF,
      'sub-request-1',
      0,
      AGACHAMENTO_BARRA,
    );
    expect(result).toEqual({ attached: false, reason: 'NOT_VIABLE' });
    expect(updates).toHaveLength(0);
  });

  it('protocolo mudou de versão desde que a proposta nasceu → STALE, descarta a proposta', async () => {
    const { repository, updates } = repositoryWith([
      [GAP_REQUEST],
      [{ ...BATCH_PROTOCOL_ROW, version: 5 }],
    ]);
    const result = await repository.attachCatalogExercise(STAFF, 'sub-request-1', 0, DIAMANTE_TO);
    expect(result).toEqual({ attached: false, reason: 'STALE' });
    const requestUpdate = updates.find((u) => u.table === protocolSubstitutionRequests);
    expect(requestUpdate?.values).toMatchObject({ status: 'DISCARDED' });
  });

  it('item que não é de catálogo, índice inexistente ou proposta decidida → NOT_FOUND', async () => {
    const notGap = repositoryWith([[GAP_REQUEST]]);
    expect(
      await notGap.repository.attachCatalogExercise(STAFF, 'sub-request-1', 1, DIAMANTE_TO),
    ).toEqual({
      attached: false,
      reason: 'NOT_FOUND',
    });
    const outOfRange = repositoryWith([[GAP_REQUEST]]);
    expect(
      await outOfRange.repository.attachCatalogExercise(STAFF, 'sub-request-1', 2, DIAMANTE_TO),
    ).toEqual({
      attached: false,
      reason: 'NOT_FOUND',
    });
    const decided = repositoryWith([[{ ...GAP_REQUEST, status: 'RELEASED' }]]);
    expect(
      await decided.repository.attachCatalogExercise(STAFF, 'sub-request-1', 0, DIAMANTE_TO),
    ).toEqual({
      attached: false,
      reason: 'NOT_FOUND',
    });
    expect(notGap.updates).toHaveLength(0);
    expect(outOfRange.updates).toHaveLength(0);
    expect(decided.updates).toHaveLength(0);
  });
});

describe('ProtocolSubstitutionRepository.escalateToMandatory', () => {
  it('passa a proposta pendente a exigir revisão humana', async () => {
    const { repository, updates } = repositoryWith([]);
    await repository.escalateToMandatory(USER, 'sub-request-1');
    const requestUpdate = updates.find((u) => u.table === protocolSubstitutionRequests);
    expect(requestUpdate?.values).toEqual({ reviewUrgency: 'MANDATORY' });
  });
});
