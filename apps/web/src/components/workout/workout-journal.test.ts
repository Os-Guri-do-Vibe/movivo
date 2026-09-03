import type { WorkoutJournal, WorkoutSetInput } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import { acceptSuggestedWorkoutSets } from './workout-journal';

const sets: WorkoutSetInput[] = [
  {
    exerciseId: 'agachamento',
    setNumber: 1,
    reps: null,
    loadValue: null,
    loadUnit: 'KG',
    durationSeconds: null,
    completed: false,
    skipped: false,
  },
  {
    exerciseId: 'agachamento',
    setNumber: 2,
    reps: null,
    loadValue: null,
    loadUnit: 'KG',
    durationSeconds: null,
    completed: false,
    skipped: true,
  },
];

const workout = {
  prescription: {
    dayLabel: 'Treino A',
    focus: 'Inferiores',
    exercises: [
      {
        exerciseId: 'agachamento',
        name: 'Agachamento',
        sets: 2,
        reps: { min: 8, max: 12 },
        loadStrategy: 'FIXED_LOAD',
        restSeconds: 60,
      },
    ],
  },
  sets: [
    {
      ...sets[0],
      previous: {
        date: '2026-08-27',
        reps: 10,
        loadValue: 12,
        loadUnit: 'KG',
        durationSeconds: null,
      },
    },
    { ...sets[1], previous: null },
  ],
} as unknown as NonNullable<WorkoutJournal['workout']>;

describe('acceptSuggestedWorkoutSets', () => {
  it('aceita o placeholder como realizado e preserva o pulo explicito', () => {
    const result = acceptSuggestedWorkoutSets(sets, workout);

    expect(result[0]).toMatchObject({
      reps: 10,
      loadValue: 12,
      completed: true,
      skipped: false,
    });
    expect(result[1]).toMatchObject({
      reps: null,
      loadValue: null,
      completed: false,
      skipped: true,
    });
  });

  it('mantem o valor digitado em vez da sugestao anterior', () => {
    const first = sets[0];
    if (!first) throw new Error('Fixture sem a primeira serie.');
    const result = acceptSuggestedWorkoutSets([{ ...first, loadValue: 14 }], workout);

    expect(result[0]).toMatchObject({ reps: 10, loadValue: 14, completed: true });
  });
});
