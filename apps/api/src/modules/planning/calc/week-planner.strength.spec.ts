import { describe, expect, it } from 'vitest';

import type { PlanSession, TrainingPlanStructure, Weekday } from '@movivo/shared';

import { checkTrainingPlan, occurrencesOf, windowsByWeekday } from './plan-check';
import type { HybridRules } from './params';
import { planWeek } from './week-planner';

const rules: HybridRules = {
  hoursBetweenHeavyLowerAndIntenseRun: 24,
  maxIntenseSessionsPerWeek: 3,
  allowTwoSessionsSameDay: true,
  minRestDaysPerWeek: 1,
  acuteChronicMax: 1.3,
  weeklyLoadIncreaseMaxPct: 10,
} as HybridRules;

const fullBody = (key: string, priority: PlanSession['priority'] = 'KEY'): PlanSession =>
  ({
    key,
    title: key,
    purpose: 'x',
    priority,
    weeklyFrequency: 1,
    estimatedMinutes: 42,
    estimatedRpe: 7,
    content: { modality: 'STRENGTH', focus: 'Peito, costas, quadríceps e glúteo', exercises: [] },
  }) as unknown as PlanSession;
const run = (key: string, kind: string, rpe: number): PlanSession =>
  ({
    key,
    title: key,
    purpose: 'x',
    priority: 'KEY',
    weeklyFrequency: 1,
    estimatedMinutes: 45,
    estimatedRpe: rpe,
    content: { modality: 'RUNNING', kind, segments: [], terrain: 'ANY' },
  }) as unknown as PlanSession;

const monToSat: Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const windows = monToSat.map((weekday) => ({ weekday, slot: 'ANY' as const, maxMinutes: 45 }));
const week = (sessions: PlanSession[], notBefore = '2026-11-09') =>
  planWeek({
    weekStart: '2026-11-09',
    notBefore,
    windows: windowsByWeekday(windows),
    occurrences: occurrencesOf(sessions, {}, '2026-11-09'),
    rules,
    // A metodologia de corrida pede 2 dias leves entre treinos de qualidade.
    minEasyDaysBetweenIntense: 2,
  });
const dayOf = (plan: ReturnType<typeof week>, key: string) =>
  plan.assignments.find((a) => a.planSessionKey === key)?.date;

describe('agenda: musculação e corrida na mesma semana', () => {
  // O caso do Rodrigo: 3 corpo todo (PSE 7) + fartlek + longão, segunda a sábado.
  const sessions = [
    fullBody('FULL_A', 'COMPLEMENTARY'),
    fullBody('FULL_B'),
    fullBody('FULL_C'),
    run('FARTLEK', 'FARTLEK', 6.5),
    run('LONG', 'LONG', 4),
  ];

  it('os dias leves entre treinos de qualidade da corrida não valem entre musculações: as 5 entram', () => {
    for (const notBefore of ['2026-11-09', '2026-11-10']) {
      const plan = week(sessions, notBefore);
      expect(plan.dropped).toEqual([]);
      expect(plan.assignments).toHaveLength(5);
    }
  });

  it('musculações de inferiores pesados ficam com ao menos 48 h entre elas', () => {
    const plan = week(sessions);
    const days = ['FULL_A', 'FULL_B', 'FULL_C']
      .map((key) => Date.parse(`${dayOf(plan, key)}T00:00:00Z`) / 86_400_000)
      .sort((a, b) => a - b);
    for (let i = 1; i < days.length; i += 1) {
      expect((days[i] as number) - (days[i - 1] as number)).toBeGreaterThanOrEqual(2);
    }
  });

  it('entre corridas de qualidade a regra da corrida continua valendo', () => {
    const plan = week([run('Q1', 'INTERVALS', 8), run('Q2', 'TEMPO', 7)]);
    const [a, b] = ['Q1', 'Q2'].map((key) => Date.parse(`${dayOf(plan, key)}T00:00:00Z`));
    expect(Math.abs((a as number) - (b as number)) / 86_400_000).toBeGreaterThan(2);
  });

  it('sessão complementar que nunca entraria na agenda vira erro do plano, não some calada', () => {
    const tooMany: TrainingPlanStructure = {
      summary: 'x',
      modalityPriorities: [{ modality: 'STRENGTH', priority: 1 }],
      phases: [{ name: 'x', focus: 'x', weeks: 4, endsWithDeload: false }],
      sessions: ['A', 'B', 'C', 'D'].map((key, i) =>
        fullBody(key, i === 3 ? 'COMPLEMENTARY' : 'KEY'),
      ),
    };
    const found = checkTrainingPlan(tooMany, {
      windows: windows.slice(0, 3),
      maxSessionsPerWeek: 6,
      externalFixedDays: {},
      focus: ['STRENGTH'],
      rules: { ...rules, maxIntenseSessionsPerWeek: null },
      minEasyDaysBetweenIntense: 2,
      recentWeeklyLoad: null,
      startsOn: '2026-11-09',
    }).map((v) => v.message);
    expect(found.join(' | ')).toContain('nunca entraria na agenda');
  });
});
