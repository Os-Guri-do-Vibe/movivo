/** Plano adaptativo determinístico: consultas simples fazem uma busca; compostas, múltiplas. */
export interface RetrievalPlan {
  readonly mode: 'SINGLE_HOP' | 'MULTI_HOP';
  readonly queries: readonly string[];
}

const MULTI_HOP_MARKER =
  /;|\?\s*(?=\S)|\b(?:e também|além disso|ao mesmo tempo|comparad[oa] com|versus)\b/iu;
const MULTI_HOP_BOUNDARY =
  /(?:;|\?\s*(?=\S)|\b(?:e também|além disso|ao mesmo tempo|comparad[oa] com|versus)\b)/giu;

function normalized(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

export function buildRetrievalPlan(query: string): RetrievalPlan {
  const original = normalized(query);
  const complex = original.split(/\s+/u).length > 22 || MULTI_HOP_MARKER.test(original);
  if (!complex) return { mode: 'SINGLE_HOP', queries: [original] };

  const parts = original
    .split(MULTI_HOP_BOUNDARY)
    .map(normalized)
    .filter((part) => part.length >= 12);
  const queries = [...new Set([original, ...parts])].slice(0, 4);
  return { mode: queries.length > 1 ? 'MULTI_HOP' : 'SINGLE_HOP', queries };
}
