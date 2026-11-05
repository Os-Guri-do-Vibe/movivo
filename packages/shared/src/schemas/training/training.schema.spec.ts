import { describe, expect, it } from 'vitest';

import { runningSegmentSchema, hyroxSessionContentSchema } from './endurance.schema';
import { sessionLoad } from './execution.schema';
import { enduranceTargetSchema } from './modality.schema';
import {
  planSessionSchema,
  sessionContentSchema,
  trainingPlanStructureSchema,
} from './plan.schema';
import { strengthExerciseSchema } from './strength.schema';

const squat = {
  exerciseId: 'agachamento_livre',
  name: 'Agachamento livre',
  sets: 3,
  reps: { min: 6, max: 8 },
  loadStrategy: 'DOUBLE_PROGRESSION',
  rir: 2,
  restSeconds: 150,
} as const;

const strengthSession = {
  key: 'STR_A',
  title: 'Força A',
  purpose: 'Força de membros inferiores',
  priority: 'KEY',
  weeklyFrequency: 1,
  estimatedMinutes: 50,
  estimatedRpe: 7,
  content: { modality: 'STRENGTH', focus: 'Inferiores', exercises: [squat] },
} as const;

const easyRun = {
  key: 'RUN_EASY',
  title: 'Rodagem',
  purpose: 'Base aeróbica',
  priority: 'IMPORTANT',
  weeklyFrequency: 2,
  estimatedMinutes: 40,
  estimatedRpe: 4,
  content: {
    modality: 'RUNNING',
    kind: 'EASY',
    segments: [{ type: 'STEADY', durationSeconds: 2_400, target: { by: 'ZONE', zone: 'Z2' } }],
  },
} as const;

describe('conteúdo de sessão por modalidade', () => {
  it('discrimina pela modalidade e rejeita campos de outra modalidade', () => {
    expect(sessionContentSchema.safeParse(strengthSession.content).success).toBe(true);
    expect(
      sessionContentSchema.safeParse({ ...easyRun.content, modality: 'STRENGTH' }).success,
    ).toBe(false);
  });

  it('exercício de força exige repetições OU duração', () => {
    expect(strengthExerciseSchema.safeParse(squat).success).toBe(true);
    expect(strengthExerciseSchema.safeParse({ ...squat, durationSeconds: 30 }).success).toBe(false);
    const { reps: _reps, ...semReps } = squat;
    expect(strengthExerciseSchema.safeParse(semReps).success).toBe(false);
  });

  it('trecho de corrida exige distância OU duração', () => {
    const target = { by: 'PACE', secondsPerKm: { min: 300, max: 320 } };
    expect(
      runningSegmentSchema.safeParse({ type: 'WORK', repeat: 6, distanceMeters: 800, target })
        .success,
    ).toBe(true);
    expect(
      runningSegmentSchema.safeParse({
        type: 'WORK',
        distanceMeters: 800,
        durationSeconds: 200,
        target,
      }).success,
    ).toBe(false);
  });

  it('alvo de intensidade aceita um único critério por vez', () => {
    expect(enduranceTargetSchema.safeParse({ by: 'ZONE', zone: 'Z2' }).success).toBe(true);
    expect(
      enduranceTargetSchema.safeParse({ by: 'PACE', secondsPerKm: { min: 330, max: 300 } }).success,
    ).toBe(false);
  });

  it('estação de HYROX usa exatamente um tipo de volume', () => {
    const base = { modality: 'HYROX', kind: 'STATION_SKILL', rounds: 3 };
    expect(
      hyroxSessionContentSchema.safeParse({
        ...base,
        blocks: [{ type: 'STATION', station: 'WALL_BALLS', reps: 30 }],
      }).success,
    ).toBe(true);
    expect(
      hyroxSessionContentSchema.safeParse({
        ...base,
        blocks: [{ type: 'STATION', station: 'SKIERG', reps: 30, distanceMeters: 500 }],
      }).success,
    ).toBe(false);
  });

  it('esporte externo nunca é sessão-chave do plano', () => {
    const luta = {
      key: 'EXT_LUTA',
      title: 'Jiu-jitsu',
      purpose: 'Treino do esporte do aluno',
      priority: 'KEY',
      weeklyFrequency: 3,
      estimatedMinutes: 90,
      estimatedRpe: 7,
      content: {
        modality: 'EXTERNAL_SPORT',
        sport: 'MARTIAL_ARTS',
        label: 'Jiu-jitsu',
        plannedMinutes: 90,
        plannedRpe: 7,
      },
    };
    expect(planSessionSchema.safeParse(luta).success).toBe(false);
    expect(planSessionSchema.safeParse({ ...luta, priority: 'COMPLEMENTARY' }).success).toBe(true);
  });
});

describe('estrutura do plano integrado', () => {
  const plan = {
    summary: 'Força com base aeróbica',
    modalityPriorities: [
      { modality: 'STRENGTH', priority: 1 },
      { modality: 'RUNNING', priority: 2 },
    ],
    phases: [{ name: 'Base', focus: 'Adaptação', weeks: 4, endsWithDeload: true }],
    sessions: [strengthSession, easyRun],
  };

  it('aceita um plano híbrido coerente', () => {
    expect(trainingPlanStructureSchema.safeParse(plan).success).toBe(true);
  });

  it('rejeita chave de sessão repetida', () => {
    const result = trainingPlanStructureSchema.safeParse({
      ...plan,
      sessions: [strengthSession, { ...easyRun, key: 'STR_A' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita sessão de modalidade sem prioridade no plano', () => {
    const result = trainingPlanStructureSchema.safeParse({
      ...plan,
      modalityPriorities: [{ modality: 'STRENGTH', priority: 1 }],
    });
    expect(result.success).toBe(false);
  });
});

describe('carga interna (sRPE)', () => {
  it('é PSE × minutos, arredondada', () => {
    expect(sessionLoad(7, 50)).toBe(350);
    expect(sessionLoad(6.5, 45)).toBe(293);
  });
});
