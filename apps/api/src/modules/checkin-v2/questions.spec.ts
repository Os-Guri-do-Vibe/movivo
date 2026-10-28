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
  it('semana normal: poucas perguntas, sempre com a de segurança', () => {
    expect(keys(CALM)).toEqual(['pain', 'energy', 'sleep']);
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
    expect(all.length).toBeLessThanOrEqual(6);
    expect(all[0]?.key).toBe('pain');
  });
});

describe('validateAnswers', () => {
  const questions = composeQuestions({ ...CALM, adherenceRate: 0.3, daysSinceWeight: null });

  it('aceita respostas coerentes (peso é opcional)', () => {
    expect(() =>
      validateAnswers(questions, { pain: false, energy: 4, sleep: 3, barrier: 'Cansaço' }),
    ).not.toThrow();
  });

  it('recusa faltante, fora da faixa, opção inventada e pergunta desconhecida', () => {
    expect(() => validateAnswers(questions, { pain: false, energy: 4 })).toThrow(AnswerError);
    expect(() =>
      validateAnswers(questions, { pain: false, energy: 9, sleep: 3, barrier: 'Cansaço' }),
    ).toThrow(/1 a 5/);
    expect(() =>
      validateAnswers(questions, { pain: false, energy: 4, sleep: 3, barrier: 'Marte' }),
    ).toThrow(/opções/);
    expect(() =>
      validateAnswers(questions, { pain: false, energy: 4, sleep: 3, barrier: 'Cansaço', x: 1 }),
    ).toThrow(/desconhecida/);
    expect(() =>
      validateAnswers(questions, {
        pain: false,
        energy: 4,
        sleep: 3,
        barrier: 'Cansaço',
        weight_kg: 5,
      }),
    ).toThrow(/plausível/);
  });
});
