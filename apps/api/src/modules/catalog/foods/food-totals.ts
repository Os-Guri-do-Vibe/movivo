/**
 * Totais de uma refeição a partir da base de alimentos — cálculo determinístico. A IA nunca
 * calcula nutriente: ela só identifica itens e porções, que o aluno confirma.
 */
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
  };
  for (const item of items) {
    const per100 = item.foodItemId ? foods.get(item.foodItemId) : undefined;
    if (!per100) {
      totals.unmatchedItems += 1;
      continue;
    }
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
  };
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
