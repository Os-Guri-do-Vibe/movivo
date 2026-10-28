/**
 * Pré-preenchimento da anamnese COMPLEMENTAR a partir da anamnese antiga (3 etapas) de quem já
 * é aluno. Só a parte COMUM: saúde e PAR-Q são respondidos de novo (dado de saúde não volta ao
 * cliente, e refazê-los atualiza a triagem). Transitório: sai junto com as colunas antigas da
 * sessão, depois da campanha de corte.
 */
import {
  anamnesisStructuredSchema,
  onboardingStep1Schema,
  type AnamnesisStructured,
  type DeclaredGoalKind,
  type PrimaryGoal,
  type SessionDuration,
} from '@movivo/shared';

const GOAL: Readonly<Record<PrimaryGoal, DeclaredGoalKind>> = {
  GAIN_MUSCLE: 'HYPERTROPHY',
  GAIN_STRENGTH: 'STRENGTH',
  LOSE_FAT: 'FAT_LOSS',
  CONDITIONING: 'CONDITIONING',
  HEALTH_ENERGY: 'HEALTH',
  BUILD_ROUTINE: 'START_TRAINING',
  RETURN_TO_TRAINING: 'START_TRAINING',
  SPORT_EVENT: 'SPORT_PERFORMANCE',
  OTHER: 'HEALTH',
};

const MINUTES: Readonly<Record<SessionDuration, number>> = {
  LT_30: 30,
  M30_TO_45: 40,
  M45_TO_60: 50,
  M60_TO_90: 70,
  GT_90: 90,
};

const SLOT = {
  MORNING: 'MORNING',
  AFTERNOON: 'AFTERNOON',
  EVENING: 'EVENING',
  NIGHT: 'EVENING',
  VARIES: 'ANY',
} as const;

function modalitiesFrom(s: AnamnesisStructured) {
  return {
    modalities: [
      {
        modality: 'STRENGTH',
        level: s.trainingStatus === 'NEVER' ? 'NONE' : s.experience,
        monthsPracticing: 0,
        sessionsPerWeek: s.daysPerWeek,
        wantsToStart: s.trainingStatus === 'NEVER',
      },
    ],
    externalSports: [],
    venues: [s.location],
  };
}

function routineFrom(s: AnamnesisStructured) {
  const days = s.preferredDays.length > 0 ? s.preferredDays : (['MON', 'WED', 'FRI'] as const);
  return {
    windows: days.map((weekday) => ({
      weekday,
      slot: SLOT[s.preferredPeriod],
      maxMinutes: MINUTES[s.sessionDuration],
    })),
    variesWeekly: s.preferredPeriod === 'VARIES',
    maxSessionsPerWeek: s.daysPerWeek,
  };
}

/** Blocos comuns pré-preenchidos (podem estar incompletos: o aluno revisa e salva cada etapa). */
export function legacyPrefill(dataBlock1: unknown, dataBlock3: unknown): Record<string, unknown> {
  const blocks: Record<string, unknown> = {};
  const registration = onboardingStep1Schema.safeParse(dataBlock1);
  if (registration.success) blocks.registration = registration.data;
  const structured = anamnesisStructuredSchema.safeParse(dataBlock3);
  if (structured.success) {
    const s = structured.data;
    blocks.goals = {
      goal: {
        primary: GOAL[s.primaryGoal],
        secondary: [],
        emphasis:
          s.primaryGoal === 'LOSE_FAT' || s.primaryGoal === 'GAIN_MUSCLE'
            ? 'AESTHETICS'
            : 'BALANCED',
      },
    };
    blocks.modalities = modalitiesFrom(s);
    blocks.routine = routineFrom(s);
    blocks.preferences = {
      preferences: {
        split: 'NO_PREFERENCE',
        effort: 'UNSURE',
        priority: 'BALANCED',
        preferredSessionMinutes: MINUTES[s.sessionDuration],
      },
    };
  }
  return blocks;
}
