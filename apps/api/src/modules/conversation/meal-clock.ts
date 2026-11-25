import type { MealSlot } from '@movivo/shared';

/** Refeição que faz sentido pela hora local, entre as do plano do aluno. */
export function mealByClock(
  slots: readonly MealSlot[],
  now: Date,
  timezone: string | null,
): MealSlot | null {
  let hour: number;
  try {
    hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        hourCycle: 'h23',
        timeZone: timezone ?? 'America/Sao_Paulo',
      }).format(now),
    );
  } catch {
    return null;
  }
  const wanted: MealSlot =
    hour >= 5 && hour < 10
      ? 'BREAKFAST'
      : hour < 12
        ? 'MORNING_SNACK'
        : hour < 15
          ? 'LUNCH'
          : hour < 18
            ? 'AFTERNOON_SNACK'
            : hour < 22
              ? 'DINNER'
              : 'SUPPER';
  return slots.includes(wanted) ? wanted : null;
}
