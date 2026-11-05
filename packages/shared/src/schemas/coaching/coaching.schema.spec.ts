import { describe, expect, it } from 'vitest';

import { measurementInputSchema } from '../body/body.schema';
import { checkInQuestionSchema } from '../check-in/check-in.schema';
import { nutritionPlanStructureSchema } from '../nutrition/nutrition.schema';
import {
  ACTION_DOMAIN,
  coachingActionSchema,
  coachingActionTypeSchema,
  coachingProposalSchema,
} from './coaching.schema';

describe('catálogo de ações', () => {
  it('a lista de tipos acompanha a união discriminada e todo tipo tem domínio', () => {
    const fromUnion = coachingActionSchema.options.map((option) => option.shape.type.value).sort();
    expect([...coachingActionTypeSchema.options].sort()).toEqual(fromUnion);
    expect(Object.keys(ACTION_DOMAIN).sort()).toEqual(fromUnion);
  });

  it('proposta exige justificativa e resultado esperado', () => {
    const proposal = {
      action: {
        type: 'SUBSTITUTE_EXERCISE',
        planSessionKey: 'STR_A',
        fromExerciseId: 'agachamento_livre',
        toExerciseId: 'leg_press_45',
        reason: 'PREFERENCE',
        scope: 'PLAN',
      },
      rationale: ['Aluno não gosta do agachamento livre; leg press preserva o estímulo.'],
      evidence: ['preference:exercise:agachamento_livre=DISLIKES'],
      assumptions: [],
      uncertainty: 'LOW',
      expectedOutcome: 'Sessão A concluída nas próximas 2 semanas.',
    };
    expect(coachingProposalSchema.safeParse(proposal).success).toBe(true);
    expect(coachingProposalSchema.safeParse({ ...proposal, rationale: [] }).success).toBe(false);
  });

  it('rejeita ajuste de volume fora dos limites estruturais', () => {
    expect(
      coachingActionSchema.safeParse({
        type: 'ADJUST_WEEKLY_VOLUME',
        modality: 'RUNNING',
        percentChange: 80,
        weeks: 1,
      }).success,
    ).toBe(false);
  });
});

describe('outros contratos', () => {
  it('plano alimentar exige distribuição de energia somando 100%', () => {
    const targets = {
      energyKcal: { min: 2_000, max: 2_200 },
      proteinG: 150,
      carbsG: 220,
      fatG: 70,
      fiberG: 30,
      waterMl: 2_500,
    };
    const meal = (slot: string, energyShare: number) => ({
      slot,
      energyShare,
      proteinG: 35,
      guidance: 'Proteína magra + carboidrato + vegetais',
      examples: ['Arroz, feijão, frango e salada'],
    });
    const plan = {
      strategy: 'RECOMPOSITION',
      summary: 'Leve déficit com proteína alta',
      trainingDay: targets,
      restDay: targets,
      meals: [meal('BREAKFAST', 0.3), meal('LUNCH', 0.4), meal('DINNER', 0.3)],
      guidelines: ['Beba água ao longo do dia'],
      supplements: [],
    };
    expect(nutritionPlanStructureSchema.safeParse(plan).success).toBe(true);
    expect(
      nutritionPlanStructureSchema.safeParse({
        ...plan,
        meals: [meal('BREAKFAST', 0.3), meal('LUNCH', 0.3)],
      }).success,
    ).toBe(false);
  });

  it('medida corporal fora da faixa plausível é rejeitada', () => {
    const base = { kind: 'WAIST', method: 'SELF_TAPE', measuredOn: '2026-10-27' } as const;
    expect(measurementInputSchema.safeParse({ ...base, value: 92 }).success).toBe(true);
    expect(measurementInputSchema.safeParse({ ...base, value: 920 }).success).toBe(false);
  });

  it('pergunta de check-in tem opções se e somente se for de escolha', () => {
    const base = { key: 'barreira', prompt: 'O que atrapalhou?', reason: 'Queda de adesão' };
    expect(
      checkInQuestionSchema.safeParse({ ...base, type: 'CHOICE', options: ['Tempo', 'Cansaço'] })
        .success,
    ).toBe(true);
    expect(checkInQuestionSchema.safeParse({ ...base, type: 'CHOICE' }).success).toBe(false);
    expect(
      checkInQuestionSchema.safeParse({ ...base, type: 'TEXT', options: ['a', 'b'] }).success,
    ).toBe(false);
  });
});
