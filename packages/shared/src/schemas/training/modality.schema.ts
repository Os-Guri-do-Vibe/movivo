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

/**
 * Ritmo de referência de um trecho de corrida: um indicador VISUAL ao lado do alvo. O critério
 * do trecho continua sendo `target` (em geral a zona cardíaca); a referência só dá ao aluno uma
 * ideia de em que ritmo aquela zona costuma cair para ele. É calculada pelo sistema a partir do
 * 5 km recente do aluno e dos percentuais da metodologia, nunca pelo agente.
 */
export const paceReferenceSchema = z.object({
  /** Faixa em segundos por km (`min` é o mais rápido). */
  secondsPerKm: rangeSchema(150, 900),
  /**
   * O treino foi planejado para a esteira (pelo terreno pedido ou pelo local do aluno). Os dois
   * formatos são sempre mostrados (ritmo para a rua e velocidade para a esteira): o aluno pode
   * fazer o mesmo treino num lugar ou no outro.
   */
  treadmill: z.boolean(),
});
export type PaceReference = z.infer<typeof paceReferenceSchema>;

/** 330 → "5:30". */
export function paceClock(secondsPerKm: number): string {
  const total = Math.round(secondsPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** { min: 330, max: 360 } → "5:30–6:00/km". */
export function paceRangeLabel(range: { min: number; max: number }): string {
  return range.min === range.max
    ? `${paceClock(range.min)}/km`
    : `${paceClock(range.min)}–${paceClock(range.max)}/km`;
}

/** Velocidade da esteira (km/h, uma casa) para um ritmo em segundos por km. */
export function treadmillSpeedKmh(secondsPerKm: number): number {
  return Math.round(36_000 / secondsPerKm) / 10;
}

/** { min: 330, max: 360 } → "10,0–10,9 km/h" (o ritmo mais lento é a velocidade menor). */
export function treadmillSpeedLabel(range: { min: number; max: number }): string {
  const format = (kmh: number) =>
    kmh.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const slow = treadmillSpeedKmh(range.max);
  const fast = treadmillSpeedKmh(range.min);
  return slow === fast ? `${format(fast)} km/h` : `${format(slow)}–${format(fast)} km/h`;
}

/** A mesma referência nos dois formatos: ritmo para correr na rua e velocidade para a esteira. */
export function paceReferenceParts(reference: PaceReference): { pace: string; treadmill: string } {
  return {
    pace: paceRangeLabel(reference.secondsPerKm),
    treadmill: treadmillSpeedLabel(reference.secondsPerKm),
  };
}

/** "6:00–6:45/km · esteira 8,9–10,0 km/h": os dois formatos numa linha. */
export function paceReferenceLabel(reference: PaceReference): string {
  const { pace, treadmill } = paceReferenceParts(reference);
  return `${pace} · esteira ${treadmill}`;
}

/** Tamanho máximo do nome do esporte quando o aluno escolhe "Outro" e digita qual é. */
export const OTHER_SPORT_NAME_MAX = 80;

/**
 * Nome do esporte para exibir e planejar. Em "Outro" o nome é o que o aluno digitou (`label`);
 * sem texto próprio, ou com o rótulo genérico, volta para o rótulo do tipo.
 */
export function externalSportName(sport: ExternalSport, label?: string | null): string {
  if (sport === 'OTHER') {
    const name = label?.trim();
    if (name && name.toLowerCase() !== EXTERNAL_SPORT_LABELS.OTHER.toLowerCase()) return name;
  }
  return EXTERNAL_SPORT_LABELS[sport];
}

/** "Outro" sem o nome do esporte: o aluno não disse qual é. */
export function isUnnamedOtherSport(sport: ExternalSport, label?: string | null): boolean {
  return sport === 'OTHER' && externalSportName(sport, label) === EXTERNAL_SPORT_LABELS.OTHER;
}
