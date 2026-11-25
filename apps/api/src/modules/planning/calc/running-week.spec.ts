import { describe, expect, it } from 'vitest';

import {
  isStarter,
  requiredRoleCounts,
  roleOfKind,
  runningWeekRoles,
  type RunningWeekInput,
} from './running-week';

const base: RunningWeekInput = {
  sessions: 3,
  goal: 'PERFORMANCE',
  phase: 'BASE',
  level: 'BEGINNER',
  qualityMax: 1,
  starter: false,
};

describe('papéis da semana de corrida', () => {
  it('duas corridas: uma de qualidade e um longão, não duas leves', () => {
    expect(runningWeekRoles({ ...base, sessions: 2 })).toEqual(['QUALITY', 'LONG']);
  });

  it('três corridas: qualidade, longão e uma leve de base', () => {
    expect(runningWeekRoles(base)).toEqual(['QUALITY', 'LONG', 'EASY']);
  });

  it('uma corrida por semana de quem quer evoluir é de qualidade; por saúde, leve', () => {
    expect(runningWeekRoles({ ...base, sessions: 1 })).toEqual(['QUALITY']);
    expect(runningWeekRoles({ ...base, sessions: 1, goal: 'FITNESS', qualityMax: 0 })).toEqual([
      'EASY',
    ]);
  });

  it('o teto de qualidade da metodologia vale; zero tira a qualidade', () => {
    expect(runningWeekRoles({ ...base, sessions: 4, qualityMax: 0 })).toEqual([
      'LONG',
      'EASY',
      'EASY',
      'EASY',
    ]);
  });

  it('duas sessões de qualidade só para quem já tem nível, em construção ou pico, com 4+ corridas', () => {
    const advanced = {
      ...base,
      sessions: 4,
      level: 'INTERMEDIATE' as const,
      phase: 'BUILD' as const,
      qualityMax: 2,
    };
    expect(runningWeekRoles(advanced)).toEqual(['QUALITY', 'QUALITY', 'LONG', 'EASY']);
    expect(runningWeekRoles({ ...advanced, level: 'BEGINNER' })).toEqual([
      'QUALITY',
      'LONG',
      'EASY',
      'EASY',
    ]);
    expect(
      runningWeekRoles({ ...advanced, phase: 'BASE' }).filter((r) => r === 'QUALITY'),
    ).toHaveLength(1);
  });

  it('cinco corridas ou mais ganham uma sessão de apoio', () => {
    expect(runningWeekRoles({ ...base, sessions: 5 })).toEqual([
      'QUALITY',
      'LONG',
      'EASY',
      'EASY',
      'SUPPORT',
    ]);
  });

  it('quem está começando a correr faz base aeróbia, sem qualidade', () => {
    expect(isStarter(2, 'BEGINNER')).toBe(true);
    expect(isStarter(9, 'BEGINNER')).toBe(false);
    expect(isStarter(0, 'INTERMEDIATE')).toBe(false);
    expect(runningWeekRoles({ ...base, sessions: 3, starter: true })).toEqual([
      'EASY',
      'EASY',
      'LONG',
    ]);
  });

  it('conta o mínimo exigido e classifica a classe do treino', () => {
    expect(requiredRoleCounts(['QUALITY', 'QUALITY', 'LONG', 'EASY'])).toEqual({
      quality: 2,
      long: 1,
    });
    expect(roleOfKind('FARTLEK')).toBe('QUALITY');
    expect(roleOfKind('LONG')).toBe('LONG');
    expect(roleOfKind('MODERATE')).toBe('OTHER');
    expect(roleOfKind('EASY')).toBe('OTHER');
  });
});
