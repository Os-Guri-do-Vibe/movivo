import { describe, expect, it } from 'vitest';

import type { WeekMetrics } from '@movivo/shared';

import {
  allowedActions,
  computeSignals,
  energyDeltaBounds,
  type ReviewContext,
  weightSlope,
} from './review-signals';

const week = (index: number, over: Partial<WeekMetrics> = {}): WeekMetrics => ({
  weekStart: new Date(Date.UTC(2026, 8, 7 + index * 7)).toISOString().slice(0, 10),
  planned: 3,
  done: 3,
  missed: 0,
  keyPlanned: 1,
  keyDone: 1,
  load: 900,
  avgRpe: 6,
  painReports: 0,
  foodLogDays: 5,
  weightKg: null,
  ...over,
});
const ctx: ReviewContext = { goal: 'LOSE', hasNutritionPlan: true };
const kinds = (weeks: WeekMetrics[], context = ctx) =>
  computeSignals(weeks, context).map((s) => s.kind);

describe('computeSignals', () => {
  it('semana normal não gera sinal', () => {
    expect(kinds([week(0), week(1), week(2)])).toEqual([]);
  });

  it('adesão baixa só dispara com duas semanas seguidas', () => {
    expect(kinds([week(0), week(1, { done: 1 })])).toEqual([]);
    expect(kinds([week(0), week(1, { done: 1 }), week(2, { done: 1 })])).toContain('ADHERENCE_LOW');
  });

  it('sessões-chave puladas', () => {
    expect(kinds([week(0), week(1, { keyDone: 0 }), week(2, { keyDone: 0 })])).toContain(
      'KEY_SESSIONS_SKIPPED',
    );
  });

  it('aluno novo não tem pico de carga: a base são só semanas com atividade', () => {
    const empty = {
      planned: 0,
      done: 0,
      missed: 0,
      keyPlanned: 0,
      keyDone: 0,
      load: 0,
      avgRpe: null,
    };
    expect(kinds([week(0, empty), week(1, empty), week(2, empty), week(3)])).toEqual([]);
  });

  it('esforço alto sustentado e pico de carga', () => {
    expect(kinds([week(0, { avgRpe: 9 }), week(1, { avgRpe: 9 })])).toContain('EFFORT_HIGH');
    expect(kinds([week(0), week(1), week(2), week(3, { load: 1_600 })])).toContain('LOAD_SPIKE');
  });

  it('platô de peso em perda de peso e direção oposta', () => {
    const flat = [80, 80.05, 79.95, 80, 80.02].map((w, i) => week(i, { weightKg: w }));
    expect(kinds(flat)).toContain('WEIGHT_PLATEAU');
    const up = [80, 80.4, 80.8, 81.2, 81.6].map((w, i) => week(i, { weightKg: w }));
    expect(kinds(up)).toContain('WEIGHT_WRONG_DIRECTION');
  });

  it('platô só vale com objetivo de peso e com pontos suficientes', () => {
    const flat = [80, 80, 80, 80].map((w, i) => week(i, { weightKg: w }));
    expect(kinds(flat, { goal: 'NONE', hasNutritionPlan: true })).toEqual([]);
    expect(kinds(flat.slice(0, 3))).toEqual([]);
  });

  it('variação rápida de peso é sinal próprio', () => {
    const fast = [90, 88.8, 87.6, 86.4].map((w, i) => week(i, { weightKg: w }));
    expect(kinds(fast)).toContain('WEIGHT_RAPID_CHANGE');
  });

  it('registro alimentar baixo só conta com plano alimentar', () => {
    const weeks = [week(0, { foodLogDays: 1 }), week(1, { foodLogDays: 0 })];
    expect(kinds(weeks)).toContain('NUTRITION_UNDERLOGGED');
    expect(kinds(weeks, { goal: 'LOSE', hasNutritionPlan: false })).toEqual([]);
  });

  it('dor em mais de um treino', () => {
    expect(kinds([week(0, { painReports: 1 }), week(1, { painReports: 1 })])).toContain(
      'PAIN_REPORTED',
    );
  });
});

describe('weightSlope', () => {
  it('estima kg/semana por mínimos quadrados', () => {
    const slope = weightSlope([80, 79.5, 79, 78.5].map((w, i) => week(i, { weightKg: w })));
    expect(slope).toBeCloseTo(-0.5, 5);
  });
});

describe('allowedActions', () => {
  const signals = (ws: WeekMetrics[], context = ctx) => computeSignals(ws, context);

  it('sem sinais não há ação', () => {
    expect(allowedActions([])).toEqual([]);
  });

  it('dor ou mudança rápida de peso só permitem perguntar', () => {
    expect(
      allowedActions(signals([week(0, { painReports: 1 }), week(1, { painReports: 1 })])),
    ).toEqual(['ASK_STUDENT']);
    const fast = [90, 88.8, 87.6, 86.4].map((w, i) => week(i, { weightKg: w }));
    expect(allowedActions(signals(fast))).toEqual(['ASK_STUDENT']);
  });

  it('platô com boa adesão e registro permite ajustar energia', () => {
    const flat = [80, 80, 80, 80].map((w, i) => week(i, { weightKg: w }));
    expect(allowedActions(signals(flat))).toContain('ADJUST_ENERGY_TARGET');
  });

  it('platô com pouca adesão ao registro não autoriza mexer na energia', () => {
    const flat = [80, 80, 80, 80].map((w, i) => week(i, { weightKg: w, foodLogDays: 1 }));
    expect(allowedActions(signals(flat))).not.toContain('ADJUST_ENERGY_TARGET');
  });

  it('adesão baixa permite reduzir volume e mandar mensagem', () => {
    const allowed = allowedActions(signals([week(0, { done: 1 }), week(1, { done: 1 })]));
    expect(allowed).toEqual(expect.arrayContaining(['ADJUST_WEEKLY_VOLUME', 'SEND_MESSAGE']));
  });
});

describe('energyDeltaBounds', () => {
  it('segue a direção do objetivo', () => {
    expect(energyDeltaBounds('LOSE')).toEqual({ min: -150, max: 0 });
    expect(energyDeltaBounds('GAIN')).toEqual({ min: 0, max: 150 });
    expect(energyDeltaBounds('MAINTAIN')).toBeNull();
  });
});
