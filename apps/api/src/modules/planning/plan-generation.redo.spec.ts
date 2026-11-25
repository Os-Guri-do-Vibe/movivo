/**
 * Refazer o protocolo a partir de um caso encerrado na Fila: com a orientação do profissional
 * (`adjustFromCase`) ou do zero (`regenerateFromCase`). Os dois descartam o rascunho e passam pelo
 * mesmo `adjust`; só a regeneração vai sem orientação.
 */
import { describe, expect, it, vi } from 'vitest';

import { nutritionPlans, trainingPlans } from '../../core/database/schema';
import { PlanGenerationService } from './plan-generation.service';

const PLAN_ID = '33333333-3333-4333-8333-333333333333';

type Row = Record<string, unknown>;

/** `rows`: uma linha para toda consulta ou, em lista, uma por consulta (na ordem). */
function setup(rows: Row | Row[] | undefined) {
  const queue = Array.isArray(rows) ? [...rows] : null;
  const updates: Array<{ table: unknown; values: unknown }> = [];
  const tx = {
    select: () => {
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        where: () => {
          const row = queue ? queue.shift() : rows;
          return Promise.resolve(row ? [row] : []);
        },
      };
      return chain;
    },
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: () => {
          updates.push({ table, values });
          return Promise.resolve();
        },
      }),
    }),
  };
  const db = { runAsSystem: <T>(work: (t: typeof tx) => Promise<T>) => work(tx) };
  // Só o banco e o logger importam aqui; o `adjust` (agentes, políticas) é espionado.
  const unused = {} as never;
  const service = new PlanGenerationService(
    db as never,
    unused, // runner
    unused, // stateReader
    unused, // methodology
    unused, // catalog
    unused, // pipeline
    unused, // publisher
    unused, // foods
    unused, // delivery
    unused, // outbox
    unused, // physique
    { setContext: vi.fn() } as never,
  );
  const adjust = vi
    .spyOn(service as unknown as { adjust: (...args: unknown[]) => unknown }, 'adjust')
    .mockResolvedValue({ status: 'PENDING_REVIEW', exceptionCaseIds: ['novo-caso'] });
  return { service, adjust, updates };
}

const training = { type: 'PUBLISH_TRAINING_PLAN', planId: PLAN_ID };
const nutrition = { type: 'PUBLISH_NUTRITION_PLAN', planId: PLAN_ID };
const regeneration = { outcome: 'REGENERATION_REQUESTED', note: 'Regeneração completa.' };

describe('PlanGenerationService.regenerateFromCase', () => {
  it('treino: descarta o rascunho e refaz sem orientação (a nota do caso não vira instrução)', async () => {
    const { service, adjust, updates } = setup({ resolution: regeneration, action: training });
    await expect(
      service.regenerateFromCase('aluno-1', 'caso-1', { triggerEventId: 'evt-1' }),
    ).resolves.toEqual({ status: 'PENDING_REVIEW', exceptionCaseIds: ['novo-caso'] });
    expect(updates).toEqual([{ table: trainingPlans, values: { status: 'SUPERSEDED' } }]);
    expect(adjust).toHaveBeenCalledWith('aluno-1', 'TRAINING', undefined, {
      triggerEventId: 'evt-1',
      sourceCaseId: 'caso-1',
    });
  });

  it('alimentar: refaz o plano alimentar do zero', async () => {
    const { service, adjust, updates } = setup({ resolution: regeneration, action: nutrition });
    await service.regenerateFromCase('aluno-1', 'caso-1');
    expect(updates).toEqual([{ table: nutritionPlans, values: { status: 'SUPERSEDED' } }]);
    expect(adjust).toHaveBeenCalledWith('aluno-1', 'NUTRITION', undefined, {
      sourceCaseId: 'caso-1',
    });
  });

  it('caso que não pediu regeneração (ex.: ajuste) não regera', async () => {
    const { service, adjust, updates } = setup({
      resolution: { outcome: 'ADJUSTMENT_REQUESTED', note: 'Menos volume' },
      action: training,
    });
    await expect(service.regenerateFromCase('aluno-1', 'caso-1')).resolves.toEqual({
      status: 'SKIPPED',
      reason: 'NO_ADJUSTMENT',
    });
    expect(adjust).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('proposta que não é publicação de protocolo não regera', async () => {
    const { service, adjust } = setup({
      resolution: regeneration,
      action: { type: 'SUBSTITUTE_EXERCISE' },
    });
    await expect(service.regenerateFromCase('aluno-1', 'caso-1')).resolves.toMatchObject({
      status: 'SKIPPED',
    });
    expect(adjust).not.toHaveBeenCalled();
  });
});

describe('PlanGenerationService.adjustFromCase (inalterado)', () => {
  it('refaz com a orientação gravada no caso', async () => {
    const { service, adjust } = setup({
      resolution: { outcome: 'ADJUSTMENT_REQUESTED', note: 'Menos volume' },
      action: training,
    });
    await service.adjustFromCase('aluno-1', 'caso-1');
    expect(adjust).toHaveBeenCalledWith('aluno-1', 'TRAINING', 'Menos volume', {
      sourceCaseId: 'caso-1',
    });
  });

  it('ajuste sem orientação ou caso de regeneração não vira ajuste', async () => {
    const noNote = setup({ resolution: { outcome: 'ADJUSTMENT_REQUESTED' }, action: training });
    await expect(noNote.service.adjustFromCase('aluno-1', 'caso-1')).resolves.toMatchObject({
      status: 'SKIPPED',
    });
    const regen = setup({ resolution: regeneration, action: training });
    await expect(regen.service.adjustFromCase('aluno-1', 'caso-1')).resolves.toMatchObject({
      status: 'SKIPPED',
    });
    expect(noNote.adjust).not.toHaveBeenCalled();
    expect(regen.adjust).not.toHaveBeenCalled();
  });
});

describe('PlanGenerationService.retryFromFailureCase', () => {
  it('a regeração que falhou é repetida a partir do caso de origem, não pela geração inicial', async () => {
    const { service, adjust, updates } = setup([
      { subject: { sourceCaseId: 'caso-1', redoDomain: 'TRAINING' } },
      { resolution: regeneration },
      { resolution: regeneration, action: training },
    ]);
    const generate = vi.spyOn(service, 'generate');
    await service.retryFromFailureCase('aluno-1', 'falha-1', { triggerEventId: 'evt-2' });
    expect(adjust).toHaveBeenCalledWith('aluno-1', 'TRAINING', undefined, {
      triggerEventId: 'evt-2',
      sourceCaseId: 'caso-1',
    });
    expect(updates).toEqual([{ table: trainingPlans, values: { status: 'SUPERSEDED' } }]);
    expect(generate).not.toHaveBeenCalled();
  });

  it('ajuste que falhou mantém a orientação gravada no caso de origem', async () => {
    const adjustment = { outcome: 'ADJUSTMENT_REQUESTED', note: 'Menos volume' };
    const { service, adjust } = setup([
      { subject: { sourceCaseId: 'caso-1', redoDomain: 'TRAINING' } },
      { resolution: adjustment },
      { resolution: adjustment, action: training },
    ]);
    await service.retryFromFailureCase('aluno-1', 'falha-1');
    expect(adjust).toHaveBeenCalledWith('aluno-1', 'TRAINING', 'Menos volume', {
      sourceCaseId: 'caso-1',
    });
  });

  it('sem caso de origem refaz só o protocolo do domínio; sem nada, a geração inicial', async () => {
    const domainOnly = setup([{ subject: { redoDomain: 'NUTRITION' } }]);
    await domainOnly.service.retryFromFailureCase('aluno-1', 'falha-1');
    expect(domainOnly.adjust).toHaveBeenCalledWith('aluno-1', 'NUTRITION', undefined, {});

    const initial = setup([{ subject: { triggerEventId: 'evt-0' } }]);
    const generate = vi
      .spyOn(initial.service, 'generate')
      .mockResolvedValue({ status: 'SKIPPED', reason: 'ALREADY_PLANNED' });
    await initial.service.retryFromFailureCase('aluno-1', 'falha-1');
    expect(generate).toHaveBeenCalledWith('aluno-1', {});
    expect(initial.adjust).not.toHaveBeenCalled();
  });
});
