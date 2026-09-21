import { mapWorkoutMuscles, type WorkoutShareCardData } from '@movivo/shared';

/** Exemplos sintéticos, importados só por testes/documentação; nenhum dado real de aluno. */
export const workoutShareCardMock: WorkoutShareCardData = {
  user: { name: 'Alex', gender: 'male' },
  workout: {
    name: 'Treino A',
    durationMinutes: 90,
    ...mapWorkoutMuscles(['Peito', 'Tríceps', 'Ombros']),
    completedAt: '2026-09-17T15:00:00.000Z',
  },
};

export const fullBodyShareCardMock: WorkoutShareCardData = {
  user: { name: 'Ana', gender: 'female' },
  workout: {
    name: 'Corpo inteiro',
    durationMinutes: 65,
    ...mapWorkoutMuscles([
      'chest',
      'shoulders',
      'biceps',
      'triceps',
      'forearms',
      'abs',
      'obliques',
      'upper_back',
      'lats',
      'lower_back',
      'glutes',
      'quads',
      'hamstrings',
      'calves',
    ]),
    completedAt: '2026-09-17T15:00:00.000Z',
  },
};
