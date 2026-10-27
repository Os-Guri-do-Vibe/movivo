import { z } from 'zod';

import { weekdaySchema } from '../anamnesis.schema';
import {
  coachedModalitySchema,
  experienceLevelSchema,
  externalSportSchema,
} from '../training/modality.schema';
import { daySlotSchema } from '../training/plan.schema';

// --- Perfil ------------------------------------------------------------------------------

export const trainingVenueSchema = z.enum([
  'FULL_GYM',
  'BASIC_GYM',
  'CONDO_GYM',
  'HOME',
  'OUTDOOR',
  'TRACK',
  'HYROX_GYM',
]);
export type TrainingVenue = z.infer<typeof trainingVenueSchema>;

/** Experiência atual por modalidade, com números de referência quando o aluno sabe. */
export const modalityExperienceSchema = z.object({
  modality: coachedModalitySchema,
  level: experienceLevelSchema,
  /** Há quantos meses pratica (0 = nunca). */
  monthsPracticing: z.number().int().min(0).max(600),
  sessionsPerWeek: z.number().int().min(0).max(14),
  /** Corrida: km por semana hoje. */
  weeklyKm: z.number().min(0).max(300).optional(),
  /** Corrida: melhor tempo recente em 5 km, em segundos. */
  recent5kSeconds: z.number().int().min(600).max(7_200).optional(),
  /** HYROX: provas já feitas e melhor tempo, em segundos. */
  hyroxRaces: z.number().int().min(0).max(100).optional(),
  hyroxBestSeconds: z.number().int().min(2_400).max(14_400).optional(),
  wantsToStart: z.boolean(),
});
export type ModalityExperience = z.infer<typeof modalityExperienceSchema>;

/** Esporte externo que o aluno pratica, com os dias quando fixos. */
export const externalSportPracticeSchema = z.object({
  sport: externalSportSchema,
  label: z.string().trim().min(1).max(80),
  sessionsPerWeek: z.number().int().min(1).max(14),
  minutesPerSession: z.number().int().min(10).max(600),
  /** PSE típica das sessões (CR-10). */
  typicalRpe: z.number().min(0).max(10),
  fixedDays: z.array(weekdaySchema).max(7),
});
export type ExternalSportPractice = z.infer<typeof externalSportPracticeSchema>;

/** Contexto de vida que muda o planejamento (não é saúde). */
export const lifeContextSchema = z.object({
  occupationRhythm: z.enum(['REGULAR', 'SHIFTS', 'TRAVELS_OFTEN', 'IRREGULAR']),
  cookingCapacity: z.enum(['NONE', 'BASIC', 'GOOD']),
  mealsOutsideHomePerWeek: z.number().int().min(0).max(21),
  foodBudget: z.enum(['TIGHT', 'MODERATE', 'COMFORTABLE']),
  sleepHoursTypical: z.number().min(3).max(12).optional(),
  stressLevel: z.enum(['LOW', 'MODERATE', 'HIGH']).optional(),
});
export type LifeContext = z.infer<typeof lifeContextSchema>;

export const studentProfileSchema = z.object({
  birthDate: z.iso.date(),
  heightCm: z.number().int().min(120).max(230),
  modalities: z.array(modalityExperienceSchema).min(1).max(3),
  externalSports: z.array(externalSportPracticeSchema).max(3),
  venues: z.array(trainingVenueSchema).min(1).max(7),
  lifeContext: lifeContextSchema,
});
export type StudentProfile = z.infer<typeof studentProfileSchema>;

// --- Restrições --------------------------------------------------------------------------

/** Janela de treino num dia da semana. */
export const availabilityWindowSchema = z.object({
  weekday: weekdaySchema,
  slot: daySlotSchema,
  maxMinutes: z.number().int().min(10).max(300),
});
export type AvailabilityWindow = z.infer<typeof availabilityWindowSchema>;

export const constraintSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('AVAILABILITY'),
    windows: z.array(availabilityWindowSchema).min(1).max(21),
    /** A rotina muda de uma semana para outra. */
    variesWeekly: z.boolean(),
    /** Teto de sessões por semana que o aluno sustenta. */
    maxSessionsPerWeek: z.number().int().min(1).max(14),
  }),
  /** Exceção pontual de agenda (ex.: "essa semana só terça, quinta e sábado"). */
  z.object({
    kind: z.literal('AVAILABILITY_OVERRIDE'),
    weekStart: z.iso.date(),
    windows: z.array(availabilityWindowSchema).max(21),
  }),
  z.object({
    kind: z.literal('MOVEMENT_RESTRICTION'),
    /** Tag de contraindicação do catálogo (ex.: `SHOULDER_OVERHEAD`). */
    tag: z.string().trim().min(1).max(40),
    description: z.string().trim().min(1).max(200),
  }),
  z.object({
    kind: z.literal('EQUIPMENT'),
    available: z.array(z.string().trim().min(1).max(40)).max(60),
  }),
  z.object({
    kind: z.literal('DIETARY_RESTRICTION'),
    restriction: z.enum([
      'VEGETARIAN',
      'VEGAN',
      'LACTOSE_FREE',
      'GLUTEN_FREE',
      'HALAL',
      'KOSHER',
      'OTHER',
    ]),
    description: z.string().trim().max(200).optional(),
  }),
  z.object({
    kind: z.literal('FOOD_ALLERGY'),
    allergen: z.string().trim().min(1).max(60),
    severity: z.enum(['INTOLERANCE', 'ALLERGY', 'SEVERE_ALLERGY']),
  }),
]);
export type StudentConstraint = z.infer<typeof constraintSchema>;
export type ConstraintKind = StudentConstraint['kind'];
export const constraintKindSchema = z.enum([
  'AVAILABILITY',
  'AVAILABILITY_OVERRIDE',
  'MOVEMENT_RESTRICTION',
  'EQUIPMENT',
  'DIETARY_RESTRICTION',
  'FOOD_ALLERGY',
]);

// --- Preferências ------------------------------------------------------------------------

/**
 * Força da preferência. Uma preferência INFERIDA nunca vira `REQUIRED` sem confirmação do
 * aluno (regra do Estado do Aluno: hipótese não vira fato em silêncio).
 */
export const preferenceStrengthSchema = z.enum(['REQUIRED', 'STRONG', 'FLEXIBLE', 'HYPOTHESIS']);
export type PreferenceStrength = z.infer<typeof preferenceStrengthSchema>;

export const informationOriginSchema = z.enum(['DECLARED', 'OBSERVED', 'INFERRED']);
export type InformationOrigin = z.infer<typeof informationOriginSchema>;

export const preferenceDomainSchema = z.enum([
  'TRAINING_STRUCTURE',
  'EXERCISE',
  'SESSION_LENGTH',
  'EFFORT',
  'SCHEDULE',
  'FOOD',
  'COMMUNICATION',
]);
export type PreferenceDomain = z.infer<typeof preferenceDomainSchema>;

export const preferenceSchema = z
  .object({
    domain: preferenceDomainSchema,
    /** Chave estável (ex.: `split`, `exercise:agachamento_livre`, `food:peixe`). */
    key: z.string().trim().min(1).max(80),
    /** `LIKES`/`DISLIKES` ou um valor (ex.: `UPPER_LOWER`, `45`). */
    value: z.union([z.literal('LIKES'), z.literal('DISLIKES'), z.string().max(80), z.number()]),
    strength: preferenceStrengthSchema,
    origin: informationOriginSchema,
    /** 0–100. Declarada começa alta; inferida começa baixa e sobe com evidência. */
    confidence: z.number().int().min(0).max(100),
  })
  .refine((p) => !(p.origin === 'INFERRED' && p.strength === 'REQUIRED'), {
    message: 'Preferência inferida não pode ser obrigatória sem confirmação do aluno.',
    path: ['strength'],
  });
export type StudentPreference = z.infer<typeof preferenceSchema>;

// --- Observações -------------------------------------------------------------------------

/** Fato derivado de eventos reais (não é opinião do modelo). */
export const observationSchema = z.object({
  domain: z.enum(['ADHERENCE', 'TRAINING', 'NUTRITION', 'BODY', 'RECOVERY', 'BEHAVIOR']),
  kind: z.string().trim().min(1).max(60),
  statement: z.string().trim().min(1).max(300),
  data: z.record(z.string(), z.unknown()),
});
export type StudentObservation = z.infer<typeof observationSchema>;

// --- Saúde (sempre cifrado em repouso) ---------------------------------------------------

export const healthRecordKindSchema = z.enum([
  'PARQ',
  'CONDITION',
  'INJURY',
  'PAIN',
  'MEDICATION',
  'SURGERY',
  'PREGNANCY',
  'EATING_DISORDER_HISTORY',
  'PROFESSIONAL_GUIDANCE',
]);
export type HealthRecordKind = z.infer<typeof healthRecordKindSchema>;

/** Conteúdo cifrado de um registro de saúde (o banco guarda só o `bytea`). */
export const healthRecordPayloadSchema = z.object({
  summary: z.string().trim().min(1).max(500),
  /** Região corporal, quando se aplica (dor, lesão). */
  region: z.string().trim().max(40).optional(),
  /** Restrições de movimento derivadas (tags do catálogo). */
  movementTags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  /** Orientação de profissional externo que o aluno relatou seguir. */
  guidance: z.string().trim().max(500).optional(),
});
export type HealthRecordPayload = z.infer<typeof healthRecordPayloadSchema>;
