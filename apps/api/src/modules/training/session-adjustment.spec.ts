import { describe, expect, it } from 'vitest';

import type { SessionContent } from '@movivo/shared';

import { applyAdjustment, shortenFactor } from './session-adjustment';

const exercise = (id: string, sets = 4) => ({
  exerciseId: id,
  name: id,
  sets,
  reps: { min: 8, max: 12 },
  loadStrategy: 'DOUBLE_PROGRESSION' as const,
  restSeconds: 90,
});
const STRENGTH: SessionContent = {
  modality: 'STRENGTH',
  focus: 'Corpo todo',
  exercises: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => exercise(id)),
};

describe('applyAdjustment', () => {
  it('sem ajuste devolve o próprio conteúdo', () => {
    expect(applyAdjustment(STRENGTH, null)).toBe(STRENGTH);
    expect(applyAdjustment(STRENGTH, {})).toEqual(STRENGTH);
  });

  it('calcula a fração pelo tempo, sem passar de 1 nem cair abaixo de 0,2', () => {
    expect(shortenFactor(60, 30)).toBe(0.5);
    expect(shortenFactor(60, 90)).toBe(1);
    expect(shortenFactor(60, 5)).toBe(0.2);
  });

  it('encurta força: menos exercícios e menos séries, os principais ficam', () => {
    const shortened = applyAdjustment(STRENGTH, { shorten: { targetMinutes: 30, factor: 0.5 } });
    if (shortened.modality !== 'STRENGTH') throw new Error('modalidade');
    expect(shortened.exercises.length).toBeLessThan(6);
    expect(shortened.exercises[0]?.exerciseId).toBe('a');
    expect(shortened.exercises.every((e) => e.sets >= 1 && e.sets < 4)).toBe(true);
  });

  it('troca exercício só nesta sessão, sem tocar nos demais', () => {
    const swapped = applyAdjustment(STRENGTH, {
      substitutions: [{ fromExerciseId: 'c', toExerciseId: 'z', toName: 'Exercício Z' }],
    });
    if (swapped.modality !== 'STRENGTH') throw new Error('modalidade');
    expect(swapped.exercises.map((e) => e.exerciseId)).toEqual(['a', 'b', 'z', 'd', 'e', 'f']);
    expect(swapped.exercises[2]?.name).toBe('Exercício Z');
    expect(STRENGTH.modality === 'STRENGTH' && STRENGTH.exercises[2]?.exerciseId).toBe('c');
  });

  it('encurta corrida preservando aquecimento e desaquecimento', () => {
    const running: SessionContent = {
      modality: 'RUNNING',
      kind: 'INTERVALS',
      terrain: 'ANY',
      segments: [
        { type: 'WARMUP', durationSeconds: 600, target: { by: 'ZONE', zone: 'Z1' } },
        { type: 'WORK', repeat: 6, distanceMeters: 800, target: { by: 'ZONE', zone: 'Z4' } },
        { type: 'STEADY', distanceMeters: 4_000, target: { by: 'ZONE', zone: 'Z2' } },
        { type: 'COOLDOWN', durationSeconds: 600, target: { by: 'ZONE', zone: 'Z1' } },
      ],
    };
    const shortened = applyAdjustment(running, { shorten: { targetMinutes: 25, factor: 0.5 } });
    if (shortened.modality !== 'RUNNING') throw new Error('modalidade');
    expect(shortened.segments[0]).toEqual(
      running.modality === 'RUNNING' ? running.segments[0] : null,
    );
    expect(shortened.segments[1]?.repeat).toBe(3);
    expect(shortened.segments[2]?.distanceMeters).toBe(2_000);
    expect(shortened.segments[3]?.durationSeconds).toBe(600);
  });

  it('encurta HYROX por voltas ou por blocos', () => {
    const rounds: SessionContent = {
      modality: 'HYROX',
      kind: 'ENGINE',
      rounds: 4,
      blocks: [{ type: 'RUN', distanceMeters: 1_000, target: { by: 'ZONE', zone: 'Z3' } }],
    };
    const shortened = applyAdjustment(rounds, { shorten: { targetMinutes: 20, factor: 0.5 } });
    expect(shortened.modality === 'HYROX' && shortened.rounds).toBe(2);
  });
});
