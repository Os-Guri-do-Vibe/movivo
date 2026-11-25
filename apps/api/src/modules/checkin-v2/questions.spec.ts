import { describe, expect, it } from 'vitest';

import { AnswerError, composeQuestions, validateAnswers, type CheckInSignals } from './questions';

const CALM: CheckInSignals = {
  adherenceRate: 0.9,
  lowAdherenceRate: 0.6,
  strengthSessionsLastWeek: 0,
  rpeAbovePlanned: 0,
  foodLogDaysLast7: 6,
  hasNutritionPlan: true,
  daysSinceWeight: 3,
};
const keys = (signals: CheckInSignals) => composeQuestions(signals).map((q) => q.key);

describe('composeQuestions', () => {
  it('semana normal: o núcleo de acompanhamento, com a de segurança primeiro e o texto livre por último', () => {
    expect(keys(CALM)).toEqual([
      'pain',
      'pain_where',
      'weight_kg',
      'energy',
      'sleep',
      'stress',
      'motivation',
      'food_week',
      'next_week',
      'win',
      'help_with',
    ]);
  });

  it('o peso é pedido todo domingo, mesmo que o aluno tenha se pesado há poucos dias', () => {
    expect(keys({ ...CALM, daysSinceWeight: 1 })).toContain('weight_kg');
    expect(keys({ ...CALM, daysSinceWeight: null })).toContain('weight_kg');
  });

  it('o peso sobrevive ao corte quando a semana traz muitas perguntas', () => {
    const crowded = composeQuestions({
      adherenceRate: 0.1,
      lowAdherenceRate: 0.6,
      strengthSessionsLastWeek: 3,
      rpeAbovePlanned: -2,
      foodLogDaysLast7: 0,
      hasNutritionPlan: true,
      daysSinceWeight: 7,
    });
    expect(crowded.map((q) => q.key)).toContain('weight_kg');
  });

  it('queda de adesão traz a pergunta de barreira', () => {
    expect(keys({ ...CALM, adherenceRate: 0.3 })).toContain('barrier');
  });

  it('esforço fora do padrão, pouca alimentação e peso antigo trazem as perguntas próprias', () => {
    const found = keys({
      ...CALM,
      rpeAbovePlanned: 2,
      foodLogDaysLast7: 1,
      daysSinceWeight: null,
      strengthSessionsLastWeek: 2,
    });
    expect(found).toEqual(
      expect.arrayContaining(['intensity_feel', 'food_difficulty', 'soreness']),
    );
  });

  it('nunca passa do teto e a pergunta de segurança sobrevive ao corte', () => {
    const all = composeQuestions({
      adherenceRate: 0.1,
      lowAdherenceRate: 0.6,
      strengthSessionsLastWeek: 3,
      rpeAbovePlanned: -2,
      foodLogDaysLast7: 0,
      hasNutritionPlan: true,
      daysSinceWeight: 30,
    });
    expect(all.length).toBeLessThanOrEqual(12);
    expect(all[0]?.key).toBe('pain');
  });
});

describe('validateAnswers', () => {
  const questions = composeQuestions({ ...CALM, adherenceRate: 0.3, daysSinceWeight: null });
  const base = {
    pain: false,
    energy: 4,
    sleep: 3,
    stress: 2,
    motivation: 4,
    next_week: 'Semana normal',
    food_week: 'Segui o plano',
    barrier: 'Cansaço',
  };

  it('aceita respostas coerentes (peso e textos são opcionais)', () => {
    expect(() => validateAnswers(questions, base)).not.toThrow();
    expect(() =>
      validateAnswers(questions, { ...base, win: 'Fechei a semana toda', help_with: '' }),
    ).not.toThrow();
  });

  it('a pergunta de acompanhamento só vale quando a anterior pede', () => {
    expect(() => validateAnswers(questions, { ...base, pain_where: 'Joelho' })).toThrow(
      /só se responde/,
    );
    expect(() => validateAnswers(questions, { ...base, pain: true })).toThrow(/pain_where/);
    expect(() =>
      validateAnswers(questions, { ...base, pain: true, pain_where: 'Joelho' }),
    ).not.toThrow();
  });

  it('recusa faltante, fora da faixa, opção inventada e pergunta desconhecida', () => {
    expect(() => validateAnswers(questions, { pain: false, energy: 4 })).toThrow(AnswerError);
    expect(() => validateAnswers(questions, { ...base, energy: 9 })).toThrow(/1 a 5/);
    expect(() => validateAnswers(questions, { ...base, barrier: 'Marte' })).toThrow(/opções/);
    expect(() => validateAnswers(questions, { ...base, x: 1 })).toThrow(/desconhecida/);
    expect(() => validateAnswers(questions, { ...base, weight_kg: 5 })).toThrow(/plausível/);
  });
});
