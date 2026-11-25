/**
 * Rotina alimentar do dia a dia: horários dos lembretes, leitura do dia (o que já foi registrado
 * e o que falta) e o resumo que fecha o dia. Funções puras: o relógio e os dados vêm de fora.
 */
import {
  MEAL_SLOT_LABELS,
  type DailyTargets,
  type MealOption,
  type MealSlot,
  type NutritionPlanStructure,
} from '@movivo/shared';

import { cleanFoodName, quantityLabel } from '../planning/calc/menu';

/** Horário local de cada refeição (pré e pós-treino dependem do treino e não têm lembrete fixo). */
export const MEAL_CLOCK: Readonly<Partial<Record<MealSlot, string>>> = {
  BREAKFAST: '07:30',
  MORNING_SNACK: '10:00',
  LUNCH: '12:30',
  AFTERNOON_SNACK: '15:30',
  DINNER: '19:30',
  SUPPER: '21:30',
};

/** Último horário em que o resumo do dia sai, mesmo com refeição faltando. */
export const SUMMARY_DEADLINE = '23:30';
/** A partir daqui o resumo pode sair se o dia já estiver completo. */
export const SUMMARY_EARLIEST = '19:00';
/** Silêncio mínimo desde o último registro antes de fechar o dia (o aluno pode estar registrando). */
export const SUMMARY_QUIET_MINUTES = 15;

const TRACKED: ReadonlySet<MealSlot> = new Set(Object.keys(MEAL_CLOCK) as MealSlot[]);

/** Refeições do plano que contam para o registro do dia. */
export function trackedSlots(structure: Pick<NutritionPlanStructure, 'meals'>): MealSlot[] {
  return structure.meals.map((meal) => meal.slot).filter((slot) => TRACKED.has(slot));
}

/** A refeição cujo lembrete sai exatamente neste minuto local (HH:mm), se houver. */
export function slotDueAt(localTime: string, slots: readonly MealSlot[]): MealSlot | null {
  return slots.find((slot) => MEAL_CLOCK[slot] === localTime) ?? null;
}

export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

const lowerFirst = (text: string) => (text ? text.charAt(0).toLowerCase() + text.slice(1) : text);

/** Itens da opção como o aluno lê: "- 2 ovos de ovo, de galinha, mexido". */
export function optionLines(option: MealOption): string[] {
  return option.items.map(
    (item) =>
      `- ${quantityLabel({ grams: item.grams, name: item.name, unit: item.unit, units: item.units })} de ${lowerFirst(cleanFoodName(item.name))}`,
  );
}

export interface LoggedMeal {
  slot: MealSlot;
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  createdAt: Date;
}

export interface DayTotals {
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export function dayTotals(meals: readonly LoggedMeal[]): DayTotals {
  const sum = (pick: (meal: LoggedMeal) => number) =>
    Math.round(meals.reduce((total, meal) => total + pick(meal), 0));
  return {
    energyKcal: sum((m) => m.energyKcal),
    proteinG: sum((m) => m.proteinG),
    carbsG: sum((m) => m.carbsG),
    fatG: sum((m) => m.fatG),
  };
}

/** Refeições do plano ainda sem nenhum registro no dia. */
export function missingSlots(
  planned: readonly MealSlot[],
  logged: readonly LoggedMeal[],
): MealSlot[] {
  const done = new Set(logged.map((meal) => meal.slot));
  return planned.filter((slot) => !done.has(slot));
}

/**
 * O dia pode ser fechado? Todas as refeições do plano registradas e o aluno parado há alguns
 * minutos; ou já passou do limite da noite.
 */
export function dayIsClosable(input: {
  planned: readonly MealSlot[];
  logged: readonly LoggedMeal[];
  localTime: string;
  now: Date;
}): boolean {
  const { planned, logged, localTime, now } = input;
  const minutes = toMinutes(localTime);
  if (minutes >= toMinutes(SUMMARY_DEADLINE)) return true;
  if (minutes < toMinutes(SUMMARY_EARLIEST)) return false;
  if (planned.length === 0 || missingSlots(planned, logged).length > 0) return false;
  const last = Math.max(...logged.map((meal) => meal.createdAt.getTime()));
  return now.getTime() - last >= SUMMARY_QUIET_MINUTES * 60_000;
}

/** A meta do dia (kcal) como ponto único: o meio da faixa. */
export function targetKcal(targets: DailyTargets): number {
  return Math.round((targets.energyKcal.min + targets.energyKcal.max) / 2);
}

const num = (value: number) => value.toLocaleString('pt-BR');
export const litersLabel = (ml: number) =>
  `${(ml / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} L`;

/**
 * O bloco de números do resumo do dia: sempre calculado pelo código a partir dos registros, nunca
 * pelo modelo. O texto humano (leitura do nutricionista) vem separado.
 */
export function daySummaryBlock(input: {
  firstName: string | null;
  totals: DayTotals;
  waterMl: number | null;
}): string {
  const { firstName, totals, waterMl } = input;
  const lines = [
    `${firstName ? `${firstName}, seu` : 'Seu'} registro nutricional total do dia ficou assim:`,
    `Calorias consumidas: ${num(totals.energyKcal)} kcal`,
    `Proteínas: ${num(totals.proteinG)} g`,
    `Carboidratos: ${num(totals.carbsG)} g`,
    `Gorduras: ${num(totals.fatG)} g`,
  ];
  if (waterMl !== null && waterMl > 0) lines.push('', `Água: ${litersLabel(waterMl)}`);
  return lines.join('\n');
}

export function slotLabel(slot: MealSlot): string {
  return MEAL_SLOT_LABELS[slot].toLowerCase();
}

// --- Números do texto livre dos agentes ------------------------------------------------------

/** Todos os números de um objeto (para saber quais o modelo pode citar). */
export function numbersIn(value: unknown): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(numbersIn);
  if (value && typeof value === 'object') return Object.values(value).flatMap(numbersIn);
  return [];
}

/**
 * Números do texto que não vieram dos dados: o modelo escreve a conversa, os números vêm do
 * código. Contagens pequenas ("2 opções") e arredondamentos de até 3% passam.
 */
export function unknownNumbers(text: string, allowed: readonly number[]): string[] {
  // "1.900" é mil e novecentos em português; "1,9" e "1.9" são decimais.
  const found = text.match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g) ?? [];
  return found.filter((raw) => {
    const thousands = /^\d{1,3}(?:\.\d{3})+/.test(raw);
    const n = Number((thousands ? raw.replaceAll('.', '') : raw).replace(',', '.'));
    if (n <= 12) return false;
    return !allowed.some((a) => Math.abs(n - a) <= Math.max(1, Math.abs(a) * 0.03));
  });
}
