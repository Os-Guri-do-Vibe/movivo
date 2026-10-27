/**
 * Metodologia de DESENVOLVIMENTO (fictícia) para os agentes funcionarem localmente antes de os
 * profissionais escreverem a versão real no estúdio. Chamada pelo `seed.ts`, que recusa rodar
 * em produção. Idempotente: só publica a versão 1 de domínios que ainda não têm versão.
 *
 * Os valores seguem as faixas plausíveis do domínio; NÃO são a metodologia da MOVIVO.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  coachingActionTypeSchema,
  exampleParameters,
  METHODOLOGY_DOMAIN_SPECS,
  type CoachingActionType,
  type MethodologyParameters,
} from '@movivo/shared';

import { DEFAULT_SIGNAL_RULES } from '../../modules/coaching/safety/sentinel-rules';
import { methodologyDocuments } from './schema';

const DEV_NOTE =
  'Semente de desenvolvimento (fictícia) — substituir pela versão dos profissionais.';

const levels = <T>(beginner: T, intermediate: T, advanced: T) => ({
  BEGINNER: beginner,
  INTERMEDIATE: intermediate,
  ADVANCED: advanced,
});

const AUTONOMY_DEFAULTS: Record<CoachingActionType, { level: string; limit: number }> = {
  RESCHEDULE_WEEK: { level: 'AUTO_WITH_LIMITS', limit: 1 },
  SUBSTITUTE_EXERCISE: { level: 'AUTO', limit: 0 },
  SHORTEN_SESSION: { level: 'AUTO_WITH_LIMITS', limit: 40 },
  ADJUST_WEEKLY_VOLUME: { level: 'AUTO_WITH_LIMITS', limit: 15 },
  PUBLISH_TRAINING_PLAN: { level: 'AUTO', limit: 0 },
  PUBLISH_NUTRITION_PLAN: { level: 'AUTO', limit: 0 },
  ADJUST_ENERGY_TARGET: { level: 'AUTO_WITH_LIMITS', limit: 200 },
  ADJUST_MEAL_GUIDANCE: { level: 'AUTO', limit: 0 },
  DEFINE_STRATEGY: { level: 'AUTO', limit: 0 },
  RECORD_PREFERENCE: { level: 'AUTO', limit: 0 },
  RECORD_CONSTRAINT: { level: 'AUTO', limit: 0 },
  SEND_MESSAGE: { level: 'AUTO', limit: 0 },
  ASK_STUDENT: { level: 'AUTO', limit: 0 },
};

/** Ajustes sobre os exemplos onde um único exemplo por coluna não faz sentido. */
const OVERRIDES: Record<string, MethodologyParameters> = {
  STRENGTH: {
    volume: {
      weeklySets: levels(
        { sets: { min: 6, max: 10 } },
        { sets: { min: 10, max: 16 } },
        { sets: { min: 12, max: 20 } },
      ),
    },
    intensity: {
      rirByPhase: {
        ADAPTATION: { rir: { min: 2, max: 4 } },
        HYPERTROPHY: { rir: { min: 0, max: 3 } },
        STRENGTH: { rir: { min: 0, max: 2 } },
        DELOAD: { rir: { min: 3, max: 5 } },
      },
      repsByGoal: {
        HYPERTROPHY: { reps: { min: 6, max: 15 } },
        STRENGTH: { reps: { min: 2, max: 6 } },
        MUSCULAR_ENDURANCE: { reps: { min: 12, max: 25 } },
      },
      restSeconds: {
        COMPOUND: { seconds: { min: 90, max: 180 } },
        ISOLATION: { seconds: { min: 60, max: 90 } },
        STRENGTH_MAIN: { seconds: { min: 150, max: 300 } },
      },
    },
    periodization: {
      deloadEveryWeeks: levels({ weeks: 8 }, { weeks: 6 }, { weeks: 4 }),
      loadIncrementKg: {
        UPPER: { kg: { min: 1, max: 2.5 } },
        LOWER: { kg: { min: 2.5, max: 5 } },
      },
    },
    structure: {
      allowedSplits: levels(
        { fullBody: true, upperLower: true, pushPullLegs: false, bodyPart: false },
        { fullBody: true, upperLower: true, pushPullLegs: true, bodyPart: true },
        { fullBody: true, upperLower: true, pushPullLegs: true, bodyPart: true },
      ),
    },
  },
  RUNNING: {
    distribution: {
      easySharePct: levels({ pct: 85 }, { pct: 80 }, { pct: 75 }),
      qualitySessionsPerWeek: levels({ max: 1 }, { max: 2 }, { max: 2 }),
    },
    progression: { longRunMaxMinutes: levels({ minutes: 60 }, { minutes: 100 }, { minutes: 150 }) },
    zones: {
      zoneBoundsPctHrMax: {
        Z1: { pct: { min: 50, max: 60 } },
        Z2: { pct: { min: 60, max: 70 } },
        Z3: { pct: { min: 70, max: 80 } },
        Z4: { pct: { min: 80, max: 90 } },
        Z5: { pct: { min: 90, max: 100 } },
      },
    },
  },
  HYROX: {
    phases: {
      mixByPhase: {
        BASE: { runningPct: 50, stationsPct: 25, strengthPct: 25 },
        BUILD: { runningPct: 40, stationsPct: 35, strengthPct: 25 },
        PEAK: { runningPct: 35, stationsPct: 45, strengthPct: 20 },
        TAPER: { runningPct: 40, stationsPct: 40, strengthPct: 20 },
      },
    },
  },
  NUTRITION: {
    protein: {
      gPerKgByGoal: {
        HYPERTROPHY: { gPerKg: { min: 1.6, max: 2.2 } },
        FAT_LOSS: { gPerKg: { min: 1.8, max: 2.4 } },
        RECOMPOSITION: { gPerKg: { min: 1.8, max: 2.4 } },
        ENDURANCE: { gPerKg: { min: 1.4, max: 1.8 } },
        HEALTH: { gPerKg: { min: 1.2, max: 1.6 } },
      },
    },
    energy: { energyFloorKcal: { FEMALE: { kcal: 1300 }, MALE: { kcal: 1600 } } },
    recomposition: { bodyFatThresholdPct: { FEMALE: { pct: 30 }, MALE: { pct: 22 } } },
  },
  SAFETY: { signals: { bySignal: DEFAULT_SIGNAL_RULES as unknown as Record<string, unknown> } },
  AUTONOMY: {
    actions: {
      byAction: Object.fromEntries(
        coachingActionTypeSchema.options.map((action) => [action, AUTONOMY_DEFAULTS[action]]),
      ),
    },
  },
};

function merge(base: MethodologyParameters, overrides: MethodologyParameters | undefined) {
  if (!overrides) return base;
  const merged: MethodologyParameters = { ...base };
  for (const [section, fields] of Object.entries(overrides)) {
    merged[section] = { ...base[section], ...fields };
  }
  return merged;
}

export async function seedDevMethodology(db: PostgresJsDatabase): Promise<number> {
  let created = 0;
  for (const spec of METHODOLOGY_DOMAIN_SPECS) {
    const existing = await db
      .select({ id: methodologyDocuments.id })
      .from(methodologyDocuments)
      .where(eq(methodologyDocuments.domain, spec.domain))
      .limit(1);
    if (existing.length > 0) continue;
    await db.insert(methodologyDocuments).values({
      domain: spec.domain,
      version: 1,
      status: 'PUBLISHED',
      parameters: merge(exampleParameters(spec), OVERRIDES[spec.domain]),
      guidance: Object.fromEntries(spec.guidance.map((g) => [g.key, DEV_NOTE])),
      changeNote: DEV_NOTE,
      publishedAt: new Date(),
    });
    created += 1;
  }
  return created;
}
