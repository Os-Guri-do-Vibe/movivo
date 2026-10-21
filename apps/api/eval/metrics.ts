/**
 * Medições NEUTRAS de um protocolo (nenhuma é regra de metodologia): descrevem o que o
 * rascunho contém — sequência de grupos por sessão, séries diretas por grupo, frequência,
 * tempo estimado. Quem julga se isso está certo é a metodologia publicada (juiz/RT), não
 * este arquivo; os números abaixo só servem para comparar variantes do pipeline entre si.
 */
import type { ProtocolStructure } from '@movivo/shared';

import type { CatalogExercise } from '../src/modules/protocol/exercise-catalog';

const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/** Grupos "principais" para frequência/volume (core, cardio e corpo todo ficam de fora). */
export const MAIN_GROUPS = [
  'peito',
  'costas',
  'ombro',
  'quadriceps',
  'posterior de coxa',
  'gluteo',
  'biceps',
  'triceps',
] as const;

const LABEL_GROUPS: Record<string, string[]> = {
  peito: ['peito'],
  costas: ['costas'],
  dorsal: ['costas'],
  trapezio: ['costas'],
  ombro: ['ombro'],
  braco: ['biceps', 'triceps'],
  biceps: ['biceps'],
  triceps: ['triceps'],
  perna: ['quadriceps', 'posterior de coxa', 'gluteo', 'panturrilha'],
  inferior: ['quadriceps', 'posterior de coxa', 'gluteo', 'panturrilha'],
  quadriceps: ['quadriceps'],
  gluteo: ['gluteo'],
  posterior: ['posterior de coxa'],
  empurrar: ['peito', 'ombro', 'triceps'],
  puxar: ['costas', 'biceps'],
  push: ['peito', 'ombro', 'triceps'],
  pull: ['costas', 'biceps'],
  legs: ['quadriceps', 'posterior de coxa', 'gluteo', 'panturrilha'],
  superior: ['peito', 'costas', 'ombro', 'biceps', 'triceps'],
};

export interface Measurements {
  sessions: number;
  exercisesPerSession: number;
  /** Grupo reaparece na mesma sessão depois de outro grupo (A,B,A). */
  groupReturns: number;
  /** Sessões com músculo de ênfase em que ele abre a sessão. */
  emphasisFirst: { first: number; of: number };
  weeklySets: Record<string, number>;
  /** Séries semanais diretas: média das ênfases ÷ média dos demais grupos principais presentes. */
  emphasisVolumeRatio: number | null;
  /** Fração dos grupos principais com ≥ 10 séries/semana (só para hipertrofia faz sentido). */
  mainGroupsAtFloor: number;
  frequency: Record<string, number>;
  mainGroupsWithFreq2: number;
  /** Exercícios cujo grupo não pertence ao que o título/foco da sessão anuncia. */
  offSessionExercises: { off: number; of: number };
  estimatedMinutesPerSession: number;
  timeUtilization: number | null;
  isolationShare: number;
}

export function estimateSessionMinutes(
  session: ProtocolStructure['sessions'][number],
  byId: ReadonlyMap<string, CatalogExercise>,
): number {
  let minutes = 4; // aquecimento geral
  for (const exercise of session.exercises) {
    const entry = byId.get(exercise.exerciseId);
    if (entry?.pattern === 'CARDIO') {
      minutes += (exercise.durationSeconds ?? 600) / 60;
      continue;
    }
    const rest = exercise.restSeconds ?? 60;
    const work = exercise.durationSeconds ?? 45;
    minutes += (exercise.sets * (work + rest)) / 60 + 1;
    for (const warmup of exercise.warmupBlocks ?? []) {
      minutes += (warmup.sets * (30 + (warmup.restSeconds ?? 30))) / 60;
    }
  }
  return minutes;
}

export function measure(
  structure: ProtocolStructure,
  byId: ReadonlyMap<string, CatalogExercise>,
  opts: { emphasis: readonly string[]; sessionMinutes?: number },
): Measurements {
  const emphasis = opts.emphasis.map(norm);
  const primary = (id: string): string => {
    const entry = byId.get(id);
    return entry ? norm(entry.muscleGroups[0] ?? '??') : '??';
  };

  let groupReturns = 0;
  let emphFirst = 0;
  let emphOf = 0;
  let off = 0;
  let offOf = 0;
  let isolation = 0;
  let total = 0;
  const weekly: Record<string, number> = {};
  const freq: Record<string, number> = {};

  for (const session of structure.sessions) {
    const seq = session.exercises.map((e) => primary(e.exerciseId));
    const collapsed = seq.filter((g, i) => i === 0 || g !== seq[i - 1]);
    groupReturns += collapsed.length - new Set(collapsed).size;

    if (collapsed.some((g) => emphasis.includes(g))) {
      emphOf++;
      if (emphasis.includes(collapsed[0] ?? '')) emphFirst++;
    }

    const label = norm(`${session.dayLabel} ${session.focus}`);
    const announced = new Set<string>();
    for (const [key, groups] of Object.entries(LABEL_GROUPS)) {
      if (label.includes(key)) groups.forEach((g) => announced.add(g));
    }
    for (const exercise of session.exercises) {
      const entry = byId.get(exercise.exerciseId);
      const group = primary(exercise.exerciseId);
      total++;
      if (entry?.pattern === 'ISOLATION') isolation++;
      if (entry?.pattern !== 'CARDIO') weekly[group] = (weekly[group] ?? 0) + exercise.sets;
      if (announced.size > 0) {
        offOf++;
        if (
          !announced.has(group) &&
          !['core', 'sistema cardiovascular', 'corpo todo', '??'].includes(group)
        ) {
          off++;
        }
      }
    }
    for (const group of new Set(seq)) freq[group] = (freq[group] ?? 0) + 1;
  }

  const present = MAIN_GROUPS.filter((g) => (weekly[g] ?? 0) > 0);
  const emphSets = emphasis
    .filter((g) => MAIN_GROUPS.includes(g as never))
    .map((g) => weekly[g] ?? 0);
  const otherSets = present.filter((g) => !emphasis.includes(g)).map((g) => weekly[g] ?? 0);
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const minutes = structure.sessions.map((s) => estimateSessionMinutes(s, byId));
  const avgMinutes = mean(minutes);

  return {
    sessions: structure.sessions.length,
    exercisesPerSession: total / structure.sessions.length,
    groupReturns,
    emphasisFirst: { first: emphFirst, of: emphOf },
    weeklySets: weekly,
    emphasisVolumeRatio:
      emphSets.length > 0 && otherSets.length > 0 ? mean(emphSets) / mean(otherSets) : null,
    mainGroupsAtFloor:
      MAIN_GROUPS.filter((g) => (weekly[g] ?? 0) >= 10).length / MAIN_GROUPS.length,
    frequency: freq,
    mainGroupsWithFreq2:
      present.length === 0 ? 0 : present.filter((g) => (freq[g] ?? 0) >= 2).length / present.length,
    offSessionExercises: { off, of: offOf },
    estimatedMinutesPerSession: avgMinutes,
    timeUtilization: opts.sessionMinutes ? avgMinutes / opts.sessionMinutes : null,
    isolationShare: total === 0 ? 0 : isolation / total,
  };
}
