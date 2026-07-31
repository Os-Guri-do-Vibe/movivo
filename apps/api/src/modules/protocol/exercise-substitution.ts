/**
 * Substituição segura de exercício (US-3.5 / TASK-3.5.2).
 *
 * MOVI **nunca inventa** um exercício: o substituto sai SEMPRE da base de referência (US-2.1),
 * no mesmo padrão de movimento, dentro do nível/equipamento do usuário e **nunca contraindicado**
 * por lesão/PAR-Q. A IA só verbaliza a troca; o `ValidationService.validateResponse` confirma.
 */
import {
  type CatalogExercise,
  type ContraindicationTag,
  EXERCISE_CATALOG,
  type ExerciseLevel,
  type ExerciseLocation,
} from './exercise-catalog';

const LEVEL_ORDER: Record<ExerciseLevel, number> = {
  INICIANTE: 0,
  INTERMEDIARIO: 1,
  AVANCADO: 2,
};

/** Restrições do usuário que filtram um substituto seguro. */
export interface SubstitutionConstraints {
  level: ExerciseLevel;
  location: ExerciseLocation;
  equipment: readonly string[];
  injuryTags: readonly ContraindicationTag[];
}

function locationMatches(ex: ExerciseLocation, user: ExerciseLocation): boolean {
  return ex === 'BOTH' || user === 'BOTH' || ex === user;
}

/** O usuário tem TODO o equipamento que o exercício exige? (`[]` = peso do corpo, sempre ok.) */
function equipmentAvailable(ex: CatalogExercise, owned: readonly string[]): boolean {
  return ex.equipment.every((e) => owned.includes(e));
}

/** O exercício é seguro e viável para este usuário? */
function isViable(ex: CatalogExercise, c: SubstitutionConstraints): boolean {
  return (
    LEVEL_ORDER[ex.minLevel] <= LEVEL_ORDER[c.level] &&
    locationMatches(ex.location, c.location) &&
    equipmentAvailable(ex, c.equipment) &&
    !ex.contraindicatedFor.some((t) => c.injuryTags.includes(t))
  );
}

/**
 * Identifica na mensagem livre qual exercício da base o usuário quer trocar (match por nome).
 * ponytail: match por nome do catálogo — sem NLP; palavra desconhecida → `null` (o worker cai
 * no fallback pré-aprovado). Sobe para sinônimos/embeddings se a taxa de acerto incomodar.
 */
export function findExerciseByMention(text: string): CatalogExercise | null {
  const lower = text.toLowerCase();
  return EXERCISE_CATALOG.find((ex) => lower.includes(ex.name.toLowerCase())) ?? null;
}

/**
 * Escolhe um substituto seguro no mesmo padrão de movimento. Prioriza a lista `substitutes`
 * curada do exercício; depois qualquer outro do mesmo padrão. `null` = nada seguro disponível.
 */
export function findSafeSubstitute(
  target: CatalogExercise,
  c: SubstitutionConstraints,
): CatalogExercise | null {
  const byId = (id: string) => EXERCISE_CATALOG.find((e) => e.id === id);
  const curated = target.substitutes.map(byId).filter((e): e is CatalogExercise => Boolean(e));
  const samePattern = EXERCISE_CATALOG.filter(
    (e) => e.pattern === target.pattern && e.id !== target.id,
  );
  for (const candidate of [...curated, ...samePattern]) {
    if (candidate.id !== target.id && isViable(candidate, c)) return candidate;
  }
  return null;
}
