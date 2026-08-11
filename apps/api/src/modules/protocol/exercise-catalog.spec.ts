import { describe, expect, it } from 'vitest';

import { EXERCISE_BY_ID, EXERCISE_CATALOG, isKnownExercise, servesLocation } from './exercise-catalog';

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

  it('cobre todo grupo muscular exigido pelas divisões ABC/PPL/FOCO_MUSCULAR (v2)', () => {
    // Sem cobertura por grupo, "um ou dois grupos por dia" não tem vocabulário na base.
    const groups = [
      'peito',
      'costas',
      'ombro',
      'bíceps',
      'tríceps',
      'quadríceps',
      'posterior de coxa',
      'glúteo',
      'panturrilha',
      'core',
    ];
    for (const group of groups) {
      const forGroup = EXERCISE_CATALOG.filter((e) => e.muscleGroups.includes(group));
      expect(forGroup.length, `grupo sem exercício: ${group}`).toBeGreaterThanOrEqual(2);
      // ponytail: panturrilha não tem multiarticular real — exigimos ≥2 opções, não um composto.
      if (group === 'panturrilha') continue;
      expect(
        forGroup.some((e) => e.pattern !== 'ISOLATION'),
        `grupo sem exercício multiarticular: ${group}`,
      ).toBe(true);
      expect(
        forGroup.some((e) => e.pattern === 'ISOLATION' || group === 'core'),
        `grupo sem exercício isolado: ${group}`,
      ).toBe(true);
    }
  });

  it('isKnownExercise distingue id conhecido de desconhecido', () => {
    expect(isKnownExercise('pushup')).toBe(true);
    expect(isKnownExercise('exercicio_inventado')).toBe(false);
  });
});

describe('cobertura por local de treino (Sprint 6 — os 4 valores reais)', () => {
  const LOCATIONS = ['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR'] as const;

  it('todo exercício declara ao menos um local', () => {
    for (const exercise of EXERCISE_CATALOG) {
      expect(exercise.locations.length, `${exercise.id} sem local`).toBeGreaterThan(0);
    }
  });

  it('exercício de máquina/polia/barra só existe em academia completa', () => {
    const gymOnlyEquipment = ['máquina', 'polia', 'barra'];
    for (const exercise of EXERCISE_CATALOG) {
      if (exercise.equipment.some((e) => gymOnlyEquipment.includes(e))) {
        expect(exercise.locations, `${exercise.id}`).toEqual(['FULL_GYM']);
      }
    }
  });

  it('nada que exija halteres, banco ou máquina é oferecido ao ar livre', () => {
    const indoorEquipment = ['halteres', 'máquina', 'polia', 'barra', 'bicicleta ergométrica'];
    for (const exercise of EXERCISE_CATALOG.filter((e) => e.locations.includes('OUTDOOR'))) {
      for (const item of exercise.equipment) {
        expect(indoorEquipment, `${exercise.id} usa ${item} ao ar livre`).not.toContain(item);
      }
    }
  });

  it.each(LOCATIONS)(
    '%s tem vocabulário suficiente: empurrar, puxar, agachar, core e cardio',
    (location) => {
      const available = EXERCISE_CATALOG.filter((e) => servesLocation(e, location));
      const patterns = new Set(available.map((e) => e.pattern));
      for (const required of ['HORIZONTAL_PUSH', 'HORIZONTAL_PULL', 'SQUAT', 'CORE', 'CARDIO']) {
        expect(patterns, `${location} sem ${required}`).toContain(required);
      }
      // Sem isso, "ao ar livre" e "academia de condomínio" seriam locais degradados —
      // exatamente o mapeamento forçado que o fundador recusou.
      expect(available.length).toBeGreaterThanOrEqual(12);
    },
  );

  it('academia de condomínio é um subconjunto real da completa, não um apelido', () => {
    const full = EXERCISE_CATALOG.filter((e) => servesLocation(e, 'FULL_GYM')).length;
    const condo = EXERCISE_CATALOG.filter((e) => servesLocation(e, 'CONDO_GYM')).length;
    expect(condo).toBeLessThan(full);
  });
});
