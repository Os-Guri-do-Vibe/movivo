import { describe, expect, it } from 'vitest';

import {
  mergeObservationScales,
  scoreOf,
  sleepScoreOfHours,
  summarizeObservations,
  type ObservationView,
} from './observations';

const obs = (over: Partial<ObservationView>): ObservationView => ({
  date: '2026-11-05',
  kind: 'SLEEP',
  score: null,
  valueNum: null,
  phase: 'BEFORE',
  source: 'CHAT',
  note: null,
  recordedAt: '2026-11-05T08:00:00Z',
  ...over,
});
const none = { energy: null, sleep: null, soreness: null, mood: null, stress: null };

describe('observações do aluno', () => {
  it('horas de sono viram nota quando ele só disse a quantidade', () => {
    expect([4, 5.5, 6.5, 7.5, 9].map(sleepScoreOfHours)).toEqual([1, 2, 3, 4, 5]);
    expect(scoreOf(obs({ valueNum: 4 }))).toBe(1);
    expect(scoreOf(obs({ score: 4, valueNum: 4 }))).toBe(4);
  });

  it('relato do chat preenche o que o check-in não tem', () => {
    const merged = mergeObservationScales(none, [
      obs({ valueNum: 4 }),
      obs({ kind: 'ENERGY', score: 2 }),
    ]);
    expect(merged).toMatchObject({ sleep: 1, energy: 2, stress: null });
  });

  it('quando os dois falam da mesma coisa vale o pior (estresse é invertido)', () => {
    const base = { ...none, sleep: 4, stress: 2 };
    const merged = mergeObservationScales(base, [
      obs({ kind: 'SLEEP', score: 2 }),
      obs({ kind: 'STRESS', score: 5 }),
    ]);
    expect(merged.sleep).toBe(2);
    expect(merged.stress).toBe(5);
    // Um "dormi bem" depois não apaga o "dormi mal" de antes.
    expect(mergeObservationScales(merged, [obs({ kind: 'SLEEP', score: 5 })]).sleep).toBe(2);
  });

  it('doença, viagem e álcool entram no resumo', () => {
    const summary = summarizeObservations([
      obs({ kind: 'ILLNESS' }),
      obs({ kind: 'ALCOHOL' }),
      obs({ valueNum: 5 }),
    ]);
    expect(summary).toMatchObject({ illness: true, alcohol: true, travel: false, sleepHours: 5 });
  });
});
