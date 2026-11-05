import { describe, expect, it } from 'vitest';

import type { ModalityExperience, TrainingVenue } from '@movivo/shared';

import type { HybridRules } from './calc/params';
import { catalogProfileOf, fallbackSessionPlan, sessionLimitsOf, venueOf } from './inputs';
import { parseStateView } from './state-view';

const strength: ModalityExperience = {
  modality: 'STRENGTH',
  level: 'INTERMEDIATE',
  wantsToStart: false,
};

const viewOf = (venues: TrainingVenue[], modalities: ModalityExperience[] = [strength]) =>
  parseStateView({
    availability: [
      {
        kind: 'AVAILABILITY',
        windows: ['MON', 'TUE', 'WED', 'THU', 'FRI'].map((weekday) => ({
          weekday,
          slot: 'EVENING',
          maxMinutes: 60,
        })),
        variesWeekly: false,
        maxSessionsPerWeek: 3,
      },
    ],
    training: {
      venues,
      modalities,
      externalSports: [
        {
          sport: 'MARTIAL_ARTS',
          label: 'Jiu-jitsu',
          sessionsPerWeek: 3,
          minutesPerSession: 60,
          typicalRpe: 7,
          fixedDays: ['MON', 'WED', 'FRI'],
        },
      ],
    },
  });

describe('local por modalidade', () => {
  it('perfil antigo: a ordem dos cliques não decide o local da musculação', () => {
    const view = viewOf(['OUTDOOR', 'FULL_GYM']);
    expect(venueOf(view, 'STRENGTH')).toBe('FULL_GYM');
    expect(catalogProfileOf(view).location).toBe('FULL_GYM');
    expect(venueOf(view, 'RUNNING')).toBe('OUTDOOR');
  });

  it('o local escolhido para a modalidade vale', () => {
    const view = viewOf(['OUTDOOR', 'FULL_GYM'], [{ ...strength, venue: 'HOME' }]);
    expect(venueOf(view, 'STRENGTH')).toBe('HOME');
    expect(catalogProfileOf(view).location).toBe('HOME');
  });
});

const rules = (over: Partial<HybridRules> = {}): HybridRules => ({
  hoursBetweenHeavyLowerAndIntenseRun: 24,
  maxIntenseSessionsPerWeek: 3,
  allowTwoSessionsSameDay: true,
  minRestDaysPerWeek: 1,
  acuteChronicMax: null,
  weeklyLoadIncreaseMaxPct: null,
  ...over,
});

describe('teto de sessões por semana', () => {
  it('parte dos dias que o aluno pode treinar (a vista tem 5), não do número que ele escolheu', () => {
    const limits = sessionLimitsOf(viewOf(['FULL_GYM']), rules());
    expect(limits).toMatchObject({ availableDays: 5, maxTrainingDays: 5, minRestDays: 1 });
  });

  it('reserva o descanso mínimo: com 7 dias livres treina no máximo 6', () => {
    const view = parseStateView({
      availability: [
        {
          kind: 'AVAILABILITY',
          windows: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((weekday) => ({
            weekday,
            slot: 'MORNING',
            maxMinutes: 60,
          })),
          variesWeekly: false,
          maxSessionsPerWeek: 7,
        },
      ],
      training: { venues: ['FULL_GYM'], modalities: [strength], externalSports: [] },
    });
    expect(sessionLimitsOf(view, rules({ allowTwoSessionsSameDay: false }))).toMatchObject({
      maxTrainingDays: 6,
      maxSessions: 6,
    });
  });

  it('sessão dupla só entra quando a metodologia permite: uma a cada dois dias de treino', () => {
    const view = viewOf(['FULL_GYM']);
    expect(sessionLimitsOf(view, rules({ allowTwoSessionsSameDay: false })).maxSessions).toBe(5);
    expect(sessionLimitsOf(view, rules()).maxSessions).toBe(7);
  });
});

describe('frequência de respaldo', () => {
  it('divide por igual, com a sobra para a modalidade mais prioritária', () => {
    const plan = fallbackSessionPlan(viewOf(['FULL_GYM']), ['STRENGTH', 'RUNNING'], rules());
    expect(plan.weekly).toBe(3);
    expect(plan.byModality).toEqual([
      { modality: 'STRENGTH', sessions: 2 },
      { modality: 'RUNNING', sessions: 1 },
    ]);
  });
});
