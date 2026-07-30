/**
 * Base de referência de exercícios (US-2.1 / TASK-2.1.1).
 *
 * ⚠️ RASCUNHO — A VALIDAR PELO RT CREF. Este catálogo foi elaborado como ponto de
 * partida do MVP para destravar o desenvolvimento; o profissional de Educação Física
 * (Responsável Técnico, CREF) ainda precisa revisar e assinar clinicamente cada
 * exercício, contraindicação e substituto antes de qualquer uso com pessoas reais.
 * Nada aqui é orientação clínica definitiva.
 *
 * Duplo papel (decisão do fundador 2026-07):
 *  1. **Contexto do prompt** (US-2.1): a IA só pode usar `id`s que existem aqui.
 *  2. **Gabarito do validador** (US-2.3): exercício/local/equipamento/contraindicação
 *     fora do catálogo é rejeitado — a base é a rede de segurança, não o prompt.
 *
 * Versionado: uma mudança na base gera nova `CATALOG_VERSION` (rastreabilidade clínica).
 */

/** Tag de contraindicação — vocabulário fechado que liga lesão/PAR-Q → exclusão de exercício. */
export type ContraindicationTag =
  'SHOULDER' | 'ELBOW' | 'WRIST' | 'LOWER_BACK' | 'HIP' | 'KNEE' | 'ANKLE' | 'NECK' | 'CARDIAC';

export type MovementPattern =
  | 'HORIZONTAL_PUSH'
  | 'VERTICAL_PUSH'
  | 'HORIZONTAL_PULL'
  | 'VERTICAL_PULL'
  | 'SQUAT'
  | 'HINGE'
  | 'LUNGE'
  | 'CORE'
  | 'CARDIO';

export type ExerciseLocation = 'HOME' | 'GYM' | 'BOTH';
export type ExerciseLevel = 'INICIANTE' | 'INTERMEDIARIO' | 'AVANCADO';

export interface CatalogExercise {
  id: string;
  name: string;
  pattern: MovementPattern;
  muscleGroups: string[];
  /** Equipamento necessário; `[]` = peso do corpo (sempre disponível). */
  equipment: string[];
  location: ExerciseLocation;
  minLevel: ExerciseLevel;
  /** Lesões que contraindicam este exercício (evitar quando a flag está presente). */
  contraindicatedFor: ContraindicationTag[];
  /** Substitutos no MESMO padrão de movimento (ids do catálogo). */
  substitutes: string[];
}

export const CATALOG_VERSION = 'catalog-2026-07-draft-v1';

/**
 * Catálogo MVP: cobre os padrões de movimento essenciais para os objetivos do ICP
 * (perder peso / ganhar massa / condicionamento) em casa e academia. Não é universal.
 */
export const EXERCISE_CATALOG: readonly CatalogExercise[] = [
  // --- Empurrar horizontal ---
  {
    id: 'pushup',
    name: 'Flexão de braço',
    pattern: 'HORIZONTAL_PUSH',
    muscleGroups: ['peito', 'tríceps', 'ombro'],
    equipment: [],
    location: 'BOTH',
    minLevel: 'INICIANTE',
    contraindicatedFor: ['WRIST', 'SHOULDER', 'ELBOW'],
    substitutes: ['knee_pushup', 'db_bench_press', 'bench_press'],
  },
  {
    id: 'knee_pushup',
    name: 'Flexão de joelhos',
    pattern: 'HORIZONTAL_PUSH',
    muscleGroups: ['peito', 'tríceps'],
    equipment: [],
    location: 'BOTH',
    minLevel: 'INICIANTE',
    contraindicatedFor: ['WRIST', 'SHOULDER'],
    substitutes: ['pushup', 'db_bench_press'],
  },
  {
    id: 'db_bench_press',
    name: 'Supino com halteres',
    pattern: 'HORIZONTAL_PUSH',
    muscleGroups: ['peito', 'tríceps', 'ombro'],
    equipment: ['halteres', 'banco'],
    location: 'BOTH',
    minLevel: 'INICIANTE',
    contraindicatedFor: ['SHOULDER'],
    substitutes: ['pushup', 'bench_press'],
  },
  {
    id: 'bench_press',
    name: 'Supino reto com barra',
    pattern: 'HORIZONTAL_PUSH',
    muscleGroups: ['peito', 'tríceps', 'ombro'],
    equipment: ['barra', 'banco'],
    location: 'GYM',
    minLevel: 'INTERMEDIARIO',
    contraindicatedFor: ['SHOULDER'],
    substitutes: ['db_bench_press', 'pushup'],
  },
  // --- Empurrar vertical ---
  {
    id: 'db_shoulder_press',
    name: 'Desenvolvimento com halteres',
    pattern: 'VERTICAL_PUSH',
    muscleGroups: ['ombro', 'tríceps'],
    equipment: ['halteres'],
    location: 'BOTH',
    minLevel: 'INICIANTE',
    contraindicatedFor: ['SHOULDER', 'NECK'],
    substitutes: ['pike_pushup'],
  },
  {
    id: 'pike_pushup',
    name: 'Flexão pike',
    pattern: 'VERTICAL_PUSH',
    muscleGroups: ['ombro', 'tríceps'],
    equipment: [],
    location: 'HOME',
    minLevel: 'INTERMEDIARIO',
    contraindicatedFor: ['SHOULDER', 'WRIST', 'NECK'],
    substitutes: ['db_shoulder_press'],
  },
  // --- Puxar horizontal ---
  {
    id: 'db_row',
    name: 'Remada unilateral com halter',
    pattern: 'HORIZONTAL_PULL',
    muscleGroups: ['costas', 'bíceps'],
    equipment: ['halteres', 'banco'],
    location: 'BOTH',
    minLevel: 'INICIANTE',
    contraindicatedFor: ['LOWER_BACK', 'ELBOW'],
    substitutes: ['inverted_row', 'seated_row'],
  },
  {
    id: 'inverted_row',
    name: 'Remada invertida',
    pattern: 'HORIZONTAL_PULL',
    muscleGroups: ['costas', 'bíceps'],
    equipment: [],
    location: 'HOME',
    minLevel: 'INICIANTE',
    contraindicatedFor: ['ELBOW', 'SHOULDER'],
    substitutes: ['db_row'],
  },
  {
    id: 'seated_row',
    name: 'Remada sentada na máquina',
    pattern: 'HORIZONTAL_PULL',
    muscleGroups: ['costas', 'bíceps'],
    equipment: ['máquina'],
    location: 'GYM',
    minLevel: 'INICIANTE',
    contraindicatedFor: ['ELBOW'],
    substitutes: ['db_row', 'inverted_row'],
  },
  // --- Puxar vertical ---
  {
    id: 'lat_pulldown',
    name: 'Puxada alta na polia',
    pattern: 'VERTICAL_PULL',
    muscleGroups: ['costas', 'bíceps'],
    equipment: ['máquina'],
    location: 'GYM',
    minLevel: 'INICIANTE',
    contraindicatedFor: ['SHOULDER', 'ELBOW'],
    substitutes: ['band_pulldown'],
  },
  {
    id: 'band_pulldown',
    name: 'Puxada com faixa elástica',
    pattern: 'VERTICAL_PULL',
    muscleGroups: ['costas', 'bíceps'],
    equipment: ['faixa elástica'],
    location: 'HOME',
    minLevel: 'INICIANTE',
    contraindicatedFor: ['SHOULDER', 'ELBOW'],
    substitutes: ['lat_pulldown'],
  },
  // --- Agachar ---
  {
    id: 'bodyweight_squat',
    name: 'Agachamento livre (peso do corpo)',
    pattern: 'SQUAT',
    muscleGroups: ['quadríceps', 'glúteo'],
    equipment: [],
    location: 'BOTH',
    minLevel: 'INICIANTE',
    contraindicatedFor: ['KNEE', 'HIP'],
    substitutes: ['goblet_squat', 'leg_press'],
  },
  {
    id: 'goblet_squat',
    name: 'Agachamento goblet com halter',
    pattern: 'SQUAT',
    muscleGroups: ['quadríceps', 'glúteo'],
    equipment: ['halteres'],
    location: 'BOTH',
    minLevel: 'INICIANTE',
    contraindicatedFor: ['KNEE', 'HIP', 'LOWER_BACK'],
    substitutes: ['bodyweight_squat', 'leg_press'],
  },
  {
    id: 'leg_press',
    name: 'Leg press',
    pattern: 'SQUAT',
    muscleGroups: ['quadríceps', 'glúteo'],
    equipment: ['máquina'],
    location: 'GYM',
    minLevel: 'INICIANTE',
    contraindicatedFor: ['KNEE'],
    substitutes: ['bodyweight_squat', 'goblet_squat'],
  },
  // --- Levantar (hinge) ---
  {
    id: 'glute_bridge',
    name: 'Elevação de quadril',
    pattern: 'HINGE',
    muscleGroups: ['glúteo', 'posterior de coxa'],
    equipment: [],
    location: 'BOTH',
    minLevel: 'INICIANTE',
    contraindicatedFor: ['LOWER_BACK'],
    substitutes: ['db_romanian_deadlift'],
  },
  {
    id: 'db_romanian_deadlift',
    name: 'Levantamento terra romeno com halteres',
    pattern: 'HINGE',
    muscleGroups: ['posterior de coxa', 'glúteo', 'lombar'],
    equipment: ['halteres'],
    location: 'BOTH',
    minLevel: 'INTERMEDIARIO',
    contraindicatedFor: ['LOWER_BACK', 'HIP'],
    substitutes: ['glute_bridge'],
  },
  // --- Avanço (lunge) ---
  {
    id: 'walking_lunge',
    name: 'Afundo',
    pattern: 'LUNGE',
    muscleGroups: ['quadríceps', 'glúteo'],
    equipment: [],
    location: 'BOTH',
    minLevel: 'INICIANTE',
    contraindicatedFor: ['KNEE', 'HIP', 'ANKLE'],
    substitutes: ['bodyweight_squat'],
  },
  // --- Core ---
  {
    id: 'plank',
    name: 'Prancha isométrica',
    pattern: 'CORE',
    muscleGroups: ['core'],
    equipment: [],
    location: 'BOTH',
    minLevel: 'INICIANTE',
    contraindicatedFor: ['LOWER_BACK', 'SHOULDER'],
    substitutes: ['dead_bug'],
  },
  {
    id: 'dead_bug',
    name: 'Dead bug',
    pattern: 'CORE',
    muscleGroups: ['core'],
    equipment: [],
    location: 'BOTH',
    minLevel: 'INICIANTE',
    contraindicatedFor: [],
    substitutes: ['plank'],
  },
  // --- Cardio / condicionamento ---
  {
    id: 'brisk_walk',
    name: 'Caminhada acelerada',
    pattern: 'CARDIO',
    muscleGroups: ['sistema cardiovascular'],
    equipment: [],
    location: 'BOTH',
    minLevel: 'INICIANTE',
    contraindicatedFor: ['CARDIAC', 'ANKLE'],
    substitutes: ['stationary_bike'],
  },
  {
    id: 'stationary_bike',
    name: 'Bicicleta ergométrica',
    pattern: 'CARDIO',
    muscleGroups: ['sistema cardiovascular'],
    equipment: ['bicicleta ergométrica'],
    location: 'GYM',
    minLevel: 'INICIANTE',
    contraindicatedFor: ['CARDIAC'],
    substitutes: ['brisk_walk'],
  },
] as const;

/** Índice por id, para lookup O(1) do validador (US-2.3) e do gerador. */
export const EXERCISE_BY_ID: ReadonlyMap<string, CatalogExercise> = new Map(
  EXERCISE_CATALOG.map((e) => [e.id, e]),
);

/** `true` se o id existe na base. O validador (US-2.3) rejeita ids fora dela. */
export function isKnownExercise(id: string): boolean {
  return EXERCISE_BY_ID.has(id);
}
