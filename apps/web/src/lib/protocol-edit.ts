/**
 * Edição manual do protocolo em revisão, sem efeito colateral: reordenar sessões e exercícios,
 * adicionar/trocar/remover exercício do catálogo, adicionar sessão de musculação. Os limites aqui
 * são os do contrato (`@movivo/shared`); a conferência de verdade (segurança do aluno, semana que
 * cabe, metodologia) continua no servidor, que devolve cada problema com o caminho do campo.
 */
import type {
  NutritionPlanStructure,
  PlanSession,
  ProtocolReview,
  ProtocolWeekModel,
  StrengthExercise,
  TrainingPlanStructure,
  Weekday,
} from '@movivo/shared';

import { capitalize, normalizeSearch, sessionLetter } from './protocol-format';

export type CatalogOption = Extract<
  ProtocolReview,
  { kind: 'TRAINING' }
>['exerciseOptions'][number];

export const LIMITS = {
  /** `strengthSessionContentSchema.exercises.max(15)` */
  exercisesPerSession: 15,
  /** `trainingPlanStructureSchema.sessions.max(14)` */
  sessions: 14,
} as const;

/* -------------------------------------------------------------------------- */
/* Listas                                                                     */
/* -------------------------------------------------------------------------- */

/** Move um item de `from` para `to` (índices fora da lista não mudam nada). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return [...list];
  }
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

const replaceAt = <T>(list: readonly T[], index: number, item: T): T[] =>
  list.map((current, i) => (i === index ? item : current));

/* -------------------------------------------------------------------------- */
/* Sessões                                                                    */
/* -------------------------------------------------------------------------- */

export function updateSession(
  structure: TrainingPlanStructure,
  index: number,
  session: PlanSession,
): TrainingPlanStructure {
  return { ...structure, sessions: replaceAt(structure.sessions, index, session) };
}

/** Remove a sessão; o plano nunca fica sem nenhuma. */
export function removeSession(
  structure: TrainingPlanStructure,
  index: number,
): TrainingPlanStructure {
  if (structure.sessions.length <= 1) return structure;
  return { ...structure, sessions: structure.sessions.filter((_, i) => i !== index) };
}

function uniqueKey(structure: TrainingPlanStructure): { key: string; letter: string } {
  const taken = new Set(structure.sessions.map((s) => s.key));
  for (let index = 0; index < 40; index += 1) {
    const letter = sessionLetter(index);
    const key = `STR_${letter}`;
    if (!taken.has(key)) return { key, letter };
  }
  return { key: `STR_${Date.now() % 100_000}`, letter: String(structure.sessions.length + 1) };
}

/** Sessão de musculação nova, com o primeiro exercício já escolhido do catálogo. */
export function addStrengthSession(
  structure: TrainingPlanStructure,
  first: CatalogOption,
): TrainingPlanStructure {
  if (structure.sessions.length >= LIMITS.sessions) return structure;
  const { key, letter } = uniqueKey(structure);
  const session: PlanSession = {
    key,
    title: `Força ${letter}`,
    purpose: 'Sessão adicionada pelo profissional na revisão.',
    priority: 'IMPORTANT',
    weeklyFrequency: 1,
    estimatedMinutes: 45,
    estimatedRpe: 6,
    content: { modality: 'STRENGTH', focus: 'Novo treino', exercises: [exerciseFrom(first)] },
  };
  const hasStrength = structure.modalityPriorities.some((p) => p.modality === 'STRENGTH');
  return {
    ...structure,
    // O contrato exige prioridade para toda modalidade com sessão no plano.
    modalityPriorities:
      hasStrength || structure.modalityPriorities.length >= 3
        ? structure.modalityPriorities
        : [...structure.modalityPriorities, { modality: 'STRENGTH', priority: 3 }],
    sessions: [...structure.sessions, session],
  };
}

/** Pode adicionar sessão de musculação (limite de sessões e de modalidades priorizadas). */
export function canAddStrengthSession(structure: TrainingPlanStructure): boolean {
  if (structure.sessions.length >= LIMITS.sessions) return false;
  return (
    structure.modalityPriorities.some((p) => p.modality === 'STRENGTH') ||
    structure.modalityPriorities.length < 3
  );
}

/* -------------------------------------------------------------------------- */
/* Exercícios                                                                 */
/* -------------------------------------------------------------------------- */

/** Prescrição inicial de um exercício escolhido no catálogo (o profissional ajusta em seguida). */
export function exerciseFrom(option: CatalogOption): StrengthExercise {
  const byTime = option.measurement === 'DURATION';
  return {
    exerciseId: option.id,
    name: option.name,
    sets: 3,
    ...(byTime ? { durationSeconds: 30 } : { reps: { min: 8, max: 12 } }),
    loadStrategy: byTime ? 'BODYWEIGHT' : 'DOUBLE_PROGRESSION',
    rir: byTime ? undefined : 2,
    restSeconds: byTime ? 45 : 90,
  };
}

function withExercises(
  structure: TrainingPlanStructure,
  sessionIndex: number,
  change: (exercises: StrengthExercise[]) => StrengthExercise[],
): TrainingPlanStructure {
  const session = structure.sessions[sessionIndex];
  if (!session || session.content.modality !== 'STRENGTH') return structure;
  return updateSession(structure, sessionIndex, {
    ...session,
    content: { ...session.content, exercises: change(session.content.exercises) },
  });
}

export function moveExercise(
  structure: TrainingPlanStructure,
  sessionIndex: number,
  from: number,
  to: number,
): TrainingPlanStructure {
  return withExercises(structure, sessionIndex, (list) => moveItem(list, from, to));
}

export function updateExercise(
  structure: TrainingPlanStructure,
  sessionIndex: number,
  exerciseIndex: number,
  exercise: StrengthExercise,
): TrainingPlanStructure {
  return withExercises(structure, sessionIndex, (list) => replaceAt(list, exerciseIndex, exercise));
}

export function addExercise(
  structure: TrainingPlanStructure,
  sessionIndex: number,
  option: CatalogOption,
): TrainingPlanStructure {
  return withExercises(structure, sessionIndex, (list) =>
    list.length >= LIMITS.exercisesPerSession ? list : [...list, exerciseFrom(option)],
  );
}

/** Troca o exercício mantendo séries, descanso e carga; repetições ↔ tempo segue o catálogo. */
export function replaceExercise(
  structure: TrainingPlanStructure,
  sessionIndex: number,
  exerciseIndex: number,
  option: CatalogOption,
): TrainingPlanStructure {
  return withExercises(structure, sessionIndex, (list) =>
    list.map((current, index) => {
      if (index !== exerciseIndex) return current;
      const byTime = option.measurement === 'DURATION';
      return {
        ...current,
        exerciseId: option.id,
        name: option.name,
        reps: byTime ? undefined : (current.reps ?? { min: 8, max: 12 }),
        durationSeconds: byTime ? (current.durationSeconds ?? 30) : undefined,
      };
    }),
  );
}

/** Remove o exercício; a sessão nunca fica vazia. */
export function removeExercise(
  structure: TrainingPlanStructure,
  sessionIndex: number,
  exerciseIndex: number,
): TrainingPlanStructure {
  return withExercises(structure, sessionIndex, (list) =>
    list.length <= 1 ? list : list.filter((_, index) => index !== exerciseIndex),
  );
}

/**
 * Chave estável de cada exercício na lista (o id do catálogo e a ocorrência dele), para a linha
 * manter o foco ao subir ou descer.
 */
export function exerciseKeys(exercises: readonly Pick<StrengthExercise, 'exerciseId'>[]): string[] {
  const seen = new Map<string, number>();
  return exercises.map((exercise) => {
    const count = seen.get(exercise.exerciseId) ?? 0;
    seen.set(exercise.exerciseId, count + 1);
    return `${exercise.exerciseId}#${count}`;
  });
}

/* -------------------------------------------------------------------------- */
/* Busca no catálogo                                                          */
/* -------------------------------------------------------------------------- */

/** Valor do filtro de equipamento para "sem equipamento". */
export const BODYWEIGHT = '__peso_do_corpo__';

export interface CatalogFilter {
  query: string;
  muscle: string;
  equipment: string;
}

export function catalogFacets(options: readonly CatalogOption[]): {
  muscles: { value: string; label: string }[];
  equipment: { value: string; label: string }[];
} {
  const muscles = new Set<string>();
  const equipment = new Set<string>();
  let bodyweight = false;
  for (const option of options) {
    option.muscleGroups?.forEach((m) => muscles.add(m));
    if (option.equipment) {
      if (option.equipment.length === 0) bodyweight = true;
      option.equipment.forEach((e) => equipment.add(e));
    }
  }
  const sorted = (values: Set<string>) =>
    [...values]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
      .map((value) => ({ value, label: capitalize(value) }));
  return {
    muscles: sorted(muscles),
    equipment: [
      ...(bodyweight ? [{ value: BODYWEIGHT, label: 'Peso do corpo' }] : []),
      ...sorted(equipment),
    ],
  };
}

/** Filtra por nome (sem acento, todas as palavras), grupo muscular e equipamento. */
export function filterCatalog(
  options: readonly CatalogOption[],
  filter: CatalogFilter,
): CatalogOption[] {
  const words = normalizeSearch(filter.query).split(/\s+/).filter(Boolean);
  return options.filter((option) => {
    if (filter.muscle && !option.muscleGroups?.includes(filter.muscle)) return false;
    if (filter.equipment === BODYWEIGHT) {
      if (!option.equipment || option.equipment.length > 0) return false;
    } else if (filter.equipment && !option.equipment?.includes(filter.equipment)) {
      return false;
    }
    if (words.length === 0) return true;
    const haystack = normalizeSearch(
      [option.name, ...(option.muscleGroups ?? []), ...(option.equipment ?? [])].join(' '),
    );
    return words.every((word) => haystack.includes(word));
  });
}

/* -------------------------------------------------------------------------- */
/* Estado da edição                                                           */
/* -------------------------------------------------------------------------- */

export function isDirty(
  original: TrainingPlanStructure | NutritionPlanStructure,
  draft: TrainingPlanStructure | NutritionPlanStructure,
): boolean {
  return JSON.stringify(original) !== JSON.stringify(draft);
}

/**
 * Onde um problema aponta, para mostrar na linha certa: `exercise:0:2`, `session:1`, `meal:3`,
 * `targets:trainingDay`, ou `plan` (o plano inteiro).
 */
export function issueKey(path: readonly (string | number)[]): string {
  const [head, a, b, c, d] = path;
  if (head === 'sessions' && typeof a === 'number') {
    if (b === 'content' && c === 'exercises' && typeof d === 'number') {
      return `exercise:${a}:${d}`;
    }
    return `session:${a}`;
  }
  if (head === 'meals' && typeof a === 'number') return `meal:${a}`;
  if (head === 'trainingDay' || head === 'restDay') return `targets:${head}`;
  return 'plan';
}

export interface LocatedIssue {
  key: string;
  message: string;
}

/** Agrupa os problemas pelo lugar (a ordem de chegada é mantida). */
export function groupIssues(issues: readonly LocatedIssue[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const issue of issues) {
    const list = grouped.get(issue.key) ?? [];
    if (!list.includes(issue.message)) list.push(issue.message);
    grouped.set(issue.key, list);
  }
  return grouped;
}

/* -------------------------------------------------------------------------- */
/* Semana por dia                                                             */
/* -------------------------------------------------------------------------- */

export const WEEKDAYS: readonly Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** Onde cada ocorrência de cada sessão cai: `null` = sem dia (o planejador ainda não encaixou). */
export type Placement = ReadonlyMap<string, readonly (Weekday | null)[]>;

export interface OccurrenceRef {
  key: string;
  /** Posição da ocorrência na semana (0 = a primeira). */
  occurrence: number;
}

const isCoached = (session: PlanSession) => session.content.modality !== 'EXTERNAL_SPORT';

/**
 * Dia de cada ocorrência: o que o profissional marcou (`weekdays`) ou, onde não marcou, o da
 * semana-modelo do planejador. Esporte externo fica fora (os dias dele vêm do perfil do aluno).
 */
export function placementOf(
  structure: TrainingPlanStructure,
  model: ProtocolWeekModel | undefined,
): Placement {
  const placed = new Map<string, Weekday>();
  for (const item of model?.sessions ?? []) {
    placed.set(`${item.sessionKey}#${item.occurrence}`, item.weekday);
  }
  return new Map(
    structure.sessions
      .filter(isCoached)
      .map((session) => [
        session.key,
        Array.from(
          { length: session.weeklyFrequency },
          (_, i) => session.weekdays?.[i] ?? placed.get(`${session.key}#${i + 1}`) ?? null,
        ),
      ]),
  );
}

/** Grava o desenho da semana no protocolo; cada sessão passa a listar os dias das suas ocorrências. */
function withPlacement(
  structure: TrainingPlanStructure,
  placement: Placement,
): TrainingPlanStructure {
  return {
    ...structure,
    sessions: structure.sessions.map((session) => {
      const days = placement.get(session.key)?.filter((d): d is Weekday => d !== null);
      if (!days || days.length === 0) return session;
      return { ...session, weekdays: days };
    }),
  };
}

/** Quantas ocorrências já estão em cada dia (a sessão `ignore` não conta). */
function hasSameSessionOn(days: readonly (Weekday | null)[], weekday: Weekday, except: number) {
  return days.some((day, i) => i !== except && day === weekday);
}

/**
 * Leva uma ocorrência para outro dia. Qualquer mudança de dia FIXA a semana inteira como está
 * hoje: o planejador não rearruma o resto por conta própria depois que o profissional mexe.
 * Devolve `null` quando a mesma sessão já cai nesse dia.
 */
export function moveOccurrence(
  structure: TrainingPlanStructure,
  model: ProtocolWeekModel | undefined,
  ref: OccurrenceRef,
  weekday: Weekday,
): TrainingPlanStructure | null {
  const placement = new Map(placementOf(structure, model));
  const days = [...(placement.get(ref.key) ?? [])];
  if (ref.occurrence < 0 || ref.occurrence >= days.length) return null;
  if (days[ref.occurrence] === weekday) return structure;
  if (hasSameSessionOn(days, weekday, ref.occurrence)) return null;
  days[ref.occurrence] = weekday;
  placement.set(ref.key, days);
  return withPlacement(structure, placement);
}

/** Troca os dias de duas ocorrências (arrastar uma sessão sobre outra). */
export function swapOccurrences(
  structure: TrainingPlanStructure,
  model: ProtocolWeekModel | undefined,
  a: OccurrenceRef,
  b: OccurrenceRef,
): TrainingPlanStructure | null {
  const placement = new Map(placementOf(structure, model));
  const daysA = [...(placement.get(a.key) ?? [])];
  const daysB = a.key === b.key ? daysA : [...(placement.get(b.key) ?? [])];
  const dayA = daysA[a.occurrence];
  const dayB = daysB[b.occurrence];
  if (dayA === undefined || dayB === undefined || dayA === dayB) return null;
  if (dayB && hasSameSessionOn(daysA, dayB, a.occurrence) && a.key !== b.key) return null;
  if (dayA && hasSameSessionOn(daysB, dayA, b.occurrence) && a.key !== b.key) return null;
  daysA[a.occurrence] = dayB;
  daysB[b.occurrence] = dayA;
  placement.set(a.key, daysA);
  placement.set(b.key, daysB);
  return withPlacement(structure, placement);
}

export interface DayItem {
  sessionIndex: number;
  occurrence: number;
  /** Esporte externo: os dias vêm do perfil do aluno e não se movem aqui. */
  external: boolean;
}

export interface WeekLayout {
  /** Sete dias, de segunda a domingo, com as ocorrências de cada um. */
  days: { weekday: Weekday; items: DayItem[] }[];
  /** Ocorrências sem dia (nova sessão, vezes por semana aumentado, não coube na semana). */
  unplaced: DayItem[];
}

/** A semana do protocolo por dia, com TODAS as ocorrências (uma sessão 2×/semana aparece 2 vezes). */
export function weekLayout(
  structure: TrainingPlanStructure,
  model: ProtocolWeekModel | undefined,
): WeekLayout {
  const placement = placementOf(structure, model);
  const days = WEEKDAYS.map((weekday) => ({ weekday, items: [] as DayItem[] }));
  const unplaced: DayItem[] = [];
  const externalDays = new Map<string, Weekday[]>();
  for (const item of model?.sessions ?? []) {
    externalDays.set(item.sessionKey, [...(externalDays.get(item.sessionKey) ?? []), item.weekday]);
  }
  structure.sessions.forEach((session, sessionIndex) => {
    if (!isCoached(session)) {
      for (const weekday of externalDays.get(session.key) ?? []) {
        days
          .find((day) => day.weekday === weekday)
          ?.items.push({ sessionIndex, occurrence: 0, external: true });
      }
      return;
    }
    (placement.get(session.key) ?? []).forEach((weekday, occurrence) => {
      const item = { sessionIndex, occurrence, external: false };
      const day = days.find((d) => d.weekday === weekday);
      if (day) day.items.push(item);
      else unplaced.push(item);
    });
  });
  return { days, unplaced };
}

/** Mantém `weekdays` coerente quando a frequência semanal muda (nunca mais dias que vezes). */
export function withFrequency(session: PlanSession, weeklyFrequency: number): PlanSession {
  const weekdays = session.weekdays?.slice(0, weeklyFrequency);
  const { weekdays: _previous, ...rest } = session;
  return weekdays && weekdays.length > 0
    ? { ...rest, weeklyFrequency, weekdays }
    : { ...rest, weeklyFrequency };
}
