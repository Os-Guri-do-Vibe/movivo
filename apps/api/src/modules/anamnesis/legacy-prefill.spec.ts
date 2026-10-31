import { describe, expect, it } from 'vitest';

import { ONBOARDING_STEP_SCHEMAS } from '@movivo/shared';

import { legacyPrefill, withModalityVenues, withSessionsWithinDays } from './legacy-prefill';

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
        { modality: 'STRENGTH', level: 'BEGINNER', sessionsPerWeek: 2, wantsToStart: false },
        { modality: 'RUNNING', level: 'NONE', sessionsPerWeek: 0, wantsToStart: true },
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
});
