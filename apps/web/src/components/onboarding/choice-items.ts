import type { ChoiceItem } from './fields';

/** "1 dia" … "7 dias": usado nas perguntas de quantos dias por semana. */
export const DAYS_PER_WEEK_ITEMS: ChoiceItem<string>[] = [1, 2, 3, 4, 5, 6, 7].map((days) => ({
  value: String(days),
  label: `${days} ${days === 1 ? 'dia' : 'dias'}`,
}));
