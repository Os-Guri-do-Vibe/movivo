import { describe, expect, it } from 'vitest';

import { runningSessionContentSchema, RUNNING_SESSION_KIND_LABELS } from './endurance.schema';
import {
  eligibleRunningWorkouts,
  RUNNING_WORKOUT_CATEGORY_LABELS,
  RUNNING_WORKOUT_LABELS,
  RUNNING_WORKOUT_TYPES,
  RUNNING_WORKOUTS,
  runningPhaseSchema,
  runningSessionLabel,
} from './running-workouts';

describe('catálogo de treinos de corrida', () => {
  it('traz os 7 grupos e os 38 treinos da classificação MOVIVO, todos descritos', () => {
    expect(RUNNING_WORKOUT_TYPES).toHaveLength(38);
    expect(Object.keys(RUNNING_WORKOUT_CATEGORY_LABELS)).toHaveLength(7);
    for (const type of RUNNING_WORKOUT_TYPES) {
      const spec = RUNNING_WORKOUTS[type];
      expect(spec.label.length, type).toBeGreaterThan(2);
      expect(spec.stimulus.length, type).toBeGreaterThan(20);
      expect(spec.objective.length, type).toBeGreaterThan(20);
      expect(spec.adaptation.length, type).toBeGreaterThan(10);
      expect(RUNNING_SESSION_KIND_LABELS[spec.kind], type).toBeTruthy();
      expect(spec.phases.length, type).toBeGreaterThan(0);
      expect(RUNNING_WORKOUT_CATEGORY_LABELS[spec.category], type).toBeTruthy();
    }
  });

  it('só o treino de HYROX fica fora do escopo da corrida', () => {
    const hyrox = RUNNING_WORKOUT_TYPES.filter((type) => RUNNING_WORKOUTS[type].scope === 'HYROX');
    expect(hyrox).toEqual(['HYROX_TRANSITION']);
    for (const phase of runningPhaseSchema.options) {
      expect(eligibleRunningWorkouts({ level: 'ADVANCED', phase })).not.toContain(
        'HYROX_TRANSITION',
      );
    }
  });

  it('o iniciante, em qualquer fase, tem base, longão e uma porta de entrada para a qualidade', () => {
    const base = eligibleRunningWorkouts({ level: 'BEGINNER', phase: 'BASE' });
    expect(base).toEqual(
      expect.arrayContaining(['EASY_RUN', 'LONG_RUN', 'FARTLEK', 'HILL_REPEATS', 'STRIDES']),
    );
    // Treinos pesados de velocidade e VO₂máx não são oferecidos a iniciante.
    for (const blocked of [
      'VO2MAX_INTERVALS',
      'TOP_SPEED',
      'REPETITION_TRAINING',
      'DOWNHILL_RUN',
    ]) {
      expect(base).not.toContain(blocked);
    }
    for (const phase of runningPhaseSchema.options) {
      const types = eligibleRunningWorkouts({ level: 'BEGINNER', phase });
      expect(types.length, phase).toBeGreaterThan(3);
    }
  });

  it('o nível avançado enxerga o iniciante e mais; a fase muda o menu', () => {
    const beginner = eligibleRunningWorkouts({ level: 'BEGINNER', phase: 'BUILD' });
    const advanced = eligibleRunningWorkouts({ level: 'ADVANCED', phase: 'BUILD' });
    expect(beginner.every((type) => advanced.includes(type))).toBe(true);
    expect(advanced.length).toBeGreaterThan(beginner.length);
    const taper = eligibleRunningWorkouts({ level: 'ADVANCED', phase: 'TAPER' });
    expect(taper).toContain('RACE_PACE_REPEATS');
    expect(taper).not.toContain('VO2MAX_INTERVALS');
    expect(eligibleRunningWorkouts({ level: 'ADVANCED', phase: 'PEAK' })).toContain(
      'RACE_SIMULATION',
    );
  });

  it('a sessão mostra o treino específico; sem ele (plano antigo), a classe', () => {
    expect(runningSessionLabel({ kind: 'FARTLEK', workoutType: 'FARTLEK' })).toBe('Fartlek');
    expect(runningSessionLabel({ kind: 'LONG', workoutType: 'PROGRESSIVE_LONG_RUN' })).toBe(
      'Longão progressivo',
    );
    expect(runningSessionLabel({ kind: 'EASY' })).toBe('Rodagem leve');
    expect(RUNNING_WORKOUT_LABELS.TEMPO_RUN).toContain('Tempo run');
  });

  it('o conteúdo da sessão aceita o tipo e planos antigos sem ele continuam válidos', () => {
    const segments = [
      { type: 'STEADY', distanceMeters: 5_000, target: { by: 'RPE', rpe: { min: 3, max: 4 } } },
    ];
    const novo = runningSessionContentSchema.safeParse({
      modality: 'RUNNING',
      kind: 'MODERATE',
      workoutType: 'TRAIL_RUN',
      terrain: 'TRAIL',
      segments,
    });
    expect(novo.success).toBe(true);
    const areia = runningSessionContentSchema.safeParse({
      modality: 'RUNNING',
      kind: 'MODERATE',
      workoutType: 'SAND_RUN',
      terrain: 'SAND',
      segments,
    });
    expect(areia.success).toBe(true);
    const antigo = runningSessionContentSchema.safeParse({
      modality: 'RUNNING',
      kind: 'EASY',
      segments,
    });
    expect(antigo.success).toBe(true);
    expect(
      runningSessionContentSchema.safeParse({
        modality: 'RUNNING',
        kind: 'EASY',
        workoutType: 'NAO_EXISTE',
        segments,
      }).success,
    ).toBe(false);
  });
});
