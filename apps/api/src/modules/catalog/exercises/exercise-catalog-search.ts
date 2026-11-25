/**
 * Busca no catálogo oficial para o editor de protocolo do profissional (achado 2026-10-15,
 * produção: o RT digitou "Abdominal na Prancha" à mão, o item virou `manual-<uuid>` e a
 * assinatura recusou "exercício fora da base").
 *
 * Busca por TERMO, não pela frase inteira: cada palavra digitada casa por parte da palavra,
 * sem acento e sem diferença de maiúscula, e o exercício que casa mais termos sobe. Assim
 * "abdominal prancha" encontra "Prancha" e os abdominais mesmo sem existir "Abdominal
 * Prancha". Palavras de ligação ("de", "na", "com"...) não contam — "na" casaria "máquina" e
 * "abdominal" e poluiria o resultado.
 *
 * Função pura sobre o snapshot publicado (`ExerciseCatalogProvider.getAll()`): nunca cria nem
 * altera exercício.
 */
import { normalizeForMatch } from '../../../core/attendance-rules/text-normalize';
import type { CatalogExercise } from './exercise-catalog';

export const CATALOG_SEARCH_DEFAULT_LIMIT = 20;
export const CATALOG_SEARCH_MAX_LIMIT = 50;

const STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'o',
  'as',
  'os',
  'e',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'na',
  'no',
  'nas',
  'nos',
  'em',
  'com',
  'sem',
  'para',
  'pra',
  'por',
  'um',
  'uma',
]);

/** Termos de busca normalizados, sem repetição e sem palavra de ligação. */
export function catalogSearchTerms(query: string): string[] {
  const tokens = normalizeForMatch(query).split(' ').filter(Boolean);
  const meaningful = tokens.filter((token) => !STOPWORDS.has(token));
  return [...new Set(meaningful)];
}

interface Scored {
  exercise: CatalogExercise;
  /** Termos que casaram em qualquer campo. */
  matched: number;
  /** Termos que casaram no NOME (vale mais que grupo muscular/equipamento). */
  inName: number;
  /** Termos que casaram no começo de uma palavra do nome. */
  prefix: number;
  /** O nome começa com a consulta inteira. */
  startsWithQuery: boolean;
}

function words(text: string): string[] {
  return normalizeForMatch(text).split(' ').filter(Boolean);
}

export function searchCatalog(
  catalog: readonly CatalogExercise[],
  query: string,
  limit: number = CATALOG_SEARCH_DEFAULT_LIMIT,
): CatalogExercise[] {
  const terms = catalogSearchTerms(query);
  if (terms.length === 0) return [];
  const wholeQuery = terms.join(' ');
  const scored: Scored[] = [];
  for (const exercise of catalog) {
    const nameWords = words(exercise.name);
    const otherWords = words(
      [exercise.id.replace(/_/gu, ' '), ...exercise.muscleGroups, ...exercise.equipment].join(' '),
    );
    let inName = 0;
    let prefix = 0;
    let elsewhere = 0;
    for (const term of terms) {
      if (nameWords.some((word) => word.includes(term))) {
        inName++;
        if (nameWords.some((word) => word.startsWith(term))) prefix++;
      } else if (otherWords.some((word) => word.includes(term))) {
        elsewhere++;
      }
    }
    const matched = inName + elsewhere;
    if (matched === 0) continue;
    scored.push({
      exercise,
      matched,
      inName,
      prefix,
      startsWithQuery: nameWords.join(' ').startsWith(wholeQuery),
    });
  }
  scored.sort(
    (a, b) =>
      b.matched - a.matched ||
      b.inName - a.inName ||
      b.prefix - a.prefix ||
      Number(b.startsWithQuery) - Number(a.startsWithQuery) ||
      a.exercise.name.length - b.exercise.name.length ||
      a.exercise.name.localeCompare(b.exercise.name, 'pt-BR'),
  );
  const bounded = Math.min(Math.max(Math.trunc(limit) || 1, 1), CATALOG_SEARCH_MAX_LIMIT);
  return scored.slice(0, bounded).map((entry) => entry.exercise);
}
