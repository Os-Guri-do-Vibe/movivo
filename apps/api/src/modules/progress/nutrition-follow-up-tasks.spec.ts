import { describe, expect, it } from 'vitest';

import type { ValidationContext } from '../../core/agents/agent-task';
import {
  nutritionFollowUpValidators,
  type NutritionFollowUp,
  type NutritionFollowUpInput,
} from './nutrition-follow-up-tasks';

const ctx: ValidationContext = { state: {}, methodology: {} };

const input = (over: Partial<NutritionFollowUpInput['week']> = {}): NutritionFollowUpInput => ({
  planSlots: ['BREAKFAST', 'LUNCH', 'DINNER'],
  targets: {
    trainingDayKcal: { min: 2_300, max: 2_500 },
    restDayKcal: { min: 2_000, max: 2_200 },
    proteinG: 150,
    fiberG: 30,
  },
  energyFloorKcal: 1_200,
  goalDirection: 'LOSE',
  week: {
    loggedDays: 5,
    fullDays: 5,
    avgEnergyKcal: 2_100,
    avgProteinG: 120,
    avgFiberG: 22,
    energyRatio: 0.97,
    proteinRatio: 0.8,
    fiberRatio: 0.73,
    daysBySlot: { BREAKFAST: 5, LUNCH: 5, DINNER: 3 },
    checkIn: { onTrack: 3, partial: 1, off: 0 },
    weight: {
      points: 4,
      firstKg: 80,
      lastKg: 79.9,
      slopeKgPerWeek: -0.05,
      history: [],
      lastChangeKg: -0.1,
      daysSinceLast: 7,
    },
    ...over,
  },
  loadMetrics: null,
  daysSinceLastFollowUp: 7,
  openCommitments: [],
});

const reading = (over: Partial<NutritionFollowUp> = {}): NutritionFollowUp => ({
  status: 'NEEDS_ADJUSTMENT',
  findings: [
    { topic: 'PROTEIN', statement: 'A proteína ficou em 80% da meta, mais baixa no jantar.' },
  ],
  adjustment: { kind: 'NONE' },
  nextStep: 'Incluir uma fonte de proteína no jantar em 4 dias desta semana.',
  question: null,
  commitmentReview: [],
  ...over,
});

const run = async (i: NutritionFollowUpInput, o: NutritionFollowUp) =>
  (await Promise.all(nutritionFollowUpValidators.map((v) => v(i, o, ctx)))).flat();

describe('nutritionFollowUpValidators', () => {
  it('aceita orientação de refeição sem mexer na energia', async () => {
    expect(
      await run(
        input(),
        reading({
          adjustment: {
            kind: 'MEAL_GUIDANCE',
            slot: 'DINNER',
            guidance: 'Comece o jantar pela proteína e complete o prato com legumes.',
            examples: ['Frango grelhado, arroz e brócolis'],
            reason: 'Proteína baixa no jantar em 3 dias.',
          },
        }),
      ),
    ).toEqual([]);
  });

  it('o nutricionista decide quando ajustar a energia: não há regra mínima de dados', async () => {
    const adjust = reading({
      adjustment: {
        kind: 'ENERGY',
        deltaKcal: -150,
        reason: 'Peso estável há semanas com adesão alta.',
      },
    });
    expect(await run(input(), adjust)).toEqual([]);
    const thin = input({
      fullDays: 2,
      weight: {
        points: 1,
        firstKg: 80,
        lastKg: 80,
        slopeKgPerWeek: null,
        history: [],
        lastChangeKg: null,
        daysSinceLast: 7,
      },
    });
    expect(await run(thin, adjust)).toEqual([]);
  });

  it('aceita refazer a estrutura do plano de forma permanente', async () => {
    expect(
      await run(
        input(),
        reading({
          adjustment: {
            kind: 'REBUILD_PLAN',
            instruction:
              'Passar para 5 refeições com lanche pré-treino e jantar mais cedo, mantendo a proteína.',
            reason: 'A rotina de trabalho mudou e o cardápio atual não cabe mais.',
          },
        }),
      ),
    ).toEqual([]);
  });

  it('exige o veredito de todo compromisso em aberto, e só deles', async () => {
    const id = '5c6a8f0e-1b0a-4f43-8a0b-3d1f4f2d9a11';
    const withOpen = {
      ...input(),
      openCommitments: [
        {
          id,
          text: 'Incluir proteína no jantar 4 vezes',
          createdOn: '2026-10-25',
          dueOn: '2026-11-01',
        },
      ],
    };
    expect((await run(withOpen, reading())).map((v) => v.path)).toContain('commitmentReview');
    expect(
      await run(
        withOpen,
        reading({
          commitmentReview: [{ id, verdict: 'KEPT', evidence: 'Jantar com proteína em 4 dias.' }],
        }),
      ),
    ).toEqual([]);
    expect(
      (
        await run(
          input(),
          reading({
            commitmentReview: [{ id, verdict: 'KEPT', evidence: 'Jantar com proteína em 4 dias.' }],
          }),
        )
      ).map((v) => v.message),
    ).toEqual([expect.stringMatching(/desconhecido/)]);
  });

  it('nunca leva a energia abaixo do piso de segurança', async () => {
    const low = input();
    low.targets.restDayKcal = { min: 1_250, max: 1_400 };
    const violations = await run(
      low,
      reading({
        adjustment: { kind: 'ENERGY', deltaKcal: -100, reason: 'Peso parado com adesão alta.' },
      }),
    );
    expect(violations.map((v) => v.path)).toContain('adjustment.deltaKcal');
  });
});
