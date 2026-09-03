/**
 * Calendário de treino (US-8.1) — funções puras, sem I/O, para serem testadas sem banco.
 *
 * O `ProtocolStructure` (`@movivo/shared`) prescreve **quantas** sessões por semana
 * (`weeklyFrequency`) e **quais** sessões (`sessions[].dayLabel`), mas nunca **em que
 * dia da semana** — não existe essa coluna e o onboarding jamais perguntou os dias
 * preferidos do aluno. Como o quick reply diário precisa de um dia concreto, derivamos
 * um calendário determinístico da frequência, espaçando as sessões com descanso entre
 * elas.
 *
 * ponytail: calendário fixo por frequência, igual para todo aluno. Quando o onboarding
 * capturar os dias preferidos, trocar `TRAINING_WEEKDAYS` pela preferência persistida —
 * nada mais neste arquivo muda.
 */
import type { ProtocolStructure } from '@movivo/shared';

export const WORKOUT_TIMEZONE = 'America/Sao_Paulo' as const;

const DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: WORKOUT_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: WORKOUT_TIMEZONE,
  weekday: 'short',
});
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Dia civil `YYYY-MM-DD` no fuso do produto — o formato de `workout_completions.completed_at`. */
export function dayKey(at: Date): string {
  return DAY_FORMATTER.format(at);
}

/** 0 = domingo … 6 = sábado, no fuso do produto (mesma convenção de `EXTRACT(dow)`). */
export function weekday(at: Date): number {
  return WEEKDAY_NAMES.indexOf(WEEKDAY_FORMATTER.format(at));
}

/** Dias da semana de treino por frequência semanal. Ver ponytail no cabeçalho. */
const TRAINING_WEEKDAYS: Readonly<Record<number, readonly number[]>> = {
  1: [3],
  2: [2, 5],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 4, 5],
  6: [1, 2, 3, 4, 5, 6],
  7: [0, 1, 2, 3, 4, 5, 6],
};

export function trainingWeekdays(weeklyFrequency: number): readonly number[] {
  const clamped = Math.min(Math.max(Math.trunc(weeklyFrequency) || 0, 1), 7);
  return TRAINING_WEEKDAYS[clamped] ?? [];
}

/**
 * Sessão prevista para a data, ou `null` se o dia não é dia de treino.
 * A sessão gira pela posição do dia dentro da semana, então frequência 3 com sessões
 * A/B/C dá segunda=A, quarta=B, sexta=C.
 */
const PROTOCOL_WEEKDAY: Readonly<Record<number, string>> = {
  0: 'SUN',
  1: 'MON',
  2: 'TUE',
  3: 'WED',
  4: 'THU',
  5: 'FRI',
  6: 'SAT',
};

export function sessionFor(at: Date, structure: ProtocolStructure) {
  const explicit = structure.sessions.find(
    (session) => session.weekday === PROTOCOL_WEEKDAY[weekday(at)],
  );
  if (explicit) return explicit;
  const days = trainingWeekdays(structure.weeklyFrequency);
  const position = days.indexOf(weekday(at));
  if (position < 0 || structure.sessions.length === 0) return null;
  return structure.sessions[position % structure.sessions.length] ?? null;
}

export function sessionKeyFor(at: Date, structure: ProtocolStructure): string | null {
  return sessionFor(at, structure)?.dayLabel ?? null;
}

export interface PlannedDay {
  readonly completedAt: string;
  readonly sessionKey: string;
}

/**
 * Dias de treino previstos nos `days` dias que **antecedem** `reference` (exclusive),
 * do mais antigo ao mais recente. É o que o fallback do check-in usa para atribuir as
 * conclusões ao dia previsto do protocolo — nunca à data em que o aluno respondeu.
 */
export function plannedDaysBefore(
  reference: Date,
  days: number,
  structure: ProtocolStructure,
): PlannedDay[] {
  const planned: PlannedDay[] = [];
  for (let back = days; back >= 1; back -= 1) {
    const at = new Date(reference.getTime() - back * 86_400_000);
    const sessionKey = sessionKeyFor(at, structure);
    if (sessionKey) planned.push({ completedAt: dayKey(at), sessionKey });
  }
  return planned;
}
