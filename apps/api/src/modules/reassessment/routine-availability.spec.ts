import { describe, expect, it } from 'vitest';

import type { CycleReassessmentAnswers, StudentConstraint } from '@movivo/shared';

import { availabilityFromRoutine } from './routine-availability';

type Availability = Extract<StudentConstraint, { kind: 'AVAILABILITY' }>;
type Routine = CycleReassessmentAnswers['routine'];

const current: Availability = {
  kind: 'AVAILABILITY',
  variesWeekly: false,
  maxSessionsPerWeek: 4,
  windows: [
    { weekday: 'MON', slot: 'MORNING', maxMinutes: 60 },
    { weekday: 'TUE', slot: 'MORNING', maxMinutes: 60 },
    { weekday: 'THU', slot: 'EVENING', maxMinutes: 75 },
    { weekday: 'SAT', slot: 'MORNING', maxMinutes: 90 },
  ],
};

const routine = (over: Partial<Routine> = {}): Routine => ({
  changed: true,
  daysPerWeek: null,
  sessionMinutes: null,
  notes: '',
  weekdays: [],
  slot: null,
  ...over,
});

describe('availabilityFromRoutine', () => {
  it('rotina que não mudou não mexe na disponibilidade', () => {
    expect(availabilityFromRoutine(routine({ changed: false }), current)).toBeNull();
  });

  it('os dias informados viram a nova disponibilidade, mantendo período e tempo do que já existia', () => {
    const result = availabilityFromRoutine(
      routine({ weekdays: ['MON', 'WED', 'THU'], daysPerWeek: 3 }),
      current,
    );
    expect(result?.constraint.maxSessionsPerWeek).toBe(3);
    expect(result?.constraint.windows).toEqual([
      { weekday: 'MON', slot: 'MORNING', maxMinutes: 60 }, // já existia
      { weekday: 'WED', slot: 'ANY', maxMinutes: 90 }, // dia novo: tempo mais longo que ele já tinha
      { weekday: 'THU', slot: 'EVENING', maxMinutes: 75 },
    ]);
  });

  it('período e minutos informados valem para todos os dias', () => {
    const result = availabilityFromRoutine(
      routine({ weekdays: ['TUE', 'FRI'], slot: 'EVENING', sessionMinutes: 40 }),
      current,
    );
    expect(result?.constraint.windows).toEqual([
      { weekday: 'TUE', slot: 'EVENING', maxMinutes: 40 },
      { weekday: 'FRI', slot: 'EVENING', maxMinutes: 40 },
    ]);
  });

  it('sem disponibilidade anterior, usa 60 minutos quando ele não disse o tempo', () => {
    const result = availabilityFromRoutine(routine({ weekdays: ['MON'] }), null);
    expect(result?.constraint.windows).toEqual([{ weekday: 'MON', slot: 'ANY', maxMinutes: 60 }]);
  });

  it('só os minutos: ajusta o tempo de todas as janelas', () => {
    const result = availabilityFromRoutine(routine({ sessionMinutes: 30 }), current);
    expect(result?.constraint.windows.every((w) => w.maxMinutes === 30)).toBe(true);
    expect(result?.constraint.maxSessionsPerWeek).toBe(4);
  });

  it('pediu mais dias do que há janela: usa os dias que existem e avisa', () => {
    const result = availabilityFromRoutine(routine({ daysPerWeek: 6 }), current);
    expect(result?.constraint.maxSessionsPerWeek).toBe(4);
    expect(result?.note).toContain('só há janela cadastrada em 4');
  });

  it('nada a ajustar devolve nulo', () => {
    expect(availabilityFromRoutine(routine(), current)).toBeNull();
  });
});
