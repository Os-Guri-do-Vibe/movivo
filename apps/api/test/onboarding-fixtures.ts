/**
 * Payloads das 8 etapas da anamnese e atalho para preenchê-las — compartilhado pelos testes
 * de integração que precisam de um aluno cadastrado pelo fluxo real.
 */
import {
  PARQ_DECLARATIONS,
  PARQ_DECLARATIONS_VERSION,
  PARQ_QUESTION_IDS,
  PARQ_VERSION,
} from '@movivo/shared';

import type { AnamnesisService } from '../src/modules/anamnesis/anamnesis.service';

export const goals = () => ({
  goal: { primary: 'HYPERTROPHY', secondary: ['BODY_DEFINITION'], emphasis: 'AESTHETICS' },
  motivation: 'Quero me sentir bem no casamento',
});
export const modalities = () => ({
  modalities: [
    {
      modality: 'STRENGTH',
      level: 'INTERMEDIATE',
      monthsPracticing: 24,
      sessionsPerWeek: 3,
      wantsToStart: false,
    },
    {
      modality: 'RUNNING',
      level: 'BEGINNER',
      monthsPracticing: 0,
      sessionsPerWeek: 0,
      wantsToStart: true,
    },
  ],
  externalSports: [],
  venues: ['FULL_GYM'],
});
export const routine = () => ({
  windows: [
    { weekday: 'MON', slot: 'EVENING', maxMinutes: 60 },
    { weekday: 'WED', slot: 'EVENING', maxMinutes: 60 },
    { weekday: 'SAT', slot: 'MORNING', maxMinutes: 90 },
  ],
  variesWeekly: true,
  maxSessionsPerWeek: 4,
  lifeContext: {
    occupationRhythm: 'REGULAR',
    cookingCapacity: 'BASIC',
    mealsOutsideHomePerWeek: 5,
    foodBudget: 'MODERATE',
  },
});
export const preferences = () => ({
  preferences: {
    split: 'UPPER_LOWER',
    effort: 'UNSURE',
    priority: 'BALANCED',
    preferredSessionMinutes: 50,
  },
  dislikedExercises: 'burpee',
  pain: {
    hasPain: true,
    trend: 'STABLE',
    points: [{ region: 'KNEE', intensity: 6 }],
    trigger: 'incomoda ao agachar',
    hasProfessionalExplanation: false,
    underMedicalFollowUp: false,
    hasAvoidanceRecommendation: false,
  },
});
export function parq(riskIds: string[] = []) {
  return {
    parq: {
      version: PARQ_VERSION,
      answers: PARQ_QUESTION_IDS.map((questionId) => ({
        questionId,
        answer: riskIds.includes(questionId),
        ...(questionId === 'Q9' && riskIds.includes('Q9') ? { detail: 'motivo' } : {}),
      })),
    },
    declarationsVersion: PARQ_DECLARATIONS_VERSION,
    declarations: PARQ_DECLARATIONS.map((d) => d.id),
  };
}
export const nutrition = () => ({
  mealsPerDay: 4,
  usualMeals: ['BREAKFAST', 'LUNCH', 'AFTERNOON_SNACK', 'DINNER'],
  dietaryRestrictions: ['LACTOSE_FREE'],
  allergies: [{ allergen: 'amendoim', severity: 'SEVERE_ALLERGY' }],
  supplements: ['CREATINE'],
  hunger: 'HIGH',
  dislikedFoods: 'jiló',
});
export const body = () => ({
  measurements: [{ kind: 'WAIST', value: 98, method: 'SELF_TAPE', measuredOn: '2026-10-27' }],
});

/** Etapas 2..8 (todas depois do cadastro). */
export async function completeSteps(
  service: AnamnesisService,
  token: string,
  risk: string[] = [],
  withBody = true,
) {
  await service.patchStep(token, 2, goals());
  await service.patchStep(token, 3, modalities());
  await service.patchStep(token, 4, routine());
  await service.patchStep(token, 5, preferences());
  await service.patchStep(token, 6, parq(risk));
  await service.patchStep(token, 7, nutrition());
  if (withBody) await service.patchStep(token, 8, body());
}
