/**
 * Cartão de compartilhamento do treino (Story 1080 × 1920): o aluno escolhe o modelo e o fundo,
 * como no Strava. O desenho é do servidor (sempre igual em qualquer celular); aqui ficam o
 * contrato dos dados, os modelos que cada modalidade oferece e as formatações dos números.
 *
 * Nada que identifique o aluno entra na imagem: nem nome, nem telefone, nem cargas por
 * exercício, nem relatos de dor. Só o que ele escolheria mostrar num Story.
 */
import { z } from 'zod';

import { hyroxStationSchema } from './endurance.schema';
import { SESSION_MODALITY_LABELS } from './modality.schema';

// --- Músculos (silhueta do modelo "Músculos") ---------------------------------------------

export const shareCardMuscleSchema = z.enum([
  'chest',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'obliques',
  'upper_back',
  'lats',
  'lower_back',
  'glutes',
  'quads',
  'hamstrings',
  'calves',
]);
export type ShareCardMuscle = z.infer<typeof shareCardMuscleSchema>;

const MUSCLES: ReadonlyArray<{ label: string; groups: ShareCardMuscle[]; aliases: string[] }> = [
  {
    label: 'Corpo inteiro',
    groups: [...shareCardMuscleSchema.options],
    aliases: ['corpo todo', 'corpo inteiro', 'full body', 'full_body'],
  },
  { label: 'Peito', groups: ['chest'], aliases: ['peito', 'peitoral', 'peitorais', 'chest'] },
  {
    label: 'Ombros',
    groups: ['shoulders'],
    aliases: ['ombro', 'ombros', 'deltoide', 'deltoides', 'shoulders'],
  },
  { label: 'Bíceps', groups: ['biceps'], aliases: ['biceps'] },
  { label: 'Tríceps', groups: ['triceps'], aliases: ['triceps'] },
  { label: 'Antebraços', groups: ['forearms'], aliases: ['antebraco', 'antebracos', 'forearms'] },
  { label: 'Abdômen', groups: ['abs'], aliases: ['abdomen', 'abdominal', 'abdominais', 'abs'] },
  { label: 'Oblíquos', groups: ['obliques'], aliases: ['obliquo', 'obliquos', 'obliques'] },
  { label: 'Costas', groups: ['upper_back', 'lats'], aliases: ['costas'] },
  { label: 'Trapézio', groups: ['upper_back'], aliases: ['trapezio', 'trapezios', 'upper_back'] },
  { label: 'Dorsais', groups: ['lats'], aliases: ['dorsal', 'dorsais', 'latissimo', 'lats'] },
  { label: 'Lombar', groups: ['lower_back'], aliases: ['lombar', 'lombares', 'lower_back'] },
  { label: 'Core', groups: ['abs', 'obliques'], aliases: ['core'] },
  { label: 'Glúteos', groups: ['glutes'], aliases: ['gluteo', 'gluteos', 'glutes'] },
  { label: 'Quadríceps', groups: ['quads'], aliases: ['quadriceps', 'quads'] },
  {
    label: 'Posteriores de coxa',
    groups: ['hamstrings'],
    aliases: ['posterior de coxa', 'posteriores de coxa', 'isquiotibiais', 'hamstrings'],
  },
  { label: 'Panturrilhas', groups: ['calves'], aliases: ['panturrilha', 'panturrilhas', 'calves'] },
];

/** Grupos do catálogo que não são músculo desenhável (não pintam nem entram na lista). */
const NOT_A_MUSCLE = new Set(['sistema cardiovascular', 'cardio', 'cardiovascular']);

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Grupos musculares do catálogo ("peito", "quadríceps", "corpo todo") → regiões da silhueta.
 * Nunca infere músculo pelo nome do exercício. "Corpo todo" (burpee, farmer's walk) só pinta
 * o corpo inteiro quando o treino não tem nenhum músculo específico: num treino de peito com
 * um burpee no fim, pintar tudo esconderia o que o aluno de fato treinou.
 */
export function mapWorkoutMuscles(raw: readonly string[]): {
  trainedMuscles: string[];
  groups: ShareCardMuscle[];
} {
  const labels = new Map<string, string>();
  const groups = new Set<ShareCardMuscle>();
  let fullBody = false;
  for (const value of raw) {
    const key = fold(value);
    if (!key || NOT_A_MUSCLE.has(key)) continue;
    const muscle = MUSCLES.find((item) => item.aliases.includes(key));
    if (muscle?.label === 'Corpo inteiro') {
      fullBody = true;
      continue;
    }
    // Região sem máscara (ex.: pescoço) entra na lista, sem pintar outra região por aproximação.
    const label = muscle?.label ?? value.trim().charAt(0).toUpperCase() + value.trim().slice(1);
    labels.set(fold(label), label);
    for (const group of muscle?.groups ?? []) groups.add(group);
  }
  if (fullBody && labels.size === 0) {
    labels.set('corpo inteiro', 'Corpo inteiro');
    for (const group of shareCardMuscleSchema.options) groups.add(group);
  }
  return { trainedMuscles: [...labels.values()], groups: [...groups] };
}

// --- Modelos e fundo ------------------------------------------------------------------------

/**
 * Modelos de cartão. Todos saem em PNG com fundo transparente (o aluno cola sobre a foto no
 * Story), com a marca e o selo de treino concluído; mudam o que ganha destaque:
 *  · CLASSIC: o cartão da versão anterior (silhueta à esquerda, marca e tempo à direita);
 *  · MUSCLES: a silhueta grande com os músculos trabalhados (musculação);
 *  · SPLITS: o ritmo de cada quilômetro em barras (corrida com parciais);
 *  · STATIONS: as estações feitas no circuito (HYROX);
 *  · SUMMARY: os números principais em grade;
 *  · HIGHLIGHT: um número grande (distância, volume ou tempo) com os outros em linha.
 */
export const shareCardLayoutSchema = z.enum([
  'CLASSIC',
  'SUMMARY',
  'HIGHLIGHT',
  'MUSCLES',
  'SPLITS',
  'STATIONS',
]);
export type ShareCardLayout = z.infer<typeof shareCardLayoutSchema>;

export const SHARE_CARD_LAYOUT_LABELS: Readonly<Record<ShareCardLayout, string>> = {
  CLASSIC: 'Clássico',
  SUMMARY: 'Resumo',
  HIGHLIGHT: 'Destaque',
  MUSCLES: 'Músculos',
  SPLITS: 'Parciais',
  STATIONS: 'Estações',
};

// --- Dados do cartão --------------------------------------------------------------------------

const seconds = z.number().int().min(0).max(86_400);

/** O que o cartão mostra, por modalidade. Todos os números já vêm do registro do treino. */
export const shareCardDataSchema = z.discriminatedUnion('modality', [
  z.object({
    modality: z.literal('STRENGTH'),
    title: z.string().trim().min(1).max(80),
    durationSeconds: seconds.nullable(),
    exercises: z.number().int().min(0).max(40),
    sets: z.number().int().min(0).max(400),
    /** Soma de repetições × carga das séries feitas, em kg (0 = só peso do corpo). */
    volumeKg: z.number().min(0).max(1_000_000),
    rpe: z.number().min(0).max(10).nullable(),
    /** Sexo biológico, só para escolher a silhueta; sem ele, o modelo "Músculos" não é oferecido. */
    body: z.enum(['male', 'female']).nullable(),
    muscles: z.array(shareCardMuscleSchema).max(14),
  }),
  z.object({
    modality: z.literal('RUNNING'),
    title: z.string().trim().min(1).max(80),
    durationSeconds: seconds.nullable(),
    distanceMeters: z.number().min(0).max(300_000).nullable(),
    avgPaceSecondsPerKm: z.number().min(100).max(1_800).nullable(),
    avgHeartRate: z.number().int().min(30).max(240).nullable(),
    elevationGainMeters: z.number().min(0).max(10_000).nullable(),
    /** Ritmo de cada km completo (s/km), na ordem; vazio sem parciais. */
    splits: z.array(z.number().min(100).max(1_800)).max(60),
    rpe: z.number().min(0).max(10).nullable(),
    treadmill: z.boolean(),
  }),
  z.object({
    modality: z.literal('HYROX'),
    title: z.string().trim().min(1).max(80),
    durationSeconds: seconds.nullable(),
    runDistanceMeters: z.number().min(0).max(100_000).nullable(),
    rounds: z.number().int().min(1).max(10),
    /** Estações do circuito, na ordem, com o tempo quando o relógio registrou. */
    stations: z
      .array(z.object({ station: hyroxStationSchema, seconds: seconds.nullable() }))
      .max(16),
    rpe: z.number().min(0).max(10).nullable(),
  }),
  z.object({
    modality: z.literal('EXTERNAL_SPORT'),
    title: z.string().trim().min(1).max(80),
    sport: z.string().trim().min(1).max(80),
    durationSeconds: seconds.nullable(),
    rpe: z.number().min(0).max(10).nullable(),
  }),
]);
export type ShareCardData = z.infer<typeof shareCardDataSchema>;

/** Pedido de uma imagem: o modelo escolhido (o fundo é sempre transparente). */
export const shareCardRequestSchema = z.object({
  layout: shareCardLayoutSchema,
});
export type ShareCardRequest = z.infer<typeof shareCardRequestSchema>;

/** O que a página recebe de um treino fechado: os modelos disponíveis e os números. */
export const shareCardOptionsSchema = z.object({
  layouts: z.array(shareCardLayoutSchema).min(1),
  data: shareCardDataSchema,
});
export type ShareCardOptions = z.infer<typeof shareCardOptionsSchema>;

/** Pré-visualização sem treino gravado (página de demonstração local). */
export const shareCardPreviewSchema = shareCardRequestSchema.extend({ data: shareCardDataSchema });
export type ShareCardPreview = z.infer<typeof shareCardPreviewSchema>;

/**
 * Modelos que fazem sentido para o treino, do padrão ao mais específico. Modelo que dependeria
 * de dado ausente (parciais sem km completo, silhueta sem músculos) não é oferecido.
 */
export function shareCardLayoutsFor(data: ShareCardData): ShareCardLayout[] {
  // O clássico (o cartão de sempre) abre o carrossel; o específico da modalidade vem logo depois.
  const layouts: ShareCardLayout[] = ['CLASSIC'];
  if (data.modality === 'STRENGTH' && data.body && data.muscles.length > 0) layouts.push('MUSCLES');
  if (data.modality === 'RUNNING' && data.splits.length >= 2) layouts.push('SPLITS');
  if (data.modality === 'HYROX' && data.stations.length > 0) layouts.push('STATIONS');
  layouts.push('SUMMARY', 'HIGHLIGHT');
  return layouts;
}

// --- Formatação dos números (a mesma no desenho e na página) ---------------------------------

/** 3_909 → "01:05:09": o relógio do cronômetro do treino e do cartão clássico (sempre h:m:s). */
export function formatShareCardClock(totalSeconds: number | null): string {
  if (totalSeconds === null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return '—';
  const total = Math.floor(totalSeconds);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** 5_423 → "1:30:23"; 1_694 → "28:14". Tempo de cronômetro, sem arredondar. */
export function formatShareCardDuration(totalSeconds: number | null): string {
  if (totalSeconds === null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return '—';
  const total = Math.floor(totalSeconds);
  const pad = (value: number) => String(value).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(total % 60)}`
    : `${minutes}:${pad(total % 60)}`;
}

/** 5_020 → "5,02"; 21_097 → "21,10". */
export function formatShareCardKm(meters: number): string {
  return (meters / 1000).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** 12_340 → "12.340"; 0 → "0". */
export function formatShareCardKg(kg: number): string {
  return Math.round(kg).toLocaleString('pt-BR');
}

/** Nome da modalidade no selo do cartão. */
export function shareCardModalityLabel(data: ShareCardData): string {
  if (data.modality === 'EXTERNAL_SPORT') return data.sport;
  if (data.modality === 'RUNNING' && data.treadmill) return 'Corrida na esteira';
  return SESSION_MODALITY_LABELS[data.modality];
}
