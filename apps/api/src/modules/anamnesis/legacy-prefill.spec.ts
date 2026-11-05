import { describe, expect, it } from 'vitest';

import { ONBOARDING_STEP_SCHEMAS } from '@movivo/shared';

import {
  legacyPrefill,
  withExternalSportsInWeek,
  withModalityVenues,
  withSessionsWithinDays,
} from './legacy-prefill';

const v1 = {
  primaryGoal: 'LOSE_FAT',
  emphasis: [],
  hasImportantEvent: false,
  trainingStatus: 'REGULAR',
  experience: 'BEGINNER',
  pastActivities: [],
  consistencyBarriers: [],
  daysPerWeek: 5,
  preferredDays: ['TUE', 'THU', 'SAT'],
  sessionDuration: 'M45_TO_60',
  location: 'HOME',
  preferredPeriod: 'MORNING',
  practicesOtherSport: false,
  hasAvoidedExercise: false,
};

describe('pré-preenchimento da anamnese antiga', () => {
  it('sai no formato atual: local na musculação e treinos dentro dos dias', () => {
    const blocks = legacyPrefill(null, v1);
    const modalities = ONBOARDING_STEP_SCHEMAS[3].parse(blocks.modalities);
    expect(modalities.modalities).toEqual([expect.objectContaining({ venue: 'HOME' })]);
    expect(blocks.modalities).not.toHaveProperty('venues');
    // A anamnese antiga não perguntava o esporte externo: fica para o aluno responder na semana.
    expect(blocks.modalities).not.toHaveProperty('externalSports');
    expect(blocks.routine).not.toHaveProperty('externalSports');
    const routine = ONBOARDING_STEP_SCHEMAS[4].parse({
      ...(blocks.routine as object),
      lifeContext: {},
    });
    expect(routine.maxSessionsPerWeek).toBe(3);
  });
});

describe('etapas salvas no formato anterior', () => {
  it('modalidade sem local herda o mais completo da lista antiga', () => {
    const block = withModalityVenues({
      modalities: [
        { modality: 'STRENGTH', level: 'BEGINNER', wantsToStart: false },
        { modality: 'RUNNING', level: 'NONE', wantsToStart: true },
      ],
      externalSports: [],
      venues: ['OUTDOOR', 'FULL_GYM'],
    });
    const parsed = ONBOARDING_STEP_SCHEMAS[3].parse(block);
    expect(parsed.modalities.map((m) => m.venue)).toEqual(['FULL_GYM', 'OUTDOOR']);
  });

  it('treinos por semana acima dos dias marcados são limitados aos dias', () => {
    const block = withSessionsWithinDays({
      windows: [
        { weekday: 'MON', slot: 'EVENING', maxMinutes: 60 },
        { weekday: 'WED', slot: 'EVENING', maxMinutes: 60 },
      ],
      variesWeekly: false,
      maxSessionsPerWeek: 5,
      lifeContext: {},
    });
    expect(ONBOARDING_STEP_SCHEMAS[4].parse(block).maxSessionsPerWeek).toBe(2);
  });

  describe('esporte externo respondido na etapa 3', () => {
    const swimming = {
      sport: 'SWIMMING',
      label: 'Natação',
      sessionsPerWeek: 2,
      minutesPerSession: 60,
      typicalRpe: 5,
      fixedDays: ['TUE'],
    };
    const modalities = {
      modalities: [{ modality: 'STRENGTH', level: 'NONE', wantsToStart: true, venue: 'HOME' }],
      externalSports: [swimming],
    };
    const routine = {
      windows: [{ weekday: 'MON', slot: 'EVENING', maxMinutes: 60 }],
      variesWeekly: false,
      maxSessionsPerWeek: 1,
      lifeContext: {},
    };

    it('vai para a semana e sai das modalidades', () => {
      const week = withExternalSportsInWeek(modalities, routine);
      expect(week.modalities).not.toHaveProperty('externalSports');
      expect(ONBOARDING_STEP_SCHEMAS[4].parse(week.routine).externalSports).toEqual([swimming]);
      expect(ONBOARDING_STEP_SCHEMAS[3].safeParse(week.modalities).success).toBe(true);
    });

    it('a semana que já tem o campo ganha, e sem semana salva nada é criado', () => {
      const answered = { ...routine, externalSports: [] };
      expect(withExternalSportsInWeek(modalities, answered).routine).toBe(answered);
      expect(withExternalSportsInWeek(modalities, undefined).routine).toBeUndefined();
    });

    it('etapa 3 já no formato novo não muda nada', () => {
      const current = { modalities: modalities.modalities };
      expect(withExternalSportsInWeek(current, routine)).toEqual({ modalities: current, routine });
    });
  });
});
