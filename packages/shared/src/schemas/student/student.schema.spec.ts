import { describe, expect, it } from 'vitest';

import { goalStrategySchema } from './goal.schema';
import { constraintKindSchema, constraintSchema, preferenceSchema } from './student-state.schema';

describe('preferências do aluno', () => {
  const base = {
    domain: 'EXERCISE',
    key: 'exercise:agachamento_livre',
    value: 'DISLIKES',
    confidence: 40,
  } as const;

  it('preferência inferida não pode ser obrigatória', () => {
    expect(
      preferenceSchema.safeParse({ ...base, origin: 'INFERRED', strength: 'REQUIRED' }).success,
    ).toBe(false);
    expect(
      preferenceSchema.safeParse({ ...base, origin: 'INFERRED', strength: 'HYPOTHESIS' }).success,
    ).toBe(true);
    expect(
      preferenceSchema.safeParse({ ...base, origin: 'DECLARED', strength: 'REQUIRED' }).success,
    ).toBe(true);
  });
});

describe('restrições do aluno', () => {
  it('a lista de tipos acompanha a união discriminada', () => {
    const fromUnion = constraintSchema.options.map((option) => option.shape.kind.value).sort();
    expect([...constraintKindSchema.options].sort()).toEqual(fromUnion);
  });

  it('disponibilidade exige ao menos uma janela', () => {
    expect(
      constraintSchema.safeParse({
        kind: 'AVAILABILITY',
        windows: [],
        variesWeekly: true,
        maxSessionsPerWeek: 3,
      }).success,
    ).toBe(false);
  });
});

describe('estratégia do Motor de Objetivos', () => {
  it('exige justificativa e ao menos um indicador', () => {
    const strategy = {
      title: 'Recomposição corporal',
      rationale: ['Gordura corporal alta com objetivo de hipertrofia: priorizar recomposição.'],
      energyStrategy: 'RECOMPOSITION',
      modalityFocus: ['STRENGTH'],
      indicators: [
        {
          key: 'waist_cm',
          label: 'Cintura',
          source: 'BODY',
          direction: 'DECREASE',
          unit: 'cm',
        },
      ],
      reviewAfterWeeks: 6,
      openQuestions: [],
    };
    expect(goalStrategySchema.safeParse(strategy).success).toBe(true);
    expect(goalStrategySchema.safeParse({ ...strategy, rationale: [] }).success).toBe(false);
    expect(goalStrategySchema.safeParse({ ...strategy, indicators: [] }).success).toBe(false);
  });
});
