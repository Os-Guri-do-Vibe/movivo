import { describe, expect, it } from 'vitest';

import { mergeSensitive, splitStep } from './anamnesis.service';

describe('separação da etapa em parte comum e sensível', () => {
  it('objetivos: a motivação (texto livre) vai só para o cifrado', () => {
    const { common, sensitive } = splitStep(2, {
      goal: { primary: 'HYPERTROPHY', secondary: [], emphasis: 'AESTHETICS' },
      motivation: 'Quero me sentir bem no casamento',
    });
    expect(common).toEqual({
      goal: { primary: 'HYPERTROPHY', secondary: [], emphasis: 'AESTHETICS' },
    });
    expect(sensitive).toEqual({ motivation: 'Quero me sentir bem no casamento' });
  });

  it('PAR-Q (última etapa) é inteiro sensível', () => {
    const parq = { parq: { answers: [] }, declarations: [] };
    expect(splitStep(9, parq)).toEqual({ common: null, sensitive: parq });
  });

  it('dores e limitações têm tela própria e são inteiras sensíveis', () => {
    const pain = { pain: { hasPain: false, points: [] } };
    expect(splitStep(6, pain)).toEqual({ common: null, sensitive: pain });
  });

  it('preferências: textos livres e saúde cifrados, ênfase muscular em claro', () => {
    const { common, sensitive } = splitStep(5, {
      preferences: { priority: 'BALANCED', muscleEmphasis: ['CHEST'] },
      trainingPreferences: 'prefiro treinos curtos',
      conditions: 'asma',
    });
    expect(Object.keys(common ?? {})).toEqual(['preferences']);
    expect(Object.keys(sensitive ?? {}).sort()).toEqual(['conditions', 'trainingPreferences']);
  });

  it('alimentação: alergias e textos livres cifrados, rotina alimentar em claro', () => {
    const { common, sensitive } = splitStep(7, {
      cookingCapacity: 'BASIC',
      mealsOutsideHomePerWeek: 2,
      foodBudgetMonthlyBrl: 1200.5,
      mealsPerDay: 4,
      usualMeals: ['BREAKFAST', 'LUNCH'],
      dietaryRestrictions: [],
      allergies: [{ allergen: 'amendoim', severity: 'SEVERE_ALLERGY' }],
      supplements: ['OTHER'],
      supplementOther: 'colágeno',
      hunger: 'NORMAL',
      likedFoods: 'arroz e feijão',
    });
    expect(Object.keys(common ?? {}).sort()).toEqual(
      [
        'cookingCapacity',
        'dietaryRestrictions',
        'foodBudgetMonthlyBrl',
        'hunger',
        'mealsOutsideHomePerWeek',
        'mealsPerDay',
        'supplements',
        'usualMeals',
      ].sort(),
    );
    expect(Object.keys(sensitive ?? {}).sort()).toEqual([
      'allergies',
      'likedFoods',
      'supplementOther',
    ]);
  });

  it('etapas sem dado sensível ficam inteiras em claro', () => {
    const routine = { windows: [], variesWeekly: true, maxSessionsPerWeek: 3, lifeContext: {} };
    expect(splitStep(4, routine)).toEqual({ common: routine, sensitive: null });
  });
});

describe('reenvio de etapa retomada (texto sensível não volta à tela)', () => {
  it('texto opcional omitido mantém o salvo; vazio apaga', () => {
    const saved = { motivation: 'Quero correr minha primeira prova' };
    expect(mergeSensitive(2, saved, {})).toEqual(saved);
    expect(mergeSensitive(2, saved, { motivation: 'Outra' })).toEqual({ motivation: 'Outra' });
    expect(mergeSensitive(2, saved, { motivation: '' })).toEqual({});
  });

  it('alimentação: só gostos e aversões são mantidos; alergia segue a nova resposta', () => {
    const saved = {
      allergies: [{ allergen: 'amendoim', severity: 'ALLERGY' }],
      likedFoods: 'arroz',
      dislikedFoods: 'jiló',
    };
    expect(mergeSensitive(7, saved, { allergies: [] })).toEqual({
      allergies: [],
      likedFoods: 'arroz',
      dislikedFoods: 'jiló',
    });
  });

  it('etapas de resposta obrigatória substituem tudo', () => {
    const saved = { conditions: 'asma' };
    expect(mergeSensitive(5, saved, {})).toEqual({});
  });
});
