import { describe, expect, it } from 'vitest';

import type { ModalityExperience, TrainingVenue } from '@movivo/shared';

import { catalogProfileOf, coachedBudget, sessionsPerWeekAvailable, venueOf } from './inputs';
import { parseStateView } from './state-view';

const strength: ModalityExperience = {
  modality: 'STRENGTH',
  level: 'INTERMEDIATE',
  sessionsPerWeek: 3,
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

describe('orçamento de sessões', () => {
  it('o teto é de sessões próprias: o esporte externo não desconta', () => {
    const view = viewOf(['FULL_GYM']);
    expect(sessionsPerWeekAvailable(view)).toBe(3);
    expect(coachedBudget(view, 2)).toBe(3);
  });
});
