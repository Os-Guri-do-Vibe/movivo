import { describe, expect, it } from 'vitest';

import { splitStep } from './anamnesis.service';

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

  it('PAR-Q é inteiro sensível', () => {
    const parq = { parq: { answers: [] }, declarations: [] };
    expect(splitStep(6, parq)).toEqual({ common: null, sensitive: parq });
  });

  it('alimentação: alergias e textos livres cifrados, rotina alimentar em claro', () => {
    const { common, sensitive } = splitStep(7, {
      mealsPerDay: 4,
      usualMeals: ['BREAKFAST', 'LUNCH'],
      dietaryRestrictions: [],
      allergies: [{ allergen: 'amendoim', severity: 'SEVERE_ALLERGY' }],
      supplements: [],
      hunger: 'NORMAL',
      likedFoods: 'arroz e feijão',
    });
    expect(Object.keys(common ?? {}).sort()).toEqual(
      ['dietaryRestrictions', 'hunger', 'mealsPerDay', 'supplements', 'usualMeals'].sort(),
    );
    expect(Object.keys(sensitive ?? {}).sort()).toEqual(['allergies', 'likedFoods']);
  });

  it('etapas sem dado sensível ficam inteiras em claro', () => {
    const routine = { windows: [], variesWeekly: true, maxSessionsPerWeek: 3, lifeContext: {} };
    expect(splitStep(4, routine)).toEqual({ common: routine, sensitive: null });
  });
});
