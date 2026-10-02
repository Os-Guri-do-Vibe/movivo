import type { WorkoutSetInput } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import { finalizeWorkoutSets } from './workout-journal';

function entry(
  exerciseId: string,
  setNumber: number,
  patch: Partial<WorkoutSetInput> = {},
): WorkoutSetInput {
  return {
    exerciseId,
    setNumber,
    reps: null,
    loadValue: null,
    loadUnit: 'KG',
    durationSeconds: null,
    completed: false,
    skipped: false,
    ...patch,
  };
}

describe('finalizeWorkoutSets', () => {
  it('registra só as séries preenchidas e não completa as demais com a prescrição', () => {
    const result = finalizeWorkoutSets([
      entry('supino', 1, { reps: 10, loadValue: 40 }),
      entry('supino', 2, { reps: 8, loadValue: 40 }),
      entry('supino', 3),
      entry('supino', 4),
    ]);

    expect(result.map((set) => set.completed)).toEqual([true, true, false, false]);
    expect(result[2]).toMatchObject({ reps: null, loadValue: null, skipped: false });
  });

  it('considera feita a série com reps e sem carga (sem peso)', () => {
    const [set] = finalizeWorkoutSets([entry('flexao', 1, { reps: 12 })]);

    expect(set).toMatchObject({ reps: 12, loadValue: null, completed: true });
  });

  it('trata reps 0 ou vazio sem nenhuma série feita como exercício pulado', () => {
    const result = finalizeWorkoutSets([
      entry('supino', 1, { reps: 0, loadValue: 30 }),
      entry('supino', 2),
    ]);

    expect(result.every((set) => set.skipped && !set.completed)).toBe(true);
    expect(result.every((set) => set.reps === null && set.loadValue === null)).toBe(true);
  });

  it('só marca como feita a série com tempo (> 0) quando o exercício é por duração', () => {
    const result = finalizeWorkoutSets([
      entry('bike', 1, { durationSeconds: 300 }),
      entry('esteira', 1, { durationSeconds: 0 }),
    ]);

    expect(result[0]).toMatchObject({ completed: true, skipped: false });
    expect(result[1]).toMatchObject({ completed: false, skipped: true });
  });

  it('preserva o exercício pulado explicitamente', () => {
    const [set] = finalizeWorkoutSets([entry('supino', 1, { skipped: true })]);

    expect(set).toMatchObject({ completed: false, skipped: true });
  });
});
