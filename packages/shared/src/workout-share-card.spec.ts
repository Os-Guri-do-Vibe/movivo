import { describe, expect, it } from 'vitest';

import { mapWorkoutMuscles } from './workout-share-card';
import { workoutShareCardDataSchema } from './schemas/workout-share-card.schema';

describe('mapWorkoutMuscles', () => {
  it('normaliza acentos, aliases, caixa e duplicatas sem divergência entre texto e máscaras', () => {
    expect(mapWorkoutMuscles([' PEITO ', 'chest', 'Tríceps', 'OMBRO', 'ombros'])).toEqual({
      trainedMuscles: ['Peito', 'Tríceps', 'Ombros'],
      muscleGroupsForHighlighter: ['chest', 'triceps', 'shoulders'],
    });
  });
  it('expande regiões compostas e mantém desconhecidos sem inventar anatomia', () => {
    expect(mapWorkoutMuscles(['costas', 'core', 'pescoço', 'sistema cardiovascular', ''])).toEqual({
      trainedMuscles: ['Costas', 'Core', 'Pescoço', 'Sistema cardiovascular'],
      muscleGroupsForHighlighter: ['upper_back', 'lats', 'abs', 'obliques'],
    });
    expect(mapWorkoutMuscles([])).toEqual({ trainedMuscles: [], muscleGroupsForHighlighter: [] });
    expect(mapWorkoutMuscles(['corpo todo']).muscleGroupsForHighlighter).toHaveLength(14);
  });
  it('valida o contrato e rejeita duração inválida e identificador de músculo inventado', () => {
    const data = {
      user: { name: 'Ana', gender: 'female' },
      workout: {
        durationMinutes: 65,
        completedAt: '2026-09-17T15:00:00.000Z',
        ...mapWorkoutMuscles(['glúteo', 'quadríceps', 'posterior de coxa', 'panturrilha']),
      },
    };
    expect(workoutShareCardDataSchema.safeParse(data).success).toBe(true);
    expect(
      workoutShareCardDataSchema.safeParse({
        ...data,
        workout: {
          ...data.workout,
          durationMinutes: -1,
        },
      }).success,
    ).toBe(false);
    expect(
      workoutShareCardDataSchema.safeParse({
        ...data,
        workout: {
          ...data.workout,
          muscleGroupsForHighlighter: ['inventado'],
        },
      }).success,
    ).toBe(false);
  });
});
