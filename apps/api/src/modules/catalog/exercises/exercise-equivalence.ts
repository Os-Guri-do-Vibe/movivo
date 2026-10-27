/**
 * Equivalentes de um exercício para a v2: os candidatos SEGUROS de `findSafeCandidates`
 * (mesmo padrão de movimento, grupo muscular em comum, nível, local e contraindicações),
 * ordenados pelo que o aluno gosta e sem o que ele rejeitou. A escolha final é do agente; a
 * lista é o universo permitido — o validador recusa troca fora dela.
 */
import type { CatalogExercise } from './exercise-catalog';
import { findSafeCandidates, type SubstitutionConstraints } from './exercise-substitution';

export interface ExercisePreferences {
  /** Ids de exercícios que o aluno rejeitou (nunca oferecidos). */
  disliked: ReadonlySet<string>;
  /** Ids de exercícios que o aluno gosta (oferecidos primeiro). */
  liked: ReadonlySet<string>;
}

function sharedMuscles(a: CatalogExercise, b: CatalogExercise): number {
  return b.muscleGroups.filter((group) => a.muscleGroups.includes(group)).length;
}

export function rankEquivalents(
  target: CatalogExercise,
  constraints: SubstitutionConstraints,
  catalog: readonly CatalogExercise[],
  preferences: ExercisePreferences,
): CatalogExercise[] {
  const curated = new Set(target.substitutes);
  return findSafeCandidates(target, constraints, catalog)
    .filter((candidate) => !preferences.disliked.has(candidate.id))
    .map((candidate, order) => ({ candidate, order }))
    .sort(
      (a, b) =>
        Number(preferences.liked.has(b.candidate.id)) -
          Number(preferences.liked.has(a.candidate.id)) ||
        Number(curated.has(b.candidate.id)) - Number(curated.has(a.candidate.id)) ||
        sharedMuscles(target, b.candidate) - sharedMuscles(target, a.candidate) ||
        a.order - b.order,
    )
    .map(({ candidate }) => candidate);
}
