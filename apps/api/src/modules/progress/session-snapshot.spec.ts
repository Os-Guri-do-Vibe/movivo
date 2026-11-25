import { describe, expect, it } from 'vitest';

import {
  compareSessions,
  endurancePerformance,
  lowReadiness,
  sessionKeyOf,
  strengthPerformance,
  type StrengthPerformance,
} from './session-snapshot';

const good = { energy: 4, sleep: 4, soreness: 4, mood: 4, stress: 2 };
const bad = { ...good, sleep: 1 };
const set = (reps: number, loadKg: number, rir: number) => ({
  reps,
  loadKg,
  rir,
  completed: true,
  setNumber: 1,
});

describe('snapshot de sessão', () => {
  it('a mesma sessão tem sempre a mesma chave', () => {
    expect(sessionKeyOf('Força A — Peito e Tríceps', 'STRENGTH')).toBe(
      'strength:forca-a-peito-e-triceps',
    );
    expect(sessionKeyOf(null, 'RUNNING')).toBe('running:running');
  });

  it('calcula volume, RIR médio e proximidade da falha', () => {
    const perf = strengthPerformance({
      sets: [set(8, 60, 2), set(8, 60, 1), set(6, 60, 3), { ...set(5, 60, 0), completed: false }],
      setsPlanned: 4,
      rpe: 8,
      durationMinutes: 50,
    });
    expect(perf.setsDone).toBe(3);
    expect(perf.tonnageKg).toBe(1_320);
    expect(perf.avgRir).toBe(2);
    expect(perf.nearFailureShare).toBe(0.67);
    expect(perf.completionRatio).toBe(0.75);
  });

  it('corrida: distância em km e ritmo', () => {
    const perf = endurancePerformance({
      metrics: { distanceMeters: 5_200, avgPaceSecondsPerKm: 330, avgHeartRate: 150 },
      rpe: 6,
      durationMinutes: 29,
    });
    expect(perf).toMatchObject({ distanceKm: 5.2, paceSecPerKm: 330, avgHeartRate: 150 });
  });

  it('disposição baixa: sono, energia ou corpo ruins, ou estresse alto', () => {
    expect(lowReadiness(good)).toBe(false);
    expect(lowReadiness(bad)).toBe(true);
    expect(lowReadiness({ ...good, stress: 5 })).toBe(true);
  });

  const perf = (tonnageKg: number): StrengthPerformance => ({
    kind: 'STRENGTH',
    setsDone: 9,
    setsPlanned: 9,
    completionRatio: 1,
    tonnageKg,
    avgRir: 2,
    nearFailureShare: 0.3,
    rpe: 7,
    durationMinutes: 55,
  });
  const previous = { date: '2026-10-29', executionId: 'e0', performance: perf(3_000) };

  it('primeira vez que faz a sessão não tem comparação', () => {
    expect(compareSessions({ now: perf(3_000), readiness: good, previous: null }).pattern).toBe(
      'FIRST_TIME',
    );
  });

  it('rendeu menos com a disposição ruim: esperado; com a boa: atenção', () => {
    expect(compareSessions({ now: perf(2_500), readiness: bad, previous }).pattern).toBe(
      'WORSE_WITH_LOW_READINESS',
    );
    expect(compareSessions({ now: perf(2_500), readiness: good, previous }).pattern).toBe(
      'WORSE_WITH_GOOD_READINESS',
    );
  });

  it('rendeu mais mesmo cansado é mérito', () => {
    const result = compareSessions({ now: perf(3_300), readiness: bad, previous });
    expect(result.pattern).toBe('BETTER_DESPITE_LOW_READINESS');
    expect(result.tonnageDeltaPct).toBe(10);
  });

  it('variação pequena é a mesma coisa', () => {
    expect(compareSessions({ now: perf(3_050), readiness: good, previous }).pattern).toBe(
      'SIMILAR',
    );
  });
});
