import { z } from 'zod';

import { enduranceTargetSchema } from './modality.schema';

/** Distância XOR duração em cada trecho: nunca os dois, nunca nenhum. */
function distanceXorDuration(value: { distanceMeters?: unknown; durationSeconds?: unknown }) {
  return (value.distanceMeters !== undefined) !== (value.durationSeconds !== undefined);
}
const DISTANCE_XOR_DURATION = { message: 'Informe distância ou duração, não os dois nem nenhum.' };

// --- Corrida -----------------------------------------------------------------------------

export const runningSessionKindSchema = z.enum([
  'EASY',
  'RECOVERY',
  'LONG',
  'TEMPO',
  'THRESHOLD',
  'INTERVALS',
  'PROGRESSIVE',
  'FARTLEK',
  'HILLS',
  'TEST',
  'RACE',
]);
export type RunningSessionKind = z.infer<typeof runningSessionKindSchema>;

export const RUNNING_SESSION_KIND_LABELS: Readonly<Record<RunningSessionKind, string>> = {
  EASY: 'Rodagem leve',
  RECOVERY: 'Regenerativo',
  LONG: 'Longão',
  TEMPO: 'Ritmo sustentado',
  THRESHOLD: 'Limiar',
  INTERVALS: 'Intervalado',
  PROGRESSIVE: 'Progressivo',
  FARTLEK: 'Fartlek',
  HILLS: 'Subidas',
  TEST: 'Teste',
  RACE: 'Prova',
};

export const runningSegmentTypeSchema = z.enum([
  'WARMUP',
  'STEADY',
  'WORK',
  'RECOVERY',
  'STRIDES',
  'COOLDOWN',
]);

export const runningSegmentSchema = z
  .object({
    type: runningSegmentTypeSchema,
    /** Repetições do trecho (ex.: 6 × 800 m). Ausente = 1. */
    repeat: z.number().int().min(1).max(40).optional(),
    distanceMeters: z.number().int().min(50).max(50_000).optional(),
    durationSeconds: z.number().int().min(10).max(14_400).optional(),
    target: enduranceTargetSchema,
    notes: z.string().trim().max(200).optional(),
  })
  .refine(distanceXorDuration, DISTANCE_XOR_DURATION);
export type RunningSegment = z.infer<typeof runningSegmentSchema>;

export const runningSessionContentSchema = z.object({
  modality: z.literal('RUNNING'),
  kind: runningSessionKindSchema,
  segments: z.array(runningSegmentSchema).min(1).max(20),
  /** Terreno sugerido quando importa para o estímulo (subida, pista, esteira). */
  terrain: z.enum(['ANY', 'FLAT', 'HILLS', 'TRACK', 'TREADMILL', 'TRAIL']).default('ANY'),
});
export type RunningSessionContent = z.infer<typeof runningSessionContentSchema>;

// --- HYROX -------------------------------------------------------------------------------

/** As oito estações oficiais, na ordem da prova. */
export const hyroxStationSchema = z.enum([
  'SKIERG',
  'SLED_PUSH',
  'SLED_PULL',
  'BURPEE_BROAD_JUMP',
  'ROWING',
  'FARMERS_CARRY',
  'SANDBAG_LUNGES',
  'WALL_BALLS',
]);
export type HyroxStation = z.infer<typeof hyroxStationSchema>;

export const HYROX_STATION_LABELS: Readonly<Record<HyroxStation, string>> = {
  SKIERG: 'SkiErg',
  SLED_PUSH: 'Sled push',
  SLED_PULL: 'Sled pull',
  BURPEE_BROAD_JUMP: 'Burpee broad jump',
  ROWING: 'Remo',
  FARMERS_CARRY: 'Farmers carry',
  SANDBAG_LUNGES: 'Sandbag lunges',
  WALL_BALLS: 'Wall balls',
};

export const hyroxDivisionSchema = z.enum(['OPEN', 'PRO', 'DOUBLES', 'RELAY']);
export type HyroxDivision = z.infer<typeof hyroxDivisionSchema>;

export const hyroxSessionKindSchema = z.enum([
  'STATION_SKILL',
  'STATION_STRENGTH',
  'COMPROMISED_RUNNING',
  'ENGINE',
  'SIMULATION',
]);
export type HyroxSessionKind = z.infer<typeof hyroxSessionKindSchema>;

const hyroxRunBlockSchema = z.object({
  type: z.literal('RUN'),
  distanceMeters: z.number().int().min(100).max(10_000),
  target: enduranceTargetSchema,
});

const hyroxStationBlockSchema = z
  .object({
    type: z.literal('STATION'),
    station: hyroxStationSchema,
    distanceMeters: z.number().int().min(5).max(5_000).optional(),
    reps: z.number().int().min(1).max(300).optional(),
    durationSeconds: z.number().int().min(10).max(3_600).optional(),
    loadKg: z.number().min(0).max(400).optional(),
    target: enduranceTargetSchema.optional(),
  })
  .refine(
    (b) =>
      [b.distanceMeters, b.reps, b.durationSeconds].filter((v) => v !== undefined).length === 1,
    { message: 'Cada estação usa exatamente um volume: distância, repetições ou duração.' },
  );

const hyroxRestBlockSchema = z.object({
  type: z.literal('REST'),
  durationSeconds: z.number().int().min(10).max(900),
});

export const hyroxBlockSchema = z.union([
  hyroxRunBlockSchema,
  hyroxStationBlockSchema,
  hyroxRestBlockSchema,
]);
export type HyroxBlock = z.infer<typeof hyroxBlockSchema>;

export const hyroxSessionContentSchema = z.object({
  modality: z.literal('HYROX'),
  kind: hyroxSessionKindSchema,
  /** Quantas voltas pelo circuito de blocos. */
  rounds: z.number().int().min(1).max(10).default(1),
  blocks: z.array(hyroxBlockSchema).min(1).max(24),
});
export type HyroxSessionContent = z.infer<typeof hyroxSessionContentSchema>;
