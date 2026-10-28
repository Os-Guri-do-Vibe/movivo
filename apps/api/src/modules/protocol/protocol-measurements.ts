/**
 * Medições NEUTRAS de um rascunho de protocolo (achado 2026-10-21, auditoria da aderência à
 * metodologia do RT).
 *
 * A metodologia exige contas que o modelo de geração (DeepSeek V4 Pro, `thinking` desligado)
 * não faz de cabeça enquanto emite JSON: séries diretas por grupo na semana, frequência por
 * grupo, ordem dos grupos na sessão, tempo que cabe na sessão. Este módulo só MEDE — nunca
 * julga. Nenhum número daqui é regra: quem diz se uma sequência, um volume ou uma frequência
 * está certo é a metodologia publicada (lida pelo gerador e pelo juiz contextual), então
 * editar a metodologia não exige mexer neste arquivo.
 *
 * Grupo de um exercício = primeiro item de `muscleGroups` do catálogo (386 de 388 exercícios
 * têm um só). Cardio fica fora da contagem de séries.
 */
import type { ProtocolStructure } from '@movivo/shared';

import type { CatalogExercise } from '../catalog/exercises/exercise-catalog';

type Session = ProtocolStructure['sessions'][number];
type CatalogLookup = Pick<{ getById(id: string): CatalogExercise | undefined }, 'getById'>;

/** Grupo que o catálogo não conhece (id inexistente) — aparece nas medições, nunca é escondido. */
export const UNKNOWN_GROUP = '(fora da base)';

export interface SessionMeasurement {
  index: number;
  weekday?: string;
  dayLabel: string;
  exerciseCount: number;
  /** Grupos na ordem em que aparecem, colapsando exercícios consecutivos do mesmo grupo. */
  groupSequence: string[];
  /** Grupos que voltam depois de outro grupo na mesma sessão (ex.: peito, costas, peito). */
  revisitedGroups: string[];
  estimatedMinutes: number;
}

export interface ProtocolMeasurements {
  sessions: SessionMeasurement[];
  /** Séries de musculação por grupo na semana (sem aquecimento e sem cardio). */
  weeklySetsByGroup: Record<string, number>;
  /** Em quantas sessões da semana o grupo aparece. */
  weeklyFrequencyByGroup: Record<string, number>;
  emphasis: Array<{ group: string; weeklySets: number; frequency: number }>;
  /** Média de séries semanais dos grupos presentes que NÃO são ênfase (null sem referência). */
  nonEmphasisAverageSets: number | null;
  declaredSessionMinutes?: number;
  averageEstimatedMinutes: number;
}

const normalized = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();

/**
 * Duração aproximada de uma sessão: aquecimento geral, cada série (execução + descanso),
 * troca de exercício/carga e blocos de aquecimento específico. É ESTIMATIVA — mesma
 * ressalva do juiz contextual ("sem inventar precisão que o protocolo não fornece").
 */
export function estimateSessionMinutes(session: Session, catalog: CatalogLookup): number {
  let minutes = 4;
  for (const exercise of session.exercises) {
    if (catalog.getById(exercise.exerciseId)?.pattern === 'CARDIO') {
      minutes += (exercise.durationSeconds ?? 600) / 60;
      continue;
    }
    const work = exercise.durationSeconds ?? 45;
    const rest = exercise.restSeconds ?? 60;
    minutes += (exercise.sets * (work + rest)) / 60 + 1;
    for (const warmup of exercise.warmupBlocks ?? []) {
      minutes += (warmup.sets * (30 + (warmup.restSeconds ?? 30))) / 60;
    }
  }
  return minutes;
}

export function measureProtocol(
  structure: ProtocolStructure,
  catalog: CatalogLookup,
  options: { emphasis?: readonly string[]; sessionMinutes?: number } = {},
): ProtocolMeasurements {
  const groupOf = (exerciseId: string): string => {
    const entry = catalog.getById(exerciseId);
    return entry ? (entry.muscleGroups[0] ?? UNKNOWN_GROUP) : UNKNOWN_GROUP;
  };
  const weeklySetsByGroup: Record<string, number> = {};
  const weeklyFrequencyByGroup: Record<string, number> = {};

  const sessions = structure.sessions.map((session, index): SessionMeasurement => {
    const sequence: string[] = [];
    for (const exercise of session.exercises) {
      const group = groupOf(exercise.exerciseId);
      if (sequence[sequence.length - 1] !== group) sequence.push(group);
      if (catalog.getById(exercise.exerciseId)?.pattern !== 'CARDIO') {
        weeklySetsByGroup[group] = (weeklySetsByGroup[group] ?? 0) + exercise.sets;
      }
    }
    for (const group of new Set(sequence)) {
      weeklyFrequencyByGroup[group] = (weeklyFrequencyByGroup[group] ?? 0) + 1;
    }
    const seen = new Set<string>();
    const revisited = new Set<string>();
    for (const group of sequence) {
      if (seen.has(group)) revisited.add(group);
      seen.add(group);
    }
    return {
      index,
      ...(session.weekday ? { weekday: session.weekday } : {}),
      dayLabel: session.dayLabel,
      exerciseCount: session.exercises.length,
      groupSequence: sequence,
      revisitedGroups: [...revisited],
      estimatedMinutes: Math.round(estimateSessionMinutes(session, catalog)),
    };
  });

  const emphasisKeys = new Set((options.emphasis ?? []).map(normalized));
  const emphasis = (options.emphasis ?? []).map((group) => {
    const key = Object.keys(weeklySetsByGroup).find((g) => normalized(g) === normalized(group));
    return {
      group,
      weeklySets: key ? (weeklySetsByGroup[key] ?? 0) : 0,
      frequency: key ? (weeklyFrequencyByGroup[key] ?? 0) : 0,
    };
  });
  // "core"/"corpo todo" não são referência de volume de grupo: ficam fora da média.
  const reference = Object.entries(weeklySetsByGroup)
    .filter(([group]) => !emphasisKeys.has(normalized(group)))
    .filter(([group]) => !['core', 'corpo todo', UNKNOWN_GROUP].includes(group))
    .map(([, sets]) => sets);

  const minutes = sessions.map((s) => s.estimatedMinutes);
  return {
    sessions,
    weeklySetsByGroup,
    weeklyFrequencyByGroup,
    emphasis,
    nonEmphasisAverageSets:
      reference.length > 0 ? reference.reduce((a, b) => a + b, 0) / reference.length : null,
    ...(options.sessionMinutes ? { declaredSessionMinutes: options.sessionMinutes } : {}),
    averageEstimatedMinutes:
      minutes.length > 0 ? minutes.reduce((a, b) => a + b, 0) / minutes.length : 0,
  };
}
