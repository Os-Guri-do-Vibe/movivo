/**
 * Pré-preenchimento da anamnese COMPLEMENTAR a partir da anamnese antiga (3 etapas) de quem já
 * é aluno. Só a parte COMUM: saúde e PAR-Q são respondidos de novo (dado de saúde não volta ao
 * cliente, e refazê-los atualiza a triagem). Transitório: sai junto com as colunas antigas da
 * sessão, depois da campanha de corte.
 */
import { z } from 'zod';

import {
  anamnesisStructuredSchema,
  coachedModalitySchema,
  defaultVenueOf,
  onboardingStep1Schema,
  trainingVenueSchema,
  weekdaySchema,
  type AnamnesisStructured,
  type DeclaredGoalKind,
  type MuscleEmphasisRegion,
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
  RETURN_TO_TRAINING: 'RETURN_TO_TRAINING',
  SPORT_EVENT: 'BODYBUILDING_COMPETITION',
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

/** Ênfase da anamnese antiga → regiões atuais (bíceps e tríceps viraram "Braço"). */
function muscleEmphasisFrom(s: AnamnesisStructured): MuscleEmphasisRegion[] {
  const regions = s.emphasis.flatMap((region): MuscleEmphasisRegion[] => {
    if (region === 'FULL_BODY') return [];
    return region === 'BICEPS' || region === 'TRICEPS' ? ['ARMS'] : [region];
  });
  return [...new Set(regions)].slice(0, 2);
}

function modalitiesFrom(s: AnamnesisStructured) {
  return {
    modalities: [
      {
        modality: 'STRENGTH',
        level: s.trainingStatus === 'NEVER' ? 'NONE' : s.experience,
        sessionsPerWeek: s.daysPerWeek,
        wantsToStart: s.trainingStatus === 'NEVER',
        venue: s.location,
      },
    ],
    externalSports: [],
  };
}

function routineFrom(s: AnamnesisStructured) {
  const days =
    s.preferredDays.length > 0 ? [...new Set(s.preferredDays)] : (['MON', 'WED', 'FRI'] as const);
  return {
    windows: days.map((weekday) => ({
      weekday,
      slot: SLOT[s.preferredPeriod],
      maxMinutes: MINUTES[s.sessionDuration],
    })),
    variesWeekly: s.preferredPeriod === 'VARIES',
    maxSessionsPerWeek: Math.min(s.daysPerWeek, days.length, 7),
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
        priority: 'BALANCED',
        muscleEmphasis: muscleEmphasisFrom(s),
      },
    };
  }
  return blocks;
}

// --- Etapas salvas antes do local por modalidade e do teto por dias ------------------------

const savedModalitiesSchema = z.object({
  modalities: z.array(
    z.looseObject({ modality: coachedModalitySchema, venue: trainingVenueSchema.optional() }),
  ),
  venues: z.array(trainingVenueSchema),
});

/** Etapa 3 antiga (lista global `venues`): cada modalidade herda o local mais completo da lista. */
export function withModalityVenues(block: Record<string, unknown>): Record<string, unknown> {
  const saved = savedModalitiesSchema.safeParse(block);
  if (!saved.success) return block;
  const { modalities, venues } = saved.data;
  return {
    ...block,
    modalities: modalities.map((m) => ({
      ...m,
      venue: m.venue ?? defaultVenueOf(m.modality, venues),
    })),
  };
}

const savedRoutineSchema = z.object({
  windows: z.array(z.object({ weekday: weekdaySchema })),
  maxSessionsPerWeek: z.number(),
});

/** Etapa 4 antiga: os treinos por semana passam a caber nos dias marcados. */
export function withSessionsWithinDays(block: Record<string, unknown>): Record<string, unknown> {
  const saved = savedRoutineSchema.safeParse(block);
  if (!saved.success) return block;
  const days = new Set(saved.data.windows.map((w) => w.weekday)).size;
  return { ...block, maxSessionsPerWeek: Math.min(saved.data.maxSessionsPerWeek, days, 7) };
}
