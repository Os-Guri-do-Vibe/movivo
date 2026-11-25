import type { MealOption } from '@movivo/shared';

/** Líquidos que o aluno mede em ml (leite, bebida vegetal, suco). */
const LIQUID =
  /^(leite(?!,? (condensado|em p[oó]))|bebida|suco|[aá]gua|caldo|vitamina|refresco|caf[eé]|ch[aá])\b/i;

/**
 * Quantidade como o aluno mede: unidades inteiras para o que se conta ("3 ovos"), ml para
 * líquido ("250 ml") e gramas para o resto ("150 g"). Uma medida só, sem misturar.
 */
export function quantityLabel(entry: {
  grams: number;
  name?: string;
  unit?: { singular: string; plural: string };
  units?: number;
}): string {
  if (entry.unit && entry.units && Number.isInteger(entry.units)) {
    return `${entry.units} ${entry.units === 1 ? entry.unit.singular : entry.unit.plural}`;
  }
  if (entry.name && LIQUID.test(entry.name.trim())) return `${entry.grams} ml`;
  return `${entry.grams} g`;
}

export const OPTION_LETTERS = ['A', 'B', 'C'] as const;

export const brl = (value: number): string =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function optionSummary(option: MealOption): string {
  return `${option.totals.energyKcal} kcal · ${Math.round(option.totals.proteinG)} g de proteína`;
}
