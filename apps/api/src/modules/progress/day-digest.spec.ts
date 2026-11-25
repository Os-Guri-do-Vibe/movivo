import { describe, expect, it } from 'vitest';

import { buildDayDigest, type DayDigestInput } from './day-digest';

const input = (over: Partial<DayDigestInput> = {}): DayDigestInput => ({
  date: '2026-11-05',
  scales: { energy: 4, sleep: 4, soreness: 4, mood: 4, stress: 2 },
  nutritionCheck: null,
  observations: [],
  sessions: [],
  executions: [],
  meals: [],
  waterMl: null,
  weightKg: null,
  studentMessages: 0,
  agentOutreach: 0,
  ...over,
});

describe('estudo do dia', () => {
  it('dia sem nenhum dado é marcado como sem sinal', () => {
    const digest = buildDayDigest(
      input({ scales: { energy: null, sleep: null, soreness: null, mood: null, stress: null } }),
    );
    expect(digest.flags).toContain('NO_SIGNAL');
  });

  it('junta treino, comida e peso no mesmo registro', () => {
    const digest = buildDayDigest(
      input({
        sessions: [{ status: 'DONE', minutes: 60 }],
        executions: [{ status: 'COMPLETED', rpe: 8 }],
        meals: [
          { energyKcal: 600, proteinG: 40 },
          { energyKcal: 800, proteinG: 55 },
        ],
        weightKg: 80.2,
        waterMl: 2_000,
      }),
    );
    expect(digest.training).toMatchObject({ planned: 1, done: 1, minutes: 60, rpeAvg: 8 });
    expect(digest.nutrition).toEqual({
      loggedMeals: 2,
      energyKcal: 1_400,
      proteinG: 95,
      waterMl: 2_000,
    });
    expect(digest.weightKg).toBe(80.2);
    expect(digest.flags).not.toContain('NO_SIGNAL');
  });

  it('marca sono baixo, estresse alto, doença e sessão perdida', () => {
    const digest = buildDayDigest(
      input({
        scales: { energy: 2, sleep: 1, soreness: 4, mood: 4, stress: 5 },
        observations: [
          {
            date: '2026-11-05',
            kind: 'ILLNESS',
            score: null,
            valueNum: null,
            phase: 'NONE',
            source: 'CHAT',
            note: 'garganta ruim',
            recordedAt: '2026-11-05T08:00:00Z',
          },
        ],
        sessions: [{ status: 'MISSED', minutes: 45 }],
      }),
    );
    expect(digest.flags).toEqual(
      expect.arrayContaining([
        'SLEEP_LOW',
        'STRESS_HIGH',
        'ENERGY_LOW',
        'ILLNESS',
        'SESSION_MISSED',
      ]),
    );
    // O digest nunca carrega o texto livre do aluno.
    expect(JSON.stringify(digest)).not.toContain('garganta');
  });
});
