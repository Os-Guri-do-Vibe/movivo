import { describe, expect, it } from 'vitest';

import type { PlanSession } from '@movivo/shared';

import {
  basalMetabolicRate,
  dayBounds,
  energyRangeFor,
  estimateExpenditure,
  weeklyLossPct,
} from './energy';
import { intenseSessionsPerWeek, isHeavyLower, isIntense, srpe, weeklyLoad } from './load';
import {
  hybridRules,
  nutritionRules,
  rulesLevel,
  runningRules,
  strengthRules,
  type HybridRules,
} from './params';
import { mondayOf, planWeek, type WeekOccurrence } from './week-planner';

const NUTRITION = {
  protein: { gPerKgByGoal: { FAT_LOSS: { gPerKg: { min: 1.8, max: 2.4 } } } },
  energy: {
    estimationMethod: 'MIFFLIN_ST_JEOR',
    deficitPct: { min: 15, max: 20 },
    surplusPct: { min: 5, max: 10 },
    recompositionDeficitPct: { min: 5, max: 10 },
    energyFloorKcal: { FEMALE: { kcal: 1300 }, MALE: { kcal: 1600 } },
  },
  micro: { fatMinGPerKg: 0.7, fiberGPer1000Kcal: 14, waterMlPerKg: 35 },
};

function session(overrides: Partial<PlanSession> & Pick<PlanSession, 'content'>): PlanSession {
  return {
    key: 'S1',
    title: 'Sessão',
    purpose: 'teste',
    priority: 'IMPORTANT',
    weeklyFrequency: 1,
    estimatedMinutes: 60,
    estimatedRpe: 6,
    ...overrides,
  } as PlanSession;
}

const STRENGTH_LOWER = {
  modality: 'STRENGTH',
  focus: 'Inferiores — quadríceps',
  exercises: [],
} as unknown as PlanSession['content'];
const INTERVALS = {
  modality: 'RUNNING',
  kind: 'INTERVALS',
  segments: [],
  terrain: 'ANY',
} as unknown as PlanSession['content'];

describe('params', () => {
  it('lê tabelas por nível e faixas', () => {
    const rules = strengthRules(
      {
        volume: { weeklySets: { INTERMEDIATE: { sets: { min: 10, max: 16 } } } },
        structure: { maxExercisesPerSession: 7 },
      },
      'INTERMEDIATE',
    );
    expect(rules.weeklySetsPerMuscle).toEqual({ min: 10, max: 16 });
    expect(rules.maxExercisesPerSession).toBe(7);
    expect(rules.deloadEveryWeeks).toBeNull();
  });

  it('campo ausente vira null; sem documento nenhuma regra', () => {
    expect(runningRules(undefined, 'BEGINNER').easySharePct).toBeNull();
    expect(hybridRules(undefined).allowTwoSessionsSameDay).toBe(false);
    expect(nutritionRules(undefined).proteinGPerKg).toEqual({});
  });

  it('NONE e ausência de nível contam como iniciante', () => {
    expect(rulesLevel('NONE')).toBe('BEGINNER');
    expect(rulesLevel(undefined)).toBe('BEGINNER');
    expect(rulesLevel('ADVANCED')).toBe('ADVANCED');
  });
});

describe('energia', () => {
  const body = { sex: 'MALE', ageYears: 30, heightCm: 180, weightKg: 80 } as const;
  const rules = nutritionRules(NUTRITION);

  it('Mifflin-St Jeor confere com o valor de referência', () => {
    expect(basalMetabolicRate(body, 'MIFFLIN_ST_JEOR')).toBe(1780);
  });

  it('Katch-McArdle só vale com % de gordura; sem ele cai em Mifflin', () => {
    expect(basalMetabolicRate(body, 'KATCH_MCARDLE')).toBe(1780);
    expect(basalMetabolicRate({ ...body, bodyFatPercent: 20 }, 'KATCH_MCARDLE')).toBe(
      Math.round(370 + 21.6 * 64),
    );
  });

  it('o dia de treino gasta mais que o de descanso', () => {
    const estimate = estimateExpenditure(body, [session({ content: STRENGTH_LOWER })], rules);
    expect(estimate.trainingDayKcal).toBeGreaterThan(estimate.restDayKcal);
  });

  it('déficit sai abaixo do gasto e respeita o piso do sexo', () => {
    const range = energyRangeFor('DEFICIT', 2_000, rules, 'MALE');
    expect(range).toEqual({ min: 1_600, max: 1_700 });
    expect(energyRangeFor('DEFICIT', 1_500, rules, 'FEMALE').min).toBe(1_300);
  });

  it('superávit e recomposição vão para lados opostos da manutenção', () => {
    expect(energyRangeFor('SURPLUS', 2_000, rules, 'MALE').min).toBeGreaterThan(2_000);
    expect(energyRangeFor('RECOMPOSITION', 2_000, rules, 'MALE').max).toBeLessThan(2_000);
  });

  it('limites do dia trazem proteína por kg e gordura mínima', () => {
    const bounds = dayBounds('DEFICIT', 2_400, body, rules, false);
    expect(bounds.proteinG).toEqual({ min: 144, max: 192 });
    expect(bounds.fatMinG).toBe(56);
    expect(bounds.waterMinMl).toBe(2_800);
  });

  it('perda semanal implícita cresce com o déficit', () => {
    const mild = weeklyLossPct(2_400, 2_100, 80);
    const harsh = weeklyLossPct(2_400, 1_600, 80);
    expect(harsh).toBeGreaterThan(mild);
    expect(weeklyLossPct(2_000, 2_200, 80)).toBe(0);
  });
});

describe('carga', () => {
  it('sRPE = PSE × minutos', () => {
    expect(srpe(7, 50)).toBe(350);
  });

  it('carga semanal soma frequência × carga e identifica intensas', () => {
    const lower = session({ content: STRENGTH_LOWER, weeklyFrequency: 2 });
    const run = session({ key: 'R1', content: INTERVALS, estimatedRpe: 8, estimatedMinutes: 45 });
    expect(weeklyLoad([lower, run])).toBe(360 * 2 + 360);
    expect(isIntense(run)).toBe(true);
    expect(isIntense(lower)).toBe(false);
    expect(intenseSessionsPerWeek([lower, run])).toBe(1);
    expect(isHeavyLower(lower)).toBe(true);
  });
});

describe('agenda da semana', () => {
  const rules: HybridRules = {
    hoursBetweenHeavyLowerAndIntenseRun: 48,
    maxIntenseSessionsPerWeek: 3,
    allowTwoSessionsSameDay: false,
    minRestDaysPerWeek: 1,
    acuteChronicMax: 1.3,
    weeklyLoadIncreaseMaxPct: 10,
  };
  const everyDay = { minutes: 90 };
  const windows = Object.fromEntries(
    ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => [
      d,
      [{ slot: 'EVENING', maxMinutes: everyDay.minutes }],
    ]),
  ) as never;
  const occ = (over: Partial<WeekOccurrence>): WeekOccurrence => ({
    planSessionKey: 'A',
    occurrence: 1,
    priority: 'IMPORTANT',
    minutes: 60,
    intense: false,
    heavyLower: false,
    intenseRun: false,
    ...over,
  });
  const base = {
    weekStart: '2026-11-02',
    notBefore: '2026-11-02',
    windows,
    rules,
    minEasyDaysBetweenIntense: 1,
  };

  it('mondayOf devolve a segunda-feira da semana', () => {
    expect(mondayOf('2026-11-05')).toBe('2026-11-02');
    expect(mondayOf('2026-11-08')).toBe('2026-11-02');
  });

  it('separa inferiores pesado de corrida intensa em 48 h', () => {
    const plan = planWeek({
      ...base,
      occurrences: [
        occ({ planSessionKey: 'LOW', heavyLower: true, priority: 'KEY' }),
        occ({ planSessionKey: 'RUN', intense: true, intenseRun: true, priority: 'KEY' }),
      ],
    });
    expect(plan.dropped).toHaveLength(0);
    const [a, b] = plan.assignments;
    const gap = Math.abs(Date.parse(a?.date ?? '') - Date.parse(b?.date ?? '')) / 86_400_000;
    expect(gap).toBeGreaterThanOrEqual(2);
  });

  it('não coloca duas sessões no mesmo dia e dá a vez à sessão-chave', () => {
    const only = { MON: [{ slot: 'EVENING', maxMinutes: 90 }] } as never;
    const plan = planWeek({
      ...base,
      windows: only,
      occurrences: [
        occ({ planSessionKey: 'COMP', priority: 'COMPLEMENTARY' }),
        occ({ planSessionKey: 'KEY', priority: 'KEY' }),
      ],
    });
    expect(plan.assignments.map((a) => a.planSessionKey)).toEqual(['KEY']);
    expect(plan.dropped.map((d) => d.planSessionKey)).toEqual(['COMP']);
  });

  it('sessão maior que a janela é descartada, nunca encaixada à força', () => {
    const plan = planWeek({ ...base, occurrences: [occ({ minutes: 150 })] });
    expect(plan.assignments).toHaveLength(0);
    expect(plan.dropped).toHaveLength(1);
  });

  it('respeita o teto de sessões intensas', () => {
    const plan = planWeek({
      ...base,
      rules: { ...rules, maxIntenseSessionsPerWeek: 1 },
      occurrences: [
        occ({ planSessionKey: 'I1', intense: true, priority: 'KEY' }),
        occ({ planSessionKey: 'I2', intense: true, priority: 'IMPORTANT' }),
      ],
    });
    expect(plan.assignments).toHaveLength(1);
  });

  it('mantém o descanso mínimo da semana', () => {
    const occurrences = Array.from({ length: 7 }, (_, i) =>
      occ({ planSessionKey: `S${i}`, priority: i === 0 ? 'KEY' : 'COMPLEMENTARY' }),
    );
    const plan = planWeek({ ...base, rules: { ...rules, minRestDaysPerWeek: 2 }, occurrences });
    expect(new Set(plan.assignments.map((a) => a.date)).size).toBeLessThanOrEqual(5);
  });

  it('semana de início parcial não agenda no passado', () => {
    const plan = planWeek({
      ...base,
      notBefore: '2026-11-05',
      occurrences: [occ({ occurrence: 1 }), occ({ occurrence: 2 })],
    });
    expect(plan.assignments.every((a) => a.date >= '2026-11-05')).toBe(true);
  });

  it('esporte externo com dia fixo ocupa o dia e entra no teto de intensidade', () => {
    const plan = planWeek({
      ...base,
      occurrences: [
        occ({
          planSessionKey: 'LUTA',
          fixedOn: '2026-11-03',
          intense: true,
          priority: 'IMPORTANT',
        }),
        occ({ planSessionKey: 'RUN', intense: true, intenseRun: true, priority: 'KEY' }),
      ],
    });
    const run = plan.assignments.find((a) => a.planSessionKey === 'RUN');
    expect(run).toBeDefined();
    expect(run?.date).not.toBe('2026-11-03');
    expect(plan.assignments.find((a) => a.planSessionKey === 'LUTA')?.date).toBe('2026-11-03');
  });
});
