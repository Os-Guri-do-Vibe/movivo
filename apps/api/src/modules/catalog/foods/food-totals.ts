/**
 * Totais de uma refeição a partir da base de alimentos — cálculo determinístico. A IA nunca
 * calcula nutriente: ela só identifica itens e porções, que o aluno confirma.
 */
import { createHash } from 'node:crypto';

import type { FoodLogItem, NutrientTotals, NutrientsPer100g } from '@movivo/shared';

const round = (value: number, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export function computeTotals(
  items: readonly FoodLogItem[],
  foods: ReadonlyMap<string, NutrientsPer100g>,
): NutrientTotals {
  const totals = {
    energyKcal: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fiberG: 0,
    micros: {} as Record<string, number>,
    unmatchedItems: 0,
    estimatedItems: 0,
  };
  for (const item of items) {
    const known = item.foodItemId ? foods.get(item.foodItemId) : undefined;
    // Fora da base: vale a composição estimada do item (sem micronutrientes); sem ela, fica de fora.
    const per100: NutrientsPer100g | undefined =
      known ?? (item.estimatedPer100g ? { ...item.estimatedPer100g, micros: {} } : undefined);
    if (!per100) {
      totals.unmatchedItems += 1;
      continue;
    }
    if (!known) totals.estimatedItems += 1;
    const factor = item.grams / 100;
    totals.energyKcal += per100.energyKcal * factor;
    totals.proteinG += per100.proteinG * factor;
    totals.carbsG += per100.carbsG * factor;
    totals.fatG += per100.fatG * factor;
    totals.fiberG += (per100.fiberG ?? 0) * factor;
    for (const [key, value] of Object.entries(per100.micros)) {
      totals.micros[key] = (totals.micros[key] ?? 0) + value * factor;
    }
  }
  return {
    energyKcal: Math.round(totals.energyKcal),
    proteinG: round(totals.proteinG),
    carbsG: round(totals.carbsG),
    fatG: round(totals.fatG),
    fiberG: round(totals.fiberG),
    micros: Object.fromEntries(Object.entries(totals.micros).map(([k, v]) => [k, round(v, 2)])),
    unmatchedItems: totals.unmatchedItems,
    ...(totals.estimatedItems > 0 ? { estimatedItems: totals.estimatedItems } : {}),
  };
}

/** Palavras de ligação que não identificam alimento ("peito de frango" busca "peito" e "frango"). */
const STOPWORDS: ReadonlySet<string> = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'em',
  'no',
  'na',
  'ao',
  'aos',
  'ou',
  'um',
  'uma',
]);

/** Termos de busca de um nome de alimento: sem acento, sem palavras de ligação, no máximo `max`. */
export function searchTerms(query: string, max = 5): string[] {
  return searchName(query)
    .split(' ')
    .filter((term) => term.length >= 2 && !STOPWORDS.has(term))
    .slice(0, max);
}

/** Forma de busca: minúsculas, sem acento, espaços simples. */
export function searchName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Nome com que um alimento estimado pelo agente entra na base: só o que um nome de alimento tem
 * (letras, números e pontuação simples), em até 80 caracteres e com a primeira letra maiúscula.
 * A base é global: nada que pareça dado pessoal ou instrução entra. `null` = não serve.
 */
export function aiFoodName(label: string): string | null {
  const clean = label
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} ,.%()/+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
  if (clean.length < 3 || !/\p{L}{2}/u.test(clean)) return null;
  // Telefone, e-mail ou CPF não são alimento.
  if (/\d{5,}/.test(clean.replaceAll(/[ .-]/g, ''))) return null;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/** Código estável do alimento estimado (o mesmo nome sempre dá o mesmo código). */
export function aiFoodCode(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}
