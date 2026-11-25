/** Mensagens do registro alimentar pelo WhatsApp: a lista e os números vêm do código. */
import { MEAL_SLOT_LABELS, type MealSlot } from '@movivo/shared';

import { WHATSAPP_BUBBLE_SEPARATOR } from '../jobs/whatsapp-outbound.contract';
import { litersLabel, type DayTotals } from './meal-routine';

const num = (value: number) => Math.round(value).toLocaleString('pt-BR');

export interface ListedItem {
  label: string;
  grams: number;
}

const listOf = (items: readonly ListedItem[]) =>
  items.map((item) => `- ${num(item.grams)} g de ${item.label}`).join('\n');

/** Os quatro números de uma refeição, um por linha (o aluno bate o olho e entende). */
export function macroLines(totals: DayTotals): string {
  return [
    `Calorias: ${num(totals.energyKcal)} kcal`,
    `Proteínas: ${num(totals.proteinG)} g`,
    `Carboidratos: ${num(totals.carbsG)} g`,
    `Gorduras: ${num(totals.fatG)} g`,
  ].join('\n');
}

const namesOf = (labels: readonly string[]) =>
  labels.length <= 1
    ? (labels[0] ?? '')
    : `${labels.slice(0, -1).join(', ')} e ${labels.at(-1) as string}`;

/**
 * Transparência sobre o que não veio da tabela de alimentos: o que entrou por estimativa e o que
 * ficou sem número nenhum (e por isso não está nos totais).
 */
export function tableNotes(input: {
  estimatedLabels: readonly string[];
  unmatchedLabels: readonly string[];
}): string[] {
  const notes: string[] = [];
  if (input.estimatedLabels.length > 0) {
    notes.push(
      `Não encontrei ${namesOf(input.estimatedLabels)} na tabela TACO, então usei uma estimativa da composição média e já incluí na nossa base.`,
    );
  }
  if (input.unmatchedLabels.length > 0) {
    notes.push(
      `Não consegui calcular ${namesOf(input.unmatchedLabels)}: ${input.unmatchedLabels.length > 1 ? 'esses itens ficaram' : 'esse item ficou'} fora dos números. Se puder, me diga de outro jeito (o tipo ou a marca) que eu acerto.`,
    );
  }
  return notes;
}

function todayLine(day: {
  totals: DayTotals;
  targetKcal: number | null;
  targetProteinG: number | null;
}): string {
  return `Hoje até agora: ${num(day.totals.energyKcal)} kcal${day.targetKcal ? ` (meta ~${num(day.targetKcal)})` : ''} · ${num(day.totals.proteinG)} g de proteína${day.targetProteinG ? ` (meta ${num(day.targetProteinG)})` : ''}`;
}

export function foodLogMessage(input: {
  meal: MealSlot;
  items: readonly ListedItem[];
  mealTotals: DayTotals;
  day: { totals: DayTotals; targetKcal: number | null; targetProteinG: number | null };
  comment: string | null;
  /** As porções vieram de foto (estimativa visual). */
  portionsEstimated: boolean;
  estimatedLabels?: readonly string[];
  unmatchedLabels?: readonly string[];
  /** Registro de outro dia (correção de ontem): a linha "hoje até agora" não se aplica. */
  otherDay?: boolean;
}): string {
  const { meal, items, mealTotals, day, comment } = input;
  const blocks = [
    `Registrei seu ${MEAL_SLOT_LABELS[meal].toLowerCase()}:\n${listOf(items)}\n\nEssa refeição teve:\n${macroLines(mealTotals)}`,
  ];
  if (!input.otherDay) blocks.push(todayLine(day));
  if (comment) blocks.push(comment);
  const notes = tableNotes({
    estimatedLabels: input.estimatedLabels ?? [],
    unmatchedLabels: input.unmatchedLabels ?? [],
  });
  if (input.portionsEstimated) {
    notes.push('As porções são estimadas pela foto: se algo não bate, me diga que eu corrijo.');
  }
  if (notes.length > 0) blocks.push(notes.join(' '));
  return blocks.join(WHATSAPP_BUBBLE_SEPARATOR);
}

/** Consulta ("quantas calorias tem isso?"): responde os números e deixa claro que nada foi registrado. */
export function foodQueryMessage(input: {
  items: readonly ListedItem[];
  totals: DayTotals;
  portionsEstimated: boolean;
  estimatedLabels: readonly string[];
  unmatchedLabels: readonly string[];
}): string {
  const blocks = [`Pelos meus cálculos:\n${listOf(input.items)}\n\n${macroLines(input.totals)}`];
  const notes = tableNotes(input);
  if (input.portionsEstimated) notes.push('As porções são uma estimativa pela foto.');
  if (notes.length > 0) blocks.push(notes.join(' '));
  blocks.push(
    'Foi só uma consulta: não registrei nada no seu dia. Se você comer, é só me dizer "comi" que eu registro.',
  );
  return blocks.join(WHATSAPP_BUBBLE_SEPARATOR);
}

/** Registro apagado a pedido do aluno. */
export function foodLogRemovedMessage(input: {
  meal: MealSlot;
  day: { totals: DayTotals; targetKcal: number | null; targetProteinG: number | null };
  otherDay?: boolean;
}): string {
  const base = `Pronto, apaguei o registro do seu ${MEAL_SLOT_LABELS[input.meal].toLowerCase()}.`;
  return input.otherDay ? base : [base, todayLine(input.day)].join(WHATSAPP_BUBBLE_SEPARATOR);
}

export function waterMessage(addedMl: number, totalMl: number, targetMl: number | null): string {
  const base = `Anotei +${num(addedMl)} ml de água. Hoje: ${litersLabel(totalMl)}`;
  return targetMl ? `${base} de ${litersLabel(targetMl)} da sua meta.` : `${base}.`;
}
