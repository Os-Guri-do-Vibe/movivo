/**
 * Frequência semanal e dias de treino (achado 2026-10-15, produção).
 *
 * A anamnese coleta dois dados diferentes e o sistema tratava os dois como um só:
 *  - `daysPerWeek` (1..7): quantas sessões o aluno CONSEGUE fazer por semana — é o teto;
 *  - `preferredDays`: em que dias ele PREFERE treinar — é preferência de distribuição.
 *
 * Até aqui o prompt mandava "uma sessão por dia desta lista" e o validador cobrava
 * `sessions.length === preferredDays.length`, ignorando `daysPerWeek`. Quem marcava 4 dias
 * disponíveis e 7 dias preferidos recebia 7 sessões. Este módulo é a fonte única da regra,
 * usada pelo prompt, pelo validador, pelo reparo determinístico e pelo template de fallback:
 *
 *  - a meta (e o teto) de sessões é `daysPerWeek`;
 *  - com mais dias preferidos que a meta, as sessões ficam DENTRO dos preferidos;
 *  - com menos, todos os preferidos são usados e o restante vai para outros dias — sem
 *    transformar esses dias em "preferência" do aluno;
 *  - sem dias preferidos, nenhuma restrição de dia (comportamento anterior).
 *
 * Funções puras, sem I/O.
 */
import type { Weekday } from '@movivo/shared';

export const WEEK_ORDER: readonly Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export interface TrainingAvailability {
  /** Ausente em protocolo antigo/fallback antigo: cai na regra legada (ver `weeklySessionTarget`). */
  daysPerWeek?: number;
  preferredDays?: readonly Weekday[];
}

/** `daysPerWeek` válido (inteiro 1..7) ou `undefined` — nunca inventa um valor. */
export function validDaysPerWeek(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7
    ? value
    : undefined;
}

/** Dias preferidos sem repetição e na ordem da semana. */
export function normalizedPreferredDays(days: readonly Weekday[] | undefined): Weekday[] {
  const set = new Set(days ?? []);
  return WEEK_ORDER.filter((day) => set.has(day));
}

/**
 * Quantas sessões por semana o protocolo deve ter. `daysPerWeek` quando existe; senão, a regra
 * legada (uma por dia preferido) para não reinterpretar protocolos persistidos antes deste
 * campo chegar às constraints. `undefined` = nada a cobrar.
 */
export function weeklySessionTarget(availability: TrainingAvailability): number | undefined {
  const days = validDaysPerWeek(availability.daysPerWeek);
  if (days !== undefined) return days;
  const preferred = normalizedPreferredDays(availability.preferredDays);
  return preferred.length > 0 ? preferred.length : undefined;
}

/** Distância circular (em dias) entre treinos consecutivos da semana, na ordem da semana. */
function circularGaps(indexes: readonly number[]): number[] {
  if (indexes.length < 2) return [7];
  return indexes.map((day, i) => {
    const next = indexes[(i + 1) % indexes.length] as number;
    return (next - day + 7) % 7 || 7;
  });
}

function combinations<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [head, ...tail] = items as [T, ...T[]];
  return [
    ...combinations(tail, size - 1).map((rest) => [head, ...rest]),
    ...combinations(tail, size),
  ];
}

/**
 * Melhor combinação para recuperação: maximiza o menor intervalo entre treinos e, empatado,
 * o espaçamento mais regular (menor soma dos quadrados dos intervalos). Empate final: a
 * combinação que começa mais cedo na semana — determinístico.
 */
function bestSpread(candidates: readonly Weekday[][]): Weekday[] {
  let best: { days: Weekday[]; minGap: number; spread: number } | undefined;
  for (const days of candidates) {
    const indexes = days.map((d) => WEEK_ORDER.indexOf(d)).sort((a, b) => a - b);
    const gaps = circularGaps(indexes);
    const minGap = Math.min(...gaps);
    const spread = gaps.reduce((sum, gap) => sum + gap * gap, 0);
    if (!best || minGap > best.minGap || (minGap === best.minGap && spread < best.spread)) {
      best = { days, minGap, spread };
    }
  }
  return best ? WEEK_ORDER.filter((day) => best.days.includes(day)) : [];
}

/**
 * Dias sugeridos para `daysPerWeek` sessões, espaçados para recuperação. É a distribuição
 * determinística usada pelo template de fallback, pelo preenchimento de `weekday` quando a IA
 * o omite e como sugestão no prompt — a IA pode escolher outra combinação válida conforme a
 * divisão de treino.
 */
export function planTrainingWeekdays(
  daysPerWeek: number,
  preferredDays: readonly Weekday[] = [],
): Weekday[] {
  const target = validDaysPerWeek(daysPerWeek) ?? 1;
  const preferred = normalizedPreferredDays(preferredDays);
  if (preferred.length >= target) return bestSpread(combinations(preferred, target));
  const others = WEEK_ORDER.filter((day) => !preferred.includes(day));
  return bestSpread(
    combinations(others, target - preferred.length).map((extra) => [...preferred, ...extra]),
  );
}

/** Dias que aparecem em mais de uma sessão — duas sessões no mesmo dia são treino extra. */
export function duplicatedWeekdays(sessionWeekdays: ReadonlyArray<Weekday | undefined>): Weekday[] {
  const seen = new Set<Weekday>();
  const duplicated = new Set<Weekday>();
  for (const day of sessionWeekdays) {
    if (day === undefined) continue;
    if (seen.has(day)) duplicated.add(day);
    seen.add(day);
  }
  return WEEK_ORDER.filter((day) => duplicated.has(day));
}

export type WeekdayPlanIssue =
  | { kind: 'OUTSIDE_PREFERRED'; weekdays: Weekday[] }
  | { kind: 'MISSING_PREFERRED'; weekdays: Weekday[] }
  | { kind: 'MISSING_WEEKDAY' };

/**
 * Confere os `weekday` das sessões contra os dias preferidos. Sem dias preferidos não há o
 * que conferir — o dia é livre (e o calendário cai no padrão por frequência).
 */
export function weekdayPlanIssues(
  sessionWeekdays: ReadonlyArray<Weekday | undefined>,
  availability: TrainingAvailability,
): WeekdayPlanIssue[] {
  const preferred = normalizedPreferredDays(availability.preferredDays);
  if (preferred.length === 0) return [];
  const issues: WeekdayPlanIssue[] = [];
  if (sessionWeekdays.some((day) => day === undefined)) issues.push({ kind: 'MISSING_WEEKDAY' });
  const seen = new Set(sessionWeekdays.filter((day): day is Weekday => day !== undefined));
  const target = weeklySessionTarget(availability) ?? preferred.length;
  if (preferred.length >= target) {
    const outside = WEEK_ORDER.filter((day) => seen.has(day) && !preferred.includes(day));
    if (outside.length > 0) issues.push({ kind: 'OUTSIDE_PREFERRED', weekdays: outside });
  } else {
    const missing = preferred.filter((day) => !seen.has(day));
    if (missing.length > 0) issues.push({ kind: 'MISSING_PREFERRED', weekdays: missing });
  }
  return issues;
}
