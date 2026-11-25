import { describe, expect, it } from 'vitest';

import {
  consistencyOf,
  estimatedOneRepMax,
  hyroxOf,
  predictionsOf,
  riegel,
  runningOf,
  streakOf,
  studentProgressOf,
  type ProgressInput,
} from './student-progress';

// Quinta-feira, 12/11/2026.
const TODAY = '2026-11-12';

const run = (id: string, date: string, km: number, seconds: number, hr?: number) => ({
  id,
  date,
  status: 'COMPLETED',
  modality: 'RUNNING',
  durationMinutes: Math.round(seconds / 60),
  metrics: {
    distanceMeters: km * 1000,
    movingSeconds: seconds,
    ...(hr ? { avgHeartRate: hr } : {}),
  },
});
const strength = (id: string, date: string, status = 'COMPLETED') => ({
  id,
  date,
  status,
  modality: 'STRENGTH',
  durationMinutes: 50,
  metrics: null,
});

const base: ProgressInput = {
  today: TODAY,
  scheduled: [],
  executions: [],
  sets: [],
  exerciseNames: new Map([['supino', 'Supino reto']]),
};

describe('constância (dias ativos seguidos)', () => {
  it('descanso não quebra nem soma; treino previsto e não feito quebra', () => {
    const streak = streakOf({
      today: TODAY,
      scheduled: [
        { date: '2026-11-02', status: 'MISSED' },
        { date: '2026-11-04', status: 'DONE' },
        { date: '2026-11-06', status: 'DONE' },
        { date: '2026-11-09', status: 'DONE' },
        { date: '2026-11-11', status: 'DONE' },
      ],
      executions: [
        strength('a', '2026-11-04'),
        strength('b', '2026-11-06'),
        strength('c', '2026-11-09'),
        strength('d', '2026-11-11'),
      ],
    });
    // 02 quebrou; 04, 06, 09 e 11 somam; os dias de descanso no meio não quebram.
    expect(streak.current).toBe(4);
    expect(streak.best).toBe(4);
    expect(streak.activeToday).toBe(false);
    const state = (date: string) => streak.days.find((d) => d.date === date)?.state;
    expect(state('2026-11-02')).toBe('MISSED');
    expect(state('2026-11-05')).toBe('REST');
    expect(state(TODAY)).toBe('REST');
    expect(state('2026-11-13')).toBe('FUTURE');
    // Quatro semanas inteiras, de segunda a domingo.
    expect(streak.days).toHaveLength(28);
    expect(streak.days[0]?.date).toBe('2026-10-19');
  });

  it('hoje com treino ainda em aberto não quebra; "hoje não deu" quebra', () => {
    const scheduled = [
      { date: '2026-11-11', status: 'DONE' },
      { date: TODAY, status: 'PLANNED' },
    ];
    const open = streakOf({ today: TODAY, scheduled, executions: [strength('a', '2026-11-11')] });
    expect(open.current).toBe(1);
    expect(open.days.find((d) => d.date === TODAY)?.state).toBe('PENDING');

    const gaveUp = streakOf({
      today: TODAY,
      scheduled,
      executions: [strength('a', '2026-11-11'), strength('b', TODAY, 'ABANDONED')],
    });
    expect(gaveUp.current).toBe(0);
    expect(gaveUp.best).toBe(1);
  });

  it('treino fora do plano também conta como dia ativo', () => {
    const streak = streakOf({ today: TODAY, scheduled: [], executions: [strength('x', TODAY)] });
    expect(streak.current).toBe(1);
    expect(streak.activeToday).toBe(true);
  });
});

describe('consistência das últimas 4 semanas', () => {
  it('feitos ÷ previstos, sem contar o treino de hoje que ainda está em aberto', () => {
    const c = consistencyOf({
      today: TODAY,
      scheduled: [
        { date: '2026-11-02', status: 'MISSED' },
        { date: '2026-11-04', status: 'DONE' },
        { date: '2026-11-05', status: 'SKIPPED' },
        { date: '2026-11-06', status: 'PARTIAL' },
        { date: TODAY, status: 'PLANNED' },
      ],
      executions: [strength('a', '2026-11-04'), strength('b', '2026-11-06', 'PARTIAL')],
    });
    expect(c).toEqual({ adherencePct: 67, sessions28d: 2, minutes28d: 100 });
  });
});

describe('progressão nos treinos', () => {
  it('força: a série mais pesada e o 1RM estimado de cada treino, com o nome do exercício', () => {
    expect(estimatedOneRepMax(60, 10)).toBe(80);
    expect(estimatedOneRepMax(100, 1)).toBe(100);
    expect(estimatedOneRepMax(40, 20)).toBeNull();
    const progress = studentProgressOf({
      ...base,
      executions: [strength('a', '2026-11-04'), strength('b', '2026-11-11')],
      sets: [
        { executionId: 'a', date: '2026-11-04', exerciseId: 'supino', reps: 10, loadKg: 60 },
        { executionId: 'a', date: '2026-11-04', exerciseId: 'supino', reps: 8, loadKg: 60 },
        { executionId: 'b', date: '2026-11-11', exerciseId: 'supino', reps: 8, loadKg: 65 },
      ],
    });
    expect(progress.strength).toEqual([
      {
        exerciseId: 'supino',
        name: 'Supino reto',
        sessions: 2,
        points: [
          { date: '2026-11-04', topLoadKg: 60, reps: 10, e1rmKg: 80 },
          { date: '2026-11-11', topLoadKg: 65, reps: 8, e1rmKg: 82.3 },
        ],
      },
    ]);
    expect(progress.records[0]).toEqual({
      label: 'Maior carga · Supino reto',
      value: '65 kg × 8',
      date: '2026-11-11',
    });
  });

  it('corrida: ritmo por treino, km por semana, maior distância e melhor ritmo', () => {
    const running = runningOf({
      ...base,
      executions: [
        run('a', '2026-11-03', 5, 1_750, 155),
        run('b', '2026-11-08', 10, 3_300, 150),
        run('c', '2026-11-11', 2, 560),
      ],
    });
    expect(running).toMatchObject({
      runs: 3,
      totalKm: 17,
      longestKm: 10,
      // A corrida de 2 km (mais rápida) é curta demais para recorde de ritmo.
      bestPaceSecondsPerKm: 330,
    });
    expect(running?.points[0]).toEqual({
      date: '2026-11-03',
      distanceKm: 5,
      paceSecondsPerKm: 350,
      avgHeartRate: 155,
    });
    expect(running?.weeks.at(-1)).toEqual({ weekStart: '2026-11-09', km: 2 });
    expect(running?.weeks.at(-2)).toEqual({ weekStart: '2026-11-02', km: 15 });
    expect(runningOf(base)).toBeNull();
  });

  it('HYROX: tempo total por sessão e a evolução de cada estação', () => {
    const hyrox = hyroxOf({
      ...base,
      executions: [
        {
          id: 'h1',
          date: '2026-11-01',
          status: 'COMPLETED',
          modality: 'HYROX',
          durationMinutes: 70,
          metrics: { stations: [{ station: 'SKIERG', durationSeconds: 290 }] },
        },
        {
          id: 'h2',
          date: '2026-11-08',
          status: 'COMPLETED',
          modality: 'HYROX',
          durationMinutes: null,
          metrics: {
            movingSeconds: 3_900,
            stations: [{ station: 'SKIERG', durationSeconds: 271 }],
          },
        },
      ],
    });
    expect(hyrox).toEqual({
      sessions: 2,
      points: [
        { date: '2026-11-01', totalSeconds: 4_200 },
        { date: '2026-11-08', totalSeconds: 3_900 },
      ],
      stations: [{ station: 'SKIERG', firstSeconds: 290, bestSeconds: 271, lastSeconds: 271 }],
    });
  });
});

describe('previsões de prova', () => {
  const running = runningOf({
    ...base,
    executions: [
      // 5 km em 25:00 (5:00/km) e um longão de 12 km mais lento.
      run('a', '2026-11-03', 5, 1_500),
      run('b', '2026-11-08', 12, 4_080),
      run('c', '2026-11-10', 2, 520),
    ],
  });

  it('Riegel: o tempo cresce um pouco mais que a distância', () => {
    expect(Math.round(riegel(1_500, 5, 10))).toBe(3_127);
    expect(Math.round(riegel(1_500, 5, 5))).toBe(1_500);
  });

  it('usa o melhor desempenho de 3 km para cima e diz quão confiável é cada prova', () => {
    const predictions = predictionsOf(running, null);
    // O 5 km a 5:00/km rende mais que o longão; a corrida de 2 km não entra.
    expect(predictions.basedOn).toEqual({ date: '2026-11-03', distanceKm: 5, seconds: 1_500 });
    expect(predictions.running.map((r) => [r.race, r.seconds, r.confidence])).toEqual([
      ['5K', 1_500, 'HIGH'],
      ['10K', 3_127, 'HIGH'],
      // Longão de 12 km: mais da metade da meia (boa), pouco mais de 1/4 da maratona (média).
      ['HALF', 6_900, 'HIGH'],
      ['MARATHON', 14_387, 'MEDIUM'],
    ]);
    expect(predictions.running[1]?.paceSecondsPerKm).toBe(313);
    expect(predictions.hyrox).toBeNull();
  });

  it('HYROX: 8 km de corrida cansada + estações (medidas ou referência) + trocas', () => {
    const hyrox = {
      sessions: 2,
      points: [],
      stations: [
        { station: 'SKIERG' as const, firstSeconds: 300, bestSeconds: 260, lastSeconds: 260 },
      ],
    };
    const prediction = predictionsOf(running, hyrox).hyrox;
    // 10 km previsto em 3_127 s → 312,7 s/km × 1,12 × 8.
    expect(prediction?.runSeconds).toBe(2_802);
    // SkiErg medido (260) + as outras 7 pela referência.
    expect(prediction?.stationsSeconds).toBe(260 + 210 + 270 + 300 + 285 + 120 + 300 + 390);
    expect(prediction?.roxzoneSeconds).toBe(360);
    expect(prediction?.measuredStations).toBe(1);
    expect(prediction?.confidence).toBe('LOW');
  });

  it('sem corrida de 3 km para cima não há previsão', () => {
    expect(predictionsOf(null, null)).toEqual({ basedOn: null, running: [], hyrox: null });
  });
});
