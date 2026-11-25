/**
 * Quando um ciclo de protocolo termina. O ciclo do treino é a soma das semanas das fases do
 * plano; sem treino ativo, o da alimentação segue um prazo padrão. Funções puras.
 */
import { addDays } from '../planning/calc/week-planner';

/** Sem plano de treino, o protocolo alimentar é reavaliado depois deste prazo. */
export const NUTRITION_CYCLE_WEEKS = 12;
/** Depois de vencido, a reavaliação ainda é aberta por este tempo (queda do sistema, plano trocado). */
export const REASSESSMENT_GRACE_DAYS = 14;

/** Último dia do ciclo (a data em que o protocolo vence). */
export function lastDayOfCycle(startsOn: string, phaseWeeks: readonly number[]): string {
  const weeks = phaseWeeks.reduce((total, w) => total + w, 0);
  return addDays(startsOn, Math.max(weeks, 1) * 7 - 1);
}

export function nutritionLastDay(startsOn: string): string {
  return lastDayOfCycle(startsOn, [NUTRITION_CYCLE_WEEKS]);
}

/** A reavaliação deve ser aberta: o ciclo venceu hoje (ou há pouco) e ainda não foi aberta. */
export function reassessmentDue(today: string, lastDay: string): boolean {
  return today >= lastDay && today <= addDays(lastDay, REASSESSMENT_GRACE_DAYS);
}
