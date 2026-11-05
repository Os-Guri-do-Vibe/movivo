import { addDays, mondayOf } from '../planning/calc/week-planner';

/**
 * A semana que a revisão semanal lê. A revisão roda no domingo à noite, quando a semana de
 * segunda a domingo está fechando: ela É a semana revisada. Em qualquer outro dia (execução
 * manual, atraso), a revisão lê a última semana que fechou.
 */
export function reviewWeekStart(today: string): string {
  const isSunday = new Date(`${today}T12:00:00Z`).getUTCDay() === 0;
  return isSunday ? mondayOf(today) : addDays(mondayOf(today), -7);
}
