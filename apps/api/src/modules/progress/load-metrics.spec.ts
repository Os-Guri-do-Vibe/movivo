import { describe, expect, it } from 'vitest';

import { addDays } from '../planning/calc/week-planner';
import {
  computeLoadMetrics,
  dailySeries,
  readinessScore,
  type LoadDay,
  type ReadinessDay,
} from './load-metrics';

const ASOF = '2026-11-03';
const days = (loads: Array<[number, number]>): LoadDay[] =>
  loads.map(([ago, load]) => ({ date: addDays(ASOF, -ago), load }));
const base = { asOf: ASOF, planned: [], checkIns: [], firstTrainingDay: addDays(ASOF, -60) };
const checkIn = (ago: number, v: Partial<ReadinessDay> = {}): ReadinessDay => ({
  date: addDays(ASOF, -ago),
  energy: 4,
  sleep: 4,
  soreness: 4,
  mood: 4,
  stress: 2,
  ...v,
});

describe('dailySeries', () => {
  it('preenche dias sem treino com zero e soma sessões do mesmo dia', () => {
    const series = dailySeries(
      [
        { date: ASOF, load: 100 },
        { date: ASOF, load: 50 },
        { date: addDays(ASOF, -2), load: 300 },
      ],
      ASOF,
      4,
    );
    expect(series).toEqual([0, 300, 0, 150]);
  });
});

describe('computeLoadMetrics', () => {
  it('razão aguda:crônica compara a semana com a média de 28 dias', () => {
    // 4 semanas iguais: 3 treinos de 300 por semana, sempre nos mesmos dias.
    const executions = days(
      [0, 3, 5, 7, 10, 12, 14, 17, 19, 21, 24, 26].map((ago) => [ago, 300] as [number, number]),
    );
    const m = computeLoadMetrics({ ...base, executions });
    expect(m.weeklyLoad).toBe(900);
    expect(m.acwr).toBe(1);
    expect(m.risks.map((r) => r.kind)).not.toContain('ACWR_HIGH');
  });

  it('sinaliza pico de carga e ACWR alto', () => {
    const executions = days([
      [0, 500],
      [1, 500],
      [2, 500],
      [3, 500],
      [4, 500],
      [8, 200],
      [15, 200],
      [22, 200],
    ]);
    const m = computeLoadMetrics({ ...base, executions });
    expect(m.acwr).toBeGreaterThan(1.5);
    expect(m.risks.map((r) => r.kind)).toEqual(expect.arrayContaining(['ACWR_HIGH', 'LOAD_SPIKE']));
  });

  it('sem 3 semanas de histórico a razão aguda:crônica não é calculada', () => {
    const m = computeLoadMetrics({
      ...base,
      firstTrainingDay: addDays(ASOF, -10),
      executions: days([[0, 400]]),
    });
    expect(m.acwr).toBeNull();
  });

  it('monotonia e strain: dias muito parecidos elevam a monotonia', () => {
    const varied = computeLoadMetrics({
      ...base,
      executions: days([
        [0, 600],
        [2, 100],
        [4, 400],
      ]),
    });
    const flat = computeLoadMetrics({
      ...base,
      executions: days([0, 1, 2, 3, 4, 5, 6].map((ago) => [ago, 300] as [number, number])),
    });
    expect(flat.monotony).toBeNull(); // sem variação a razão é indefinida
    expect(varied.monotony).not.toBeNull();
    const almostFlat = computeLoadMetrics({
      ...base,
      executions: days(
        [0, 1, 2, 3, 4, 5, 6].map((ago) => [ago, 300 + (ago % 2) * 10] as [number, number]),
      ),
    });
    expect(almostFlat.monotony).toBeGreaterThan(2);
    expect(almostFlat.risks.map((r) => r.kind)).toContain('MONOTONY_HIGH');
    expect(almostFlat.strain).toBe(Math.round(almostFlat.weeklyLoad * (almostFlat.monotony ?? 0)));
  });

  it('carga planejada × realizada', () => {
    const m = computeLoadMetrics({
      ...base,
      executions: days([[1, 100]]),
      planned: days([
        [1, 300],
        [3, 300],
      ]),
    });
    expect(m.plannedLoad7d).toBe(600);
    expect(m.adherenceRatio).toBe(0.17);
    expect(m.risks.map((r) => r.kind)).toContain('PLANNED_UNDERDONE');
  });

  it('prontidão compara o dia com o normal do próprio aluno', () => {
    const normal = [2, 3, 4, 5, 6].map((ago) => checkIn(ago));
    const m = computeLoadMetrics({
      ...base,
      executions: [],
      checkIns: [...normal, checkIn(0, { energy: 2, sleep: 2, soreness: 2, mood: 3, stress: 4 })],
    });
    expect(m.readiness.score).toBe(30);
    expect(m.readiness.baseline).toBe(75);
    expect(m.readiness.delta).toBe(-45);
    expect(m.risks.map((r) => r.kind)).toContain('READINESS_LOW');
  });

  it('sono e estresse ruins na semana viram sinal', () => {
    const m = computeLoadMetrics({
      ...base,
      executions: [],
      checkIns: [0, 1, 2, 3].map((ago) => checkIn(ago, { sleep: 2, stress: 5 })),
    });
    expect(m.risks.map((r) => r.kind)).toEqual(
      expect.arrayContaining(['SLEEP_LOW', 'STRESS_HIGH']),
    );
  });
});

describe('readinessScore', () => {
  it('inverte o estresse e ignora o que não foi respondido', () => {
    expect(
      readinessScore(checkIn(0, { energy: 5, sleep: 5, soreness: 5, mood: 5, stress: 1 })),
    ).toBe(100);
    expect(
      readinessScore(checkIn(0, { energy: 1, sleep: 1, soreness: 1, mood: 1, stress: 5 })),
    ).toBe(0);
    expect(
      readinessScore({
        date: ASOF,
        energy: null,
        sleep: null,
        soreness: null,
        mood: null,
        stress: null,
      }),
    ).toBeNull();
  });
});
