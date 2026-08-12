/**
 * Teste de FIDELIDADE À SPEC do fundador (TASK-6.12.3): nenhuma opção pode sumir
 * silenciosamente do vocabulário. Se alguém reduzir um enum "para simplificar o
 * MVP", este arquivo reprova o pipeline — que é exatamente o que o fundador pediu
 * ao rejeitar o mapeamento 9→3.
 */
import { describe, expect, it } from 'vitest';

import {
  ageInYears,
  anamnesisV2Schema,
  consistencyBarrierSchema,
  EMPHASIS_MUSCLE_GROUPS,
  EMPHASIS_REGION_LABELS,
  emphasisRegionSchema,
  onboardingStep1Schema,
  onboardingStep3Schema,
  painAssessmentSchema,
  painRegionSchema,
  parqSchema,
  PARQ_DECLARATIONS,
  PARQ_DECLARATIONS_VERSION,
  PARQ_VERSION,
  pastActivitySchema,
  PRIMARY_GOAL_LABELS,
  primaryGoalSchema,
  sessionDurationSchema,
  stoppedForSchema,
  toGenerationGoal,
  trainingLocationSchema,
} from './anamnesis.schema';

const structured = {
  primaryGoal: 'GAIN_MUSCLE' as const,
  emphasis: [],
  hasImportantEvent: false,
  trainingStatus: 'REGULAR' as const,
  experience: 'INTERMEDIATE' as const,
  pastActivities: [],
  consistencyBarriers: [],
  daysPerWeek: 3,
  preferredDays: [],
  sessionDuration: 'M45_TO_60' as const,
  location: 'FULL_GYM' as const,
  preferredPeriod: 'MORNING' as const,
  practicesOtherSport: false,
  hasAvoidedExercise: false,
};

describe('vocabulário da anamnese v2 (spec do fundador)', () => {
  it('tem os 9 objetivos do RT, incluindo "Outro"', () => {
    expect(primaryGoalSchema.options).toHaveLength(9);
    expect(primaryGoalSchema.options).toContain('GAIN_STRENGTH');
    expect(primaryGoalSchema.options).toContain('SPORT_EVENT');
    expect(primaryGoalSchema.options).toContain('OTHER');
  });

  it('publica os nomes atuais dos objetivos sem alterar os valores internos', () => {
    expect(PRIMARY_GOAL_LABELS).toMatchObject({
      GAIN_MUSCLE: 'Hipertrofia',
      GAIN_STRENGTH: 'Força',
      LOSE_FAT: 'Emagrecimento',
      CONDITIONING: 'Condicionamento físico',
      HEALTH_ENERGY: 'Saúde e bem estar',
      SPORT_EVENT: 'Competir em fisiculturismo',
      OTHER: 'Outro',
    });
  });

  it('tem 11 ênfases, 11 atividades (10 + outra), 10 barreiras (9 + outro)', () => {
    expect(emphasisRegionSchema.options).toHaveLength(11);
    expect(pastActivitySchema.options).toHaveLength(11);
    expect(consistencyBarrierSchema.options).toHaveLength(10);
  });

  it('publica Braço como opção canônica e prioriza bíceps e tríceps', () => {
    expect(EMPHASIS_REGION_LABELS.BICEPS).toBe('Braço');
    expect(EMPHASIS_MUSCLE_GROUPS.BICEPS).toEqual(['bíceps', 'tríceps']);
    expect(EMPHASIS_MUSCLE_GROUPS.TRICEPS).toEqual(['tríceps']);
  });

  it('tem 5 faixas de tempo, 5 faixas de "parado", 4 locais e 10 regiões de dor', () => {
    expect(sessionDurationSchema.options).toHaveLength(5);
    expect(stoppedForSchema.options).toHaveLength(5);
    expect(trainingLocationSchema.options).toEqual(['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR']);
    expect(painRegionSchema.options).toHaveLength(10);
  });

  it('mapeia "Outro" para um objetivo de geração seguro, sem criar 10ª categoria', () => {
    expect(toGenerationGoal('OTHER')).toBe('CONDITIONING');
    expect(toGenerationGoal('GAIN_STRENGTH')).toBe('GAIN_STRENGTH');
  });
});

describe('gate 18+ (regra de negócio, validada no servidor)', () => {
  const today = new Date('2026-08-10T12:00:00Z');

  it('conta a idade completa, incluindo o aniversário de hoje', () => {
    expect(ageInYears('2008-08-10', today)).toBe(18);
    expect(ageInYears('2008-08-11', today)).toBe(17);
    expect(ageInYears('2008-09-01', today)).toBe(17);
  });

  it('aceita o cadastro bem formado', () => {
    const parsed = onboardingStep1Schema.safeParse({
      name: 'Bruno',
      birthDate: '1996-04-02',
      biologicalSex: 'MALE',
      phoneNumber: '+5511988887777',
    });
    expect(parsed.success).toBe(true);
  });

  it('recusa data mal formada', () => {
    const parsed = onboardingStep1Schema.safeParse({
      name: 'Bruno',
      birthDate: '02/04/1996',
      biologicalSex: 'MALE',
      phoneNumber: '+5511988887777',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('regras condicionais da etapa 2', () => {
  it('exige o texto livre quando o objetivo é "Outro"', () => {
    const bad = anamnesisV2Schema.safeParse({
      structured: { ...structured, primaryGoal: 'OTHER' },
      freeText: {},
    });
    expect(bad.success).toBe(false);
    const ok = anamnesisV2Schema.safeParse({
      structured: { ...structured, primaryGoal: 'OTHER' },
      freeText: { primaryGoalOther: 'voltar a jogar bola sem cansar' },
    });
    expect(ok.success).toBe(true);
  });

  it('recusa "corpo todo" combinado com outra ênfase e mais de 2 ênfases', () => {
    expect(
      anamnesisV2Schema.safeParse({
        structured: { ...structured, emphasis: ['FULL_BODY', 'CHEST'] },
        freeText: {},
      }).success,
    ).toBe(false);
    expect(
      anamnesisV2Schema.safeParse({
        structured: { ...structured, emphasis: ['CHEST', 'BACK', 'GLUTES'] },
        freeText: {},
      }).success,
    ).toBe(false);
    expect(
      anamnesisV2Schema.safeParse({
        structured: { ...structured, emphasis: ['CHEST', 'BACK'] },
        freeText: {},
      }).success,
    ).toBe(true);
  });

  it('recusa "Nenhuma" combinada com outra atividade', () => {
    expect(
      anamnesisV2Schema.safeParse({
        structured: { ...structured, pastActivities: ['NONE', 'WEIGHT_TRAINING'] },
        freeText: {},
      }).success,
    ).toBe(false);
    expect(
      anamnesisV2Schema.safeParse({
        structured: { ...structured, pastActivities: ['NONE'] },
        freeText: {},
      }).success,
    ).toBe(true);
  });

  it('exige "há quanto tempo" quando o usuário está parado', () => {
    expect(
      anamnesisV2Schema.safeParse({
        structured: { ...structured, trainingStatus: 'STOPPED' },
        freeText: {},
      }).success,
    ).toBe(false);
    expect(
      anamnesisV2Schema.safeParse({
        structured: { ...structured, trainingStatus: 'STOPPED', stoppedFor: 'M6_TO_12' },
        freeText: {},
      }).success,
    ).toBe(true);
  });

  it('não bloqueia divergência entre dias marcados e dias por semana (Sofia §3.5)', () => {
    const parsed = anamnesisV2Schema.safeParse({
      structured: { ...structured, daysPerWeek: 3, preferredDays: ['MON', 'TUE', 'WED', 'THU'] },
      freeText: {},
    });
    expect(parsed.success).toBe(true);
  });
});

describe('seção 4 — dores', () => {
  it('encerra em um toque quando não há dor', () => {
    expect(painAssessmentSchema.safeParse({ hasPain: false }).success).toBe(true);
  });

  it('recusa dor sem região, sem tendência ou com região repetida', () => {
    expect(painAssessmentSchema.safeParse({ hasPain: true, points: [] }).success).toBe(false);
    expect(
      painAssessmentSchema.safeParse({
        hasPain: true,
        points: [{ region: 'KNEE', intensity: 7 }],
      }).success,
    ).toBe(false);
    expect(
      painAssessmentSchema.safeParse({
        hasPain: true,
        trend: 'STABLE',
        points: [
          { region: 'KNEE', intensity: 7 },
          { region: 'KNEE', intensity: 3 },
        ],
      }).success,
    ).toBe(false);
  });

  it('aceita uma intensidade por região, de 0 a 10', () => {
    const parsed = painAssessmentSchema.safeParse({
      hasPain: true,
      trend: 'WORSENING',
      points: [
        { region: 'KNEE', intensity: 9 },
        { region: 'LOWER_BACK', intensity: 4 },
      ],
    });
    expect(parsed.success).toBe(true);
    expect(
      painAssessmentSchema.safeParse({
        hasPain: true,
        trend: 'STABLE',
        points: [{ region: 'KNEE', intensity: 11 }],
      }).success,
    ).toBe(false);
  });

  it('não coleta região de dor quando o usuário respondeu "não tenho dor"', () => {
    expect(
      painAssessmentSchema.safeParse({
        hasPain: false,
        points: [{ region: 'KNEE', intensity: 5 }],
      }).success,
    ).toBe(false);
  });
});

describe('etapa 3 — PAR-Q reusado + 3 declarações', () => {
  const answers = (yes: string[] = []) =>
    ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'].map((questionId) => ({
      questionId,
      answer: yes.includes(questionId),
      ...(questionId === 'Q9' && yes.includes('Q9') ? { detail: 'motivo' } : {}),
    }));

  it('não altera o conjunto oficial', () => {
    expect(PARQ_VERSION).toBe('parq-2026-07-v1');
    expect(parqSchema.safeParse({ version: PARQ_VERSION, answers: answers() }).success).toBe(true);
  });

  it('exige as 3 declarações finais', () => {
    expect(PARQ_DECLARATIONS).toHaveLength(3);
    const base = {
      parq: { version: PARQ_VERSION, answers: answers() },
      declarationsVersion: PARQ_DECLARATIONS_VERSION,
    };
    expect(onboardingStep3Schema.safeParse({ ...base, declarations: [] }).success).toBe(false);
    expect(onboardingStep3Schema.safeParse({ ...base, declarations: ['TRUTHFUL'] }).success).toBe(
      false,
    );
    expect(
      onboardingStep3Schema.safeParse({
        ...base,
        declarations: PARQ_DECLARATIONS.map((d) => d.id),
      }).success,
    ).toBe(true);
  });
});
