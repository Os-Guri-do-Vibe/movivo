import { z } from 'zod';

/**
 * Modalidade de uma SESSÃO de treino. "Híbrido" não é uma modalidade de sessão: é um plano
 * que combina sessões de modalidades diferentes (e, quando há, o esporte que o aluno já pratica).
 */
export const sessionModalitySchema = z.enum(['STRENGTH', 'RUNNING', 'HYROX', 'EXTERNAL_SPORT']);
export type SessionModality = z.infer<typeof sessionModalitySchema>;

export const SESSION_MODALITY_LABELS: Readonly<Record<SessionModality, string>> = {
  STRENGTH: 'Musculação',
  RUNNING: 'Corrida',
  HYROX: 'HYROX',
  EXTERNAL_SPORT: 'Outro esporte',
};

/** Modalidades que a MOVIVO PRESCREVE (o esporte externo é só planejado em volta). */
export const coachedModalitySchema = sessionModalitySchema.exclude(['EXTERNAL_SPORT']);
export type CoachedModality = z.infer<typeof coachedModalitySchema>;

/** Esporte praticado fora da MOVIVO e conciliado no plano híbrido. */
export const externalSportSchema = z.enum([
  'SWIMMING',
  'CYCLING',
  'MARTIAL_ARTS',
  'FOOTBALL',
  'TENNIS',
  'BEACH_SPORTS',
  'CROSS_TRAINING',
  'YOGA_PILATES',
  'DANCE',
  'OTHER',
]);
export type ExternalSport = z.infer<typeof externalSportSchema>;

export const EXTERNAL_SPORT_LABELS: Readonly<Record<ExternalSport, string>> = {
  SWIMMING: 'Natação',
  CYCLING: 'Ciclismo',
  MARTIAL_ARTS: 'Luta / artes marciais',
  FOOTBALL: 'Futebol',
  TENNIS: 'Tênis / raquete',
  BEACH_SPORTS: 'Esportes de areia',
  CROSS_TRAINING: 'Cross training',
  YOGA_PILATES: 'Yoga / pilates',
  DANCE: 'Dança',
  OTHER: 'Outro',
};

/** Nível de experiência por modalidade (o aluno pode ser avançado numa e iniciante noutra). */
export const experienceLevelSchema = z.enum(['NONE', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED']);
export type ExperienceLevel = z.infer<typeof experienceLevelSchema>;

/** Percepção subjetiva de esforço na escala CR-10 (0–10), usada em todas as modalidades. */
export const rpeSchema = z.number().min(0).max(10);

/** Zona de intensidade de endurance (modelo de 5 zonas; os limites vêm da metodologia). */
export const intensityZoneSchema = z.enum(['Z1', 'Z2', 'Z3', 'Z4', 'Z5']);
export type IntensityZone = z.infer<typeof intensityZoneSchema>;

/** Faixa numérica fechada, com mínimo ≤ máximo. */
export function rangeSchema(min: number, max: number) {
  return z
    .object({ min: z.number().min(min).max(max), max: z.number().min(min).max(max) })
    .refine((r) => r.min <= r.max, { message: 'O mínimo não pode ser maior que o máximo.' });
}

/**
 * Alvo de intensidade de um trecho de endurance. Exatamente UM critério por alvo: misturar
 * ritmo e FC no mesmo trecho deixa o aluno sem saber qual obedecer quando divergem.
 */
export const enduranceTargetSchema = z.discriminatedUnion('by', [
  z.object({ by: z.literal('ZONE'), zone: intensityZoneSchema }),
  /** Ritmo em segundos por km (ex.: 330 = 5:30/km). */
  z.object({ by: z.literal('PACE'), secondsPerKm: rangeSchema(150, 900) }),
  z.object({ by: z.literal('HEART_RATE'), bpm: rangeSchema(60, 220) }),
  z.object({ by: z.literal('RPE'), rpe: rangeSchema(0, 10) }),
]);
export type EnduranceTarget = z.infer<typeof enduranceTargetSchema>;
