import { describe, expect, it } from 'vitest';

import { EXERCISE_BY_ID, EXERCISE_CATALOG, isKnownExercise } from './exercise-catalog';

describe('exercise-catalog (base de referência)', () => {
  it('não tem ids duplicados', () => {
    const ids = EXERCISE_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('todo substituto referencia um exercício existente no catálogo', () => {
    for (const exercise of EXERCISE_CATALOG) {
      for (const sub of exercise.substitutes) {
        expect(isKnownExercise(sub), `${exercise.id} → substituto ${sub} inexistente`).toBe(true);
      }
    }
  });

  it('um exercício não é substituto de si mesmo', () => {
    for (const exercise of EXERCISE_CATALOG) {
      expect(exercise.substitutes).not.toContain(exercise.id);
    }
  });

  it('EXERCISE_BY_ID indexa todos os exercícios', () => {
    expect(EXERCISE_BY_ID.size).toBe(EXERCISE_CATALOG.length);
  });

  it('isKnownExercise distingue id conhecido de desconhecido', () => {
    expect(isKnownExercise('pushup')).toBe(true);
    expect(isKnownExercise('exercicio_inventado')).toBe(false);
  });
});
