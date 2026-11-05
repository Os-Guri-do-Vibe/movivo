/**
 * Sinais do dia a dia que acordam cada especialista em tempo real. O código decide, sem modelo,
 * se há algo que valha a leitura: o especialista só é chamado quando os números pedem (o mesmo
 * princípio da revisão semanal), e o silêncio é o padrão.
 */
import type { ObservationView } from '../student-state/observations';
import type { LoadMetricsView } from './analyst-tasks';

export interface CheckInDay {
  date: string;
  energy: number | null;
  sleep: number | null;
  soreness: number | null;
  mood: number | null;
  stress: number | null;
}

export interface DailySignalInput {
  /** Check-ins dos últimos dias, do mais antigo ao mais novo (o último é o de hoje, se houver). */
  days: readonly CheckInDay[];
  today: string;
  load: Pick<LoadMetricsView, 'readiness' | 'risks'> | null;
  plannedToday: boolean;
  /** O que o aluno contou hoje (chat): doença, álcool, viagem… além das escalas. */
  reportsToday?: readonly Pick<ObservationView, 'kind' | 'score' | 'valueNum'>[];
}

const lastN = <T>(items: readonly T[], n: number) => items.slice(-n);
const count = <T>(items: readonly T[], test: (item: T) => boolean) => items.filter(test).length;

/** Escala dos check-ins: 1 = pior, exceto soreness (1 = muito dolorido) e stress (1 = sem estresse). */
export function trainingSignal(input: DailySignalInput): string | null {
  const todayRow = input.days.find((d) => d.date === input.today);
  const readiness = input.load?.readiness;
  if (readiness && readiness.score !== null && readiness.score <= 45) {
    return `prontidão baixa (${Math.round(readiness.score)})`;
  }
  if (readiness && readiness.delta !== null && readiness.delta <= -15) {
    return `prontidão ${Math.abs(Math.round(readiness.delta))} pontos abaixo do normal dele`;
  }
  if (input.plannedToday && todayRow) {
    if (todayRow.soreness !== null && todayRow.soreness <= 2) return 'corpo muito dolorido hoje';
    if (todayRow.sleep !== null && todayRow.sleep <= 2) return 'noite de sono ruim antes do treino';
    if (todayRow.energy !== null && todayRow.energy <= 1) return 'energia mínima antes do treino';
  }
  if (input.plannedToday) {
    const kinds = new Set((input.reportsToday ?? []).map((r) => r.kind));
    if (kinds.has('ILLNESS')) return 'relatou estar doente ou com sintomas de gripe';
    if (kinds.has('ALCOHOL')) return 'relatou álcool antes do treino';
    if (kinds.has('TRAVEL')) return 'relatou viagem ou deslocamento no dia do treino';
  }
  const risk = input.load?.risks.find((r) =>
    ['ACWR_HIGH', 'LOAD_SPIKE', 'MONOTONY_HIGH', 'READINESS_LOW'].includes(r.kind),
  );
  return risk ? `carga: ${risk.detail}` : null;
}

export function wellbeingSignal(input: DailySignalInput): string | null {
  const recent = lastN(input.days, 5);
  const lastThree = lastN(input.days, 3);
  if (count(lastThree, (d) => d.sleep !== null && d.sleep <= 2) >= 2) {
    return 'sono ruim em 2 dos últimos 3 dias';
  }
  if (count(recent, (d) => d.stress !== null && d.stress >= 4) >= 3) {
    return 'estresse alto em 3 dos últimos 5 dias';
  }
  if (count(lastThree, (d) => d.mood !== null && d.mood <= 2) >= 2) {
    return 'humor baixo em 2 dos últimos 3 dias';
  }
  if (count(recent, (d) => d.energy !== null && d.energy <= 2) >= 3) {
    return 'energia baixa em 3 dos últimos 5 dias';
  }
  return null;
}
