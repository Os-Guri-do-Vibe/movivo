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
 *
 * ⚠️ v4 (2026-08): o mapeamento de `PREGNANCY` neste catálogo é **conservador e
 * provisório** — marcado por posição corporal (decúbito dorsal/ventral) e impacto, na
 * dúvida sempre a favor de excluir. Pende validação clínica do RT CREF responsável antes
 * de qualquer uso com pessoas reais; não é orientação obstétrica.
 */
import type { TrainingLocation } from '@movivo/shared';

/** Tag de contraindicação — vocabulário fechado que liga lesão/PAR-Q → exclusão de exercício. */
export type ContraindicationTag =
  | 'SHOULDER'
  | 'ELBOW'
  | 'WRIST'
  | 'LOWER_BACK'
  | 'HIP'
  | 'KNEE'
  | 'ANKLE'
  | 'NECK'
  | 'CARDIAC'
  /** Tontura/desmaio (PAR-Q Q4): veta unilateral, deslocamento e qualquer risco de queda. */
  | 'BALANCE_FALL_RISK'
  /** Gravidez/pós-parto (PAR-Q Q7): veta decúbito dorsal/ventral e alto impacto. */
  | 'PREGNANCY';

export type MovementPattern =
  | 'HORIZONTAL_PUSH'
  | 'VERTICAL_PUSH'
  | 'HORIZONTAL_PULL'
  | 'VERTICAL_PULL'
  | 'SQUAT'
  | 'HINGE'
  | 'LUNGE'
  | 'CORE'
  | 'CARDIO'
  /** Isolado (mono/biarticular) — COMPLEMENTO da sessão, nunca a base (metodologia v2, item 5). */
  | 'ISOLATION';

/**
 * Local de treino — os 4 valores reais da anamnese v2 (decisão do fundador
 * 2026-08-10, item 4). Substitui `HOME`/`GYM`/`BOTH`, que não conseguiam
 * representar "academia de condomínio" (tem halteres e banco, raramente barra,
 * rack, polia ou máquina) nem "ao ar livre" (peso do corpo, faixa elástica,
 * barra de parque e banco — não é "casa").
 *
 * O tipo é o mesmo `TrainingLocation` do contrato compartilhado: um exercício
 * declara em QUAIS locais ele cabe, em vez de um valor curinga `BOTH`.
 */
export type ExerciseLocation = TrainingLocation;
export type ExerciseLevel = 'INICIANTE' | 'INTERMEDIARIO' | 'AVANCADO';

/**
 * Como o exercício é prescrito (achado 2026-08-18). `REPS` (padrão, quando ausente) = sets×reps
 * tradicional. `DURATION` = por tempo — isométrico (prancha) ou cardio contínuo/intervalado
 * (caminhada, bike, tiros), onde "reps" não tem sentido físico nenhum. Sem essa distinção, a IA
 * era forçada a inventar um número de reps pra prancha e o `ValidationService` bloqueava (com
 * razão) o resultado, mandando o protocolo pra revisão humana toda vez que esses exercícios
 * eram escolhidos.
 */
export type ExerciseMeasurement = 'REPS' | 'DURATION';

export interface CatalogExercise {
  id: string;
  name: string;
  pattern: MovementPattern;
  muscleGroups: string[];
  /** Equipamento necessário; `[]` = peso do corpo (sempre disponível). */
  equipment: string[];
  /** Locais em que o exercício é viável. Vazio nunca — todo exercício serve a algum lugar. */
  locations: readonly ExerciseLocation[];
  minLevel: ExerciseLevel;
  /** Lesões que contraindicam este exercício (evitar quando a flag está presente). */
  contraindicatedFor: ContraindicationTag[];
  /** Substitutos no MESMO padrão de movimento (ids do catálogo). */
  substitutes: string[];
  /** Ausente = `REPS` (maioria do catálogo, sets×reps tradicional). */
  measurement?: ExerciseMeasurement;
  /**
   * Só relevante com `measurement: 'DURATION'`: faixa plausível de segundos por série/intervalo.
   * Ausente = faixa padrão de isometria (`DURATION_SECONDS_RANGE`, validation-rules.ts) — curta
   * (segurar prancha). Cardio contínuo (caminhada/bike, 1 série só) e intervalo (tiros) têm faixa
   * própria porque a escala de tempo é completamente diferente de um hold isométrico.
   */
  durationSecondsRange?: { min: number; max: number };
  /**
   * Só relevante com `measurement: 'DURATION'`: piso de descanso entre séries/intervalos.
   * Ausente = piso padrão (`REST_SECONDS_RANGE.min`, 15s). Cardio contínuo é UMA série só —
   * "descanso zero" não é erro, é a única resposta correta.
   */
  minRestSeconds?: number;
}

/** Ordem de nível — filtro do prompt (gerador) e veto do validador usam o MESMO critério. */
export const LEVEL_ORDER: Record<ExerciseLevel, number> = {
  INICIANTE: 0,
  INTERMEDIARIO: 1,
  AVANCADO: 2,
};

export const CATALOG_VERSION = 'catalog-2026-08-v4';

/**
 * Catálogo MVP: cobre os padrões de movimento essenciais para os objetivos do ICP
 * (perder peso / ganhar massa / condicionamento) em casa e academia. Não é universal.
 *
 * v2 (2026-08): ganhou cobertura por GRUPO MUSCULAR (peito, costas, ombro, bíceps, tríceps,
 * quadríceps, posterior de coxa, glúteo, panturrilha, core) com pelo menos um multiarticular
 * e um isolado por grupo — sem isso as divisões ABC/PUSH_PULL_LEGS/FOCO_MUSCULAR da metodologia
 * v2 do RT não têm vocabulário para "um ou dois grupos por dia".
 * v3 (2026-08, Sprint 6): `location` (1 valor) virou `locations` (lista dos 4 locais reais).
 * A reclassificação foi exercício a exercício, não um mapeamento automático do valor antigo:
 * equipamento de máquina/polia/barra ficou só em `FULL_GYM`; halteres e banco alcançam
 * `CONDO_GYM` e `HOME`, mas não `OUTDOOR`; faixa elástica e peso do corpo alcançam os 4.
 * `chin_up` ganhou `OUTDOOR` (barra de parque) e entraram `step_up` e `sprint_intervals`
 * para que "ao ar livre" tivesse padrão de avanço e cardio próprios — sem eles, quem treina
 * na rua receberia um treino de sala de estar.
 * ponytail: cobertura suficiente para as divisões, não exaustiva — novo exercício entra quando
 * uma divisão real ficar sem opção, não "por completude".
 */
export const EXERCISE_CATALOG: readonly CatalogExercise[] = [
  // --- Empurrar horizontal ---
  {
    id: 'pushup',
    name: 'Flexão de braço',
    pattern: 'HORIZONTAL_PUSH',
    muscleGroups: ['peito', 'tríceps', 'ombro'],
    equipment: [],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['WRIST', 'SHOULDER', 'ELBOW', 'PREGNANCY'],
    substitutes: ['knee_pushup', 'db_bench_press', 'bench_press'],
  },
  {
    id: 'knee_pushup',
    name: 'Flexão de joelhos',
    pattern: 'HORIZONTAL_PUSH',
    muscleGroups: ['peito', 'tríceps'],
    equipment: [],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['WRIST', 'SHOULDER', 'PREGNANCY'],
    substitutes: ['pushup', 'db_bench_press'],
  },
  {
    id: 'db_bench_press',
    name: 'Supino com halteres',
    pattern: 'HORIZONTAL_PUSH',
    muscleGroups: ['peito', 'tríceps', 'ombro'],
    equipment: ['halteres', 'banco'],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['SHOULDER', 'PREGNANCY'],
    substitutes: ['pushup', 'bench_press'],
  },
  {
    id: 'bench_press',
    name: 'Supino reto com barra',
    pattern: 'HORIZONTAL_PUSH',
    muscleGroups: ['peito', 'tríceps', 'ombro'],
    equipment: ['barra', 'banco'],
    locations: ['FULL_GYM'],
    minLevel: 'INTERMEDIARIO',
    contraindicatedFor: ['SHOULDER', 'PREGNANCY'],
    substitutes: ['db_bench_press', 'pushup'],
  },
  // --- Empurrar vertical ---
  {
    id: 'db_shoulder_press',
    name: 'Desenvolvimento com halteres',
    pattern: 'VERTICAL_PUSH',
    muscleGroups: ['ombro', 'tríceps'],
    equipment: ['halteres'],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME'],
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
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR'],
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
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME'],
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
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['ELBOW', 'SHOULDER', 'PREGNANCY'],
    substitutes: ['db_row'],
  },
  {
    id: 'seated_row',
    name: 'Remada sentada na máquina',
    pattern: 'HORIZONTAL_PULL',
    muscleGroups: ['costas', 'bíceps'],
    equipment: ['máquina'],
    locations: ['FULL_GYM'],
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
    locations: ['FULL_GYM'],
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
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR'],
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
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR'],
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
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME'],
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
    locations: ['FULL_GYM'],
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
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['LOWER_BACK', 'PREGNANCY'],
    substitutes: ['db_romanian_deadlift'],
  },
  {
    id: 'db_romanian_deadlift',
    name: 'Levantamento terra romeno com halteres',
    pattern: 'HINGE',
    muscleGroups: ['posterior de coxa', 'glúteo', 'lombar'],
    equipment: ['halteres'],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME'],
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
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['KNEE', 'HIP', 'ANKLE', 'BALANCE_FALL_RISK'],
    substitutes: ['bodyweight_squat'],
  },
  // --- Core ---
  {
    id: 'plank',
    name: 'Prancha isométrica',
    pattern: 'CORE',
    muscleGroups: ['core'],
    equipment: [],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['LOWER_BACK', 'SHOULDER', 'PREGNANCY'],
    substitutes: ['dead_bug'],
    measurement: 'DURATION', // hold isométrico — sem faixa própria, usa o default de isometria
  },
  {
    id: 'dead_bug',
    name: 'Dead bug',
    pattern: 'CORE',
    muscleGroups: ['core'],
    equipment: [],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['PREGNANCY'],
    substitutes: ['plank'],
  },
  // --- Cardio / condicionamento ---
  {
    id: 'brisk_walk',
    name: 'Caminhada acelerada',
    pattern: 'CARDIO',
    muscleGroups: ['sistema cardiovascular'],
    equipment: [],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['CARDIAC', 'ANKLE'],
    substitutes: ['stationary_bike'],
    // Cardio contínuo: 1 série, sem intervalo — 5 a 40min, descanso 0 é a resposta certa.
    measurement: 'DURATION',
    durationSecondsRange: { min: 300, max: 2400 },
    minRestSeconds: 0,
  },
  {
    id: 'stationary_bike',
    name: 'Bicicleta ergométrica',
    pattern: 'CARDIO',
    muscleGroups: ['sistema cardiovascular'],
    equipment: ['bicicleta ergométrica'],
    locations: ['FULL_GYM', 'CONDO_GYM'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['CARDIAC'],
    substitutes: ['brisk_walk'],
    measurement: 'DURATION',
    durationSecondsRange: { min: 300, max: 2400 },
    minRestSeconds: 0,
  },

  // === v2 — cobertura por grupo muscular (divisões ABC / PPL / FOCO_MUSCULAR) ===
  // --- Multiarticulares que faltavam (bíceps, tríceps, glúteo) ---
  {
    id: 'chin_up',
    name: 'Barra fixa supinada',
    pattern: 'VERTICAL_PULL',
    muscleGroups: ['costas', 'bíceps'],
    equipment: ['barra fixa'],
    locations: ['FULL_GYM', 'CONDO_GYM', 'OUTDOOR'],
    minLevel: 'INTERMEDIARIO',
    contraindicatedFor: ['SHOULDER', 'ELBOW'],
    substitutes: ['lat_pulldown', 'band_pulldown'],
  },
  {
    id: 'bench_dip',
    name: 'Mergulho no banco',
    pattern: 'VERTICAL_PUSH',
    muscleGroups: ['tríceps', 'peito', 'ombro'],
    equipment: ['banco'],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['SHOULDER', 'WRIST', 'ELBOW'],
    substitutes: ['db_shoulder_press'],
  },
  {
    id: 'hip_thrust',
    name: 'Elevação de quadril com apoio no banco',
    pattern: 'HINGE',
    muscleGroups: ['glúteo', 'posterior de coxa'],
    equipment: ['banco'],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['LOWER_BACK', 'HIP', 'PREGNANCY'],
    substitutes: ['glute_bridge', 'db_romanian_deadlift'],
  },
  // --- Isolados (COMPLEMENTO da sessão, nunca a base) ---
  {
    id: 'db_fly',
    name: 'Crucifixo com halteres',
    pattern: 'ISOLATION',
    muscleGroups: ['peito'],
    equipment: ['halteres', 'banco'],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['SHOULDER', 'PREGNANCY'],
    substitutes: ['cable_crossover'],
  },
  {
    id: 'cable_crossover',
    name: 'Crucifixo na polia',
    pattern: 'ISOLATION',
    muscleGroups: ['peito'],
    equipment: ['polia'],
    locations: ['FULL_GYM'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['SHOULDER'],
    substitutes: ['db_fly'],
  },
  {
    id: 'db_pullover',
    name: 'Pullover com halter',
    pattern: 'ISOLATION',
    muscleGroups: ['costas', 'peito'],
    equipment: ['halteres', 'banco'],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME'],
    minLevel: 'INTERMEDIARIO',
    contraindicatedFor: ['SHOULDER', 'LOWER_BACK', 'PREGNANCY'],
    substitutes: ['band_straight_arm_pulldown'],
  },
  {
    id: 'band_straight_arm_pulldown',
    name: 'Pulldown de braços estendidos com faixa',
    pattern: 'ISOLATION',
    muscleGroups: ['costas'],
    equipment: ['faixa elástica'],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['SHOULDER'],
    substitutes: ['db_pullover'],
  },
  {
    id: 'db_lateral_raise',
    name: 'Elevação lateral com halteres',
    pattern: 'ISOLATION',
    muscleGroups: ['ombro'],
    equipment: ['halteres'],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['SHOULDER', 'NECK'],
    substitutes: ['band_lateral_raise'],
  },
  {
    id: 'band_lateral_raise',
    name: 'Elevação lateral com faixa elástica',
    pattern: 'ISOLATION',
    muscleGroups: ['ombro'],
    equipment: ['faixa elástica'],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['SHOULDER', 'NECK'],
    substitutes: ['db_lateral_raise'],
  },
  {
    id: 'db_curl',
    name: 'Rosca direta com halteres',
    pattern: 'ISOLATION',
    muscleGroups: ['bíceps'],
    equipment: ['halteres'],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['ELBOW', 'WRIST'],
    substitutes: ['band_curl'],
  },
  {
    id: 'band_curl',
    name: 'Rosca direta com faixa elástica',
    pattern: 'ISOLATION',
    muscleGroups: ['bíceps'],
    equipment: ['faixa elástica'],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['ELBOW'],
    substitutes: ['db_curl'],
  },
  {
    id: 'db_triceps_extension',
    name: 'Extensão de tríceps com halter',
    pattern: 'ISOLATION',
    muscleGroups: ['tríceps'],
    equipment: ['halteres'],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['ELBOW', 'SHOULDER'],
    substitutes: ['triceps_pushdown'],
  },
  {
    id: 'triceps_pushdown',
    name: 'Tríceps na polia alta',
    pattern: 'ISOLATION',
    muscleGroups: ['tríceps'],
    equipment: ['polia'],
    locations: ['FULL_GYM'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['ELBOW'],
    substitutes: ['db_triceps_extension'],
  },
  {
    id: 'leg_extension',
    name: 'Cadeira extensora',
    pattern: 'ISOLATION',
    muscleGroups: ['quadríceps'],
    equipment: ['máquina'],
    locations: ['FULL_GYM'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['KNEE'],
    substitutes: ['wall_sit'],
  },
  {
    id: 'wall_sit',
    name: 'Isometria na parede',
    pattern: 'ISOLATION',
    muscleGroups: ['quadríceps'],
    equipment: [],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['KNEE'],
    substitutes: ['leg_extension'],
    // Hold isométrico, igual prancha — achado 2026-08-18. `pattern: 'ISOLATION'` é sobre
    // isolado-vs-composto pra metodologia, não diz nada sobre medida: por isso a 1ª varredura
    // (que só olhou pattern CORE/CARDIO) deixou passar este.
    measurement: 'DURATION',
  },
  {
    id: 'leg_curl',
    name: 'Mesa flexora',
    pattern: 'ISOLATION',
    muscleGroups: ['posterior de coxa'],
    equipment: ['máquina'],
    locations: ['FULL_GYM'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['KNEE', 'PREGNANCY'],
    substitutes: ['band_leg_curl'],
  },
  {
    id: 'band_leg_curl',
    name: 'Flexão de joelhos com faixa elástica',
    pattern: 'ISOLATION',
    muscleGroups: ['posterior de coxa'],
    equipment: ['faixa elástica'],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['KNEE', 'PREGNANCY'],
    substitutes: ['leg_curl'],
  },
  {
    id: 'glute_kickback',
    name: 'Extensão de quadril em quatro apoios',
    pattern: 'ISOLATION',
    muscleGroups: ['glúteo'],
    equipment: [],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['LOWER_BACK', 'WRIST'],
    substitutes: ['band_hip_abduction'],
  },
  {
    id: 'band_hip_abduction',
    name: 'Abdução de quadril com faixa elástica',
    pattern: 'ISOLATION',
    muscleGroups: ['glúteo'],
    equipment: ['faixa elástica'],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['HIP'],
    substitutes: ['glute_kickback'],
  },
  {
    // ponytail: panturrilha não tem multiarticular real — duas variações isoladas bastam.
    id: 'standing_calf_raise',
    name: 'Elevação de panturrilha em pé',
    pattern: 'ISOLATION',
    muscleGroups: ['panturrilha'],
    equipment: [],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['ANKLE'],
    substitutes: ['seated_calf_raise'],
  },
  {
    id: 'seated_calf_raise',
    name: 'Elevação de panturrilha sentado',
    pattern: 'ISOLATION',
    muscleGroups: ['panturrilha'],
    equipment: ['máquina'],
    locations: ['FULL_GYM'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['ANKLE'],
    substitutes: ['standing_calf_raise'],
  },

  // === v3 — cobertura de "ao ar livre" (Sprint 6) ===
  {
    id: 'step_up',
    name: 'Subida no banco ou degrau',
    pattern: 'LUNGE',
    muscleGroups: ['quadríceps', 'glúteo'],
    equipment: [],
    locations: ['FULL_GYM', 'CONDO_GYM', 'HOME', 'OUTDOOR'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['KNEE', 'HIP', 'ANKLE', 'BALANCE_FALL_RISK'],
    substitutes: ['walking_lunge', 'bodyweight_squat'],
  },
  {
    id: 'sprint_intervals',
    name: 'Tiros de corrida',
    pattern: 'CARDIO',
    muscleGroups: ['sistema cardiovascular'],
    equipment: [],
    locations: ['FULL_GYM', 'OUTDOOR'],
    minLevel: 'INTERMEDIARIO',
    contraindicatedFor: ['CARDIAC', 'ANKLE', 'KNEE', 'BALANCE_FALL_RISK', 'PREGNANCY'],
    substitutes: ['brisk_walk'],
    // Intervalado: cada "série" é um tiro curto — ao contrário do cardio contínuo, o descanso
    // ENTRE tiros é real recuperação, não zero (usa o piso padrão de descanso).
    measurement: 'DURATION',
    durationSecondsRange: { min: 10, max: 60 },
  },
] as const;

/** O exercício serve a este local? Substitui o antigo curinga `BOTH`. */
export function servesLocation(
  exercise: Pick<CatalogExercise, 'locations'>,
  location: ExerciseLocation,
): boolean {
  return exercise.locations.includes(location);
}

/** Índice por id, para lookup O(1) do validador (US-2.3) e do gerador. */
export const EXERCISE_BY_ID: ReadonlyMap<string, CatalogExercise> = new Map(
  EXERCISE_CATALOG.map((e) => [e.id, e]),
);

/** `true` se o id existe na base. O validador (US-2.3) rejeita ids fora dela. */
export function isKnownExercise(id: string): boolean {
  return EXERCISE_BY_ID.has(id);
}
