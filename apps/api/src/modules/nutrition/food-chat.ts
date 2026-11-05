/** Mensagens do registro alimentar pelo WhatsApp: a lista e os números vêm do código. */
import { MEAL_SLOT_LABELS, type MealSlot } from '@movivo/shared';

import { WHATSAPP_BUBBLE_SEPARATOR } from '../jobs/whatsapp-outbound.contract';
import { litersLabel, type DayTotals } from './meal-routine';

const num = (value: number) => Math.round(value).toLocaleString('pt-BR');

export function foodLogMessage(input: {
  meal: MealSlot;
  items: readonly { label: string; grams: number }[];
  mealTotals: DayTotals;
  day: { totals: DayTotals; targetKcal: number | null; targetProteinG: number | null };
  comment: string | null;
  estimated: boolean;
}): string {
  const { meal, items, mealTotals, day, comment, estimated } = input;
  const list = items.map((item) => `- ${item.grams} g de ${item.label}`).join('\n');
  const macros = `${num(mealTotals.energyKcal)} kcal · ${num(mealTotals.proteinG)} g de proteína · ${num(mealTotals.carbsG)} g de carboidrato · ${num(mealTotals.fatG)} g de gordura`;
  const today = `Hoje até agora: ${num(day.totals.energyKcal)} kcal${day.targetKcal ? ` (meta ~${num(day.targetKcal)})` : ''} · ${num(day.totals.proteinG)} g de proteína${day.targetProteinG ? ` (meta ${num(day.targetProteinG)})` : ''}`;
  const blocks = [
    `Registrei seu ${MEAL_SLOT_LABELS[meal].toLowerCase()}:\n${list}\n≈ ${macros}`,
    today,
  ];
  if (comment) blocks.push(comment);
  if (estimated) {
    blocks.push('As porções são estimadas: se algo não bate, me diga que eu corrijo.');
  }
  return blocks.join(WHATSAPP_BUBBLE_SEPARATOR);
}

export function waterMessage(addedMl: number, totalMl: number, targetMl: number | null): string {
  const base = `Anotei +${num(addedMl)} ml de água. Hoje: ${litersLabel(totalMl)}`;
  return targetMl ? `${base} de ${litersLabel(targetMl)} da sua meta.` : `${base}.`;
}
