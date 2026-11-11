import { describe, expect, it } from 'vitest';

import type { PlanSession, TrainingPlanStructure, Weekday } from '@movivo/shared';

import { checkTrainingPlan, occurrencesOf, type PlanCheckContext } from './plan-check';

const session = (
  key: string,
  over: Partial<PlanSession> = {},
  modality: 'STRENGTH' | 'RUNNING' = 'STRENGTH',
): PlanSession =>
  ({
    key,
    title: `Sessão ${key}`,
    purpose: 'teste',
    priority: 'KEY',
    weeklyFrequency: 1,
    estimatedMinutes: 45,
    estimatedRpe: 5,
    content:
      modality === 'STRENGTH'
        ? { modality, focus: 'Corpo todo', exercises: [] }
        : { modality, kind: 'EASY', segments: [], terrain: 'ANY' },
    ...over,
  }) as unknown as PlanSession;

const days: Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const context = (over: Partial<PlanCheckContext> = {}): PlanCheckContext => ({
  windows: days.map((weekday) => ({ weekday, slot: 'EVENING', maxMinutes: 45 })),
  maxSessionsPerWeek: 5,
  externalFixedDays: {},
  focus: [],
  rules: {
    minRestDaysPerWeek: 1,
    allowTwoSessionsSameDay: false,
    hoursBetweenHeavyLowerAndIntenseRun: null,
    weeklyLoadIncreaseMaxPct: null,
  } as never,
  minEasyDaysBetweenIntense: 0,
  recentWeeklyLoad: null,
  startsOn: '2026-11-09',
  ...over,
});
const plan = (sessions: PlanSession[]): TrainingPlanStructure =>
  ({
    summary: 'x',
    modalityPriorities: [
      { modality: 'STRENGTH', priority: 1 },
      { modality: 'RUNNING', priority: 2 },
    ],
    phases: [{ name: 'Base', focus: 'x', weeks: 4, endsWithDeload: false }],
    sessions,
  }) as TrainingPlanStructure;

describe('dias definidos pelo profissional', () => {
  it('cada ocorrência cai no dia marcado; sem marcação, o planejador decide', () => {
    const run = session('RUN', { weeklyFrequency: 2, weekdays: ['TUE', 'SAT'] }, 'RUNNING');
    const free = session('A');
    const occurrences = occurrencesOf([run, free], {}, '2026-11-09');
    expect(occurrences.map((o) => [o.planSessionKey, o.occurrence, o.fixedOn])).toEqual([
      ['RUN', 1, '2026-11-10'],
      ['RUN', 2, '2026-11-14'],
      ['A', 1, undefined],
    ]);
  });

  it('esporte externo continua usando os dias do perfil, não o campo do protocolo', () => {
    const external = {
      ...session('EXT'),
      weekdays: ['MON'],
      content: {
        modality: 'EXTERNAL_SPORT',
        sport: 'SWIMMING',
        label: 'Natação',
        plannedMinutes: 45,
        plannedRpe: 5,
      },
    } as unknown as PlanSession;
    expect(occurrencesOf([external], { EXT: ['WED'] }, '2026-11-09')[0]?.fixedOn).toBe(
      '2026-11-11',
    );
    expect(occurrencesOf([external], {}, '2026-11-09')[0]?.fixedOn).toBeUndefined();
  });

  it('recusa dia sem horário do aluno e dois treinos no mesmo dia quando a metodologia não deixa', () => {
    const sundays = plan([session('A', { weekdays: ['SUN'] })]);
    expect(checkTrainingPlan(sundays, context()).map((v) => v.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('não tem horário livre de 45 min na domingo'),
      ]),
    );
    const same = plan([session('A', { weekdays: ['MON'] }), session('B', { weekdays: ['MON'] })]);
    expect(checkTrainingPlan(same, context()).map((v) => v.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('2 treinos na segunda-feira')]),
    );
  });

  it('aceita a semana inteira marcada dentro da disponibilidade', () => {
    const week = plan([
      session('A', { weekdays: ['MON'] }),
      session('B', { weekdays: ['WED'] }),
      session('C', { weekdays: ['FRI'] }),
      session('RUN', { weeklyFrequency: 2, weekdays: ['TUE', 'SAT'] }, 'RUNNING'),
    ]);
    const found = checkTrainingPlan(week, context({ focus: ['STRENGTH', 'RUNNING'] }));
    expect(found.filter((v) => /horário|treinos na/.test(v.message))).toEqual([]);
  });
});
