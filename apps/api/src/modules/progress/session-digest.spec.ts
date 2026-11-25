import { describe, expect, it } from 'vitest';

import {
  enduranceDigest,
  strengthDigest,
  type PlannedExercise,
  type SetRow,
} from './session-digest';

const set = (
  exerciseId: string,
  setNumber: number,
  reps: number,
  loadKg: number,
  rir: number | null = 2,
): SetRow => ({
  exerciseId,
  setNumber,
  reps,
  loadKg,
  durationSeconds: null,
  rir,
  completed: true,
});

const planned: PlannedExercise[] = [
  {
    exerciseId: 'agachamento',
    name: 'Agachamento',
    sets: 3,
    reps: { min: 6, max: 10 },
    rir: 2,
    loadStrategy: 'DOUBLE_PROGRESSION',
  },
  { exerciseId: 'remada', name: 'Remada', sets: 3, reps: { min: 8, max: 12 }, loadStrategy: 'RIR' },
];

describe('strengthDigest', () => {
  it('compara com a última vez e aponta o que mudou', () => {
    const digest = strengthDigest({
      planned,
      sets: [
        set('agachamento', 0, 10, 20), // aquecimento: ignorado
        set('agachamento', 1, 8, 62.5),
        set('agachamento', 2, 7, 62.5),
        set('agachamento', 3, 6, 62.5, 0),
      ],
      previous: new Map([
        [
          'agachamento',
          {
            date: '2026-10-27',
            sets: [set('agachamento', 1, 8, 60), set('agachamento', 2, 8, 60)],
          },
        ],
      ]),
      previousSessionTonnageKg: 900,
    });
    const squat = digest.exercises[0];
    expect(squat).toMatchObject({
      doneSets: 3,
      topLoadKg: 62.5,
      change: 'LOAD_UP',
      versusRange: 'IN',
      repDropOff: 2,
      tonnageKg: Math.round(8 * 62.5 + 7 * 62.5 + 6 * 62.5),
      previous: { topLoadKg: 60, repsAtTop: 8 },
    });
    expect(digest.skippedExercises).toEqual(['Remada']);
    expect(digest.setsPlanned).toBe(6);
    expect(digest.setsDone).toBe(3);
    expect(digest.setsNearFailure).toBe(3);
    expect(digest.previousTonnageKg).toBe(900);
  });

  it('exercício sem histórico é novo; mesma carga e mais repetições sobe por repetições', () => {
    const digest = strengthDigest({
      planned,
      sets: [set('agachamento', 1, 10, 60), set('remada', 1, 13, 40)],
      previous: new Map([
        ['agachamento', { date: '2026-10-27', sets: [set('agachamento', 1, 8, 60)] }],
      ]),
      previousSessionTonnageKg: null,
    });
    expect(digest.exercises.map((e) => e.change)).toEqual(['REPS_UP', 'NEW']);
    expect(digest.exercises[1]?.versusRange).toBe('ABOVE');
  });
});

describe('enduranceDigest', () => {
  it('mede a deriva de ritmo e de frequência cardíaca entre as metades e compara com a anterior', () => {
    const lap = (seconds: number, hr: number) => ({
      distanceMeters: 1000,
      durationSeconds: seconds,
      avgHeartRate: hr,
    });
    const digest = enduranceDigest({
      durationMinutes: 40,
      metrics: {
        distanceMeters: 8000,
        avgPaceSecondsPerKm: 315,
        avgHeartRate: 156,
        laps: [
          lap(300, 145),
          lap(305, 148),
          lap(310, 152),
          lap(320, 158),
          lap(330, 163),
          lap(335, 166),
          lap(330, 167),
          lap(340, 168),
        ],
      },
      previous: {
        date: '2026-10-27',
        metrics: { distanceMeters: 7000, avgPaceSecondsPerKm: 330, avgHeartRate: 150 },
      },
    });
    expect(digest.distanceKm).toBe(8);
    expect(digest.paceDriftPercent).toBeGreaterThan(5);
    expect(digest.heartRateDriftPercent).toBeGreaterThan(5);
    expect(digest.paceChangePercent).toBe(-4.5);
    expect(digest.previous?.distanceKm).toBe(7);
  });

  it('sem voltas a deriva fica indefinida', () => {
    const digest = enduranceDigest({
      durationMinutes: 30,
      metrics: { distanceMeters: 5000 },
      previous: null,
    });
    expect(digest.paceDriftPercent).toBeNull();
    expect(digest.paceChangePercent).toBeNull();
  });
});
