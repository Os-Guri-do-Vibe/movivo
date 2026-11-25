import { describe, expect, it } from 'vitest';

import { strengthSample } from '../cases/samples';
import { coordinatorInputOf, coordinatorValidators, type CoordinatorOutput } from './coordinator';

const input = coordinatorInputOf(
  { title: 'Teste', energyStrategy: 'MAINTENANCE', modalityFocus: ['STRENGTH'] },
  {
    summary: 'Plano.',
    modalityPriorities: [{ modality: 'STRENGTH', priority: 1 }],
    phases: [{ name: 'Base', focus: 'Base.', weeks: 4, endsWithDeload: false }],
    sessions: [strengthSample('FORCA_A', 'Corpo todo', 2)],
  },
  {
    strategy: 'MAINTENANCE',
    summary: 'Plano alimentar.',
    trainingDay: {
      energyKcal: { min: 2000, max: 2200 },
      proteinG: 140,
      carbsG: 230,
      fatG: 60,
      fiberG: 30,
      waterMl: 2500,
    },
    restDay: {
      energyKcal: { min: 1900, max: 2100 },
      proteinG: 140,
      carbsG: 200,
      fatG: 60,
      fiberG: 30,
      waterMl: 2500,
    },
    meals: [],
    guidelines: ['Água.'],
    supplements: [],
  },
);

const swap = {
  target: 'TRAINING' as const,
  instruction: 'Trocar o supino por uma variação sem dor.',
};

const ok: CoordinatorOutput = {
  verdict: 'ADJUST',
  opinions: [{ area: 'SAFETY', observation: 'Dor no ombro registrada.' }],
  conflicts: [
    { description: 'Supino com dor no ombro.', prevails: 'SAFETY', yields: 'MODALITIES' },
  ],
  adjustments: [swap],
  professionalNote: 'Conferir a troca do supino.',
};

const violations = async (output: CoordinatorOutput) =>
  (
    await Promise.all(
      coordinatorValidators.map((v) => v(input, output, { state: {}, methodology: {} })),
    )
  ).flat();

describe('coordenador', () => {
  it('monta a entrada com o detalhe das sessões', () => {
    expect(input.training.sessions[0]?.details.join(' ')).toContain('Supino reto com barra');
    expect(input.nutrition.trainingDay).toEqual({
      kcalMin: 2000,
      kcalMax: 2200,
      proteinG: 140,
      carbsG: 230,
    });
  });

  it('aceita o parecer coerente com a hierarquia', async () => {
    expect(await violations(ok)).toEqual([]);
  });

  it('recusa conflito que contraria a hierarquia', async () => {
    const out = await violations({
      ...ok,
      conflicts: [{ description: 'x', prevails: 'PREFERENCES', yields: 'SAFETY' }],
    });
    expect(out.map((v) => v.path)).toContain('conflicts.0');
  });

  it('veredito e ajustes precisam concordar, com um ajuste por parte', async () => {
    expect((await violations({ ...ok, verdict: 'COHERENT' })).map((v) => v.path)).toContain(
      'verdict',
    );
    const twice = await violations({
      ...ok,
      adjustments: [swap, { target: 'TRAINING', instruction: 'Reduzir o volume semanal.' }],
    });
    expect(twice.map((v) => v.path)).toContain('adjustments');
  });
});
