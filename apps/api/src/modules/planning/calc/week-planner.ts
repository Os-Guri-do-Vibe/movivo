/**
 * Agenda de uma semana (sem LLM): atribui as sessões do plano aos dias respeitando a
 * disponibilidade do aluno e as regras de interferência da metodologia HYBRID.
 *
 * Busca exaustiva com poda (poucas variáveis: no máximo ~14 ocorrências em 7 dias), maximizando
 * o peso das sessões encaixadas — a sessão-chave nunca perde para uma complementar — e, no
 * empate, a distribuição mais uniforme. Regra explícita: sessão que não cabe é DESCARTADA da
 * semana com o motivo; nunca é "compensada" empilhando treinos nos dias seguintes.
 */
import type { DaySlot, SessionPriority, Weekday } from '@movivo/shared';

import type { HybridRules } from './params';
import { at } from './util';

export interface WeekOccurrence {
  planSessionKey: string;
  /** Índice da ocorrência na semana (1..frequência). */
  occurrence: number;
  priority: SessionPriority;
  minutes: number;
  intense: boolean;
  heavyLower: boolean;
  /** Corrida intensa: sofre a interferência de uma sessão de inferiores pesada. */
  intenseRun: boolean;
  /** Dia fixo (esporte externo com dia marcado). */
  fixedOn?: string;
}

export interface WindowOfDay {
  slot: DaySlot;
  maxMinutes: number;
}

export interface WeekInput {
  /** Segunda-feira da semana (YYYY-MM-DD). */
  weekStart: string;
  /** Primeiro dia em que se pode agendar (a semana de início pode começar no meio). */
  notBefore: string;
  windows: Readonly<Partial<Record<Weekday, readonly WindowOfDay[]>>>;
  occurrences: readonly WeekOccurrence[];
  rules: HybridRules;
  /** Dias leves exigidos entre duas sessões intensas (0 = só não no mesmo dia). */
  minEasyDaysBetweenIntense: number;
}

export interface Assignment {
  planSessionKey: string;
  occurrence: number;
  date: string;
  slot: DaySlot;
}

export interface Dropped {
  planSessionKey: string;
  occurrence: number;
  reason: string;
}

export interface WeekPlan {
  assignments: Assignment[];
  dropped: Dropped[];
}

const WEEKDAYS: readonly Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const PRIORITY_WEIGHT: Record<SessionPriority, number> = {
  KEY: 100,
  IMPORTANT: 10,
  COMPLEMENTARY: 1,
};
const SLOT_ORDER: Record<DaySlot, number> = { MORNING: 0, AFTERNOON: 1, EVENING: 2, ANY: 3 };
const NODE_LIMIT = 300_000;

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function mondayOf(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  return addDays(iso, -offset);
}

interface Placed {
  occurrence: WeekOccurrence;
  day: number;
  slot: DaySlot;
}

/**
 * Atribui uma janela distinta do dia a cada sessão (ajuste pelo menor suficiente, das maiores
 * para as menores). Devolve os slots NA ORDEM de `minutes`, ou `null` se não couber.
 */
function fitSlots(windows: readonly WindowOfDay[], minutes: readonly number[]): DaySlot[] | null {
  const free = windows.map((w, index) => ({ ...w, index }));
  const result: DaySlot[] = new Array(minutes.length);
  const order = minutes.map((need, i) => ({ need, i })).sort((a, b) => b.need - a.need);
  for (const { need, i } of order) {
    const candidates = free
      .filter((w) => w.maxMinutes >= need)
      .sort((a, b) => a.maxMinutes - b.maxMinutes || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]);
    const chosen = candidates[0];
    if (!chosen) return null;
    free.splice(free.indexOf(chosen), 1);
    result[i] = chosen.slot;
  }
  return result;
}

export function planWeek(input: WeekInput): WeekPlan {
  const { rules } = input;
  const firstDay = Math.max(
    0,
    Math.round(
      (Date.parse(`${input.notBefore}T00:00:00Z`) - Date.parse(`${input.weekStart}T00:00:00Z`)) /
        86_400_000,
    ),
  );
  const minGapDaysIntenseLower =
    rules.hoursBetweenHeavyLowerAndIntenseRun === null
      ? 0
      : Math.ceil(rules.hoursBetweenHeavyLowerAndIntenseRun / 24);

  const fixed: Placed[] = [];
  const free: WeekOccurrence[] = [];
  for (const occurrence of input.occurrences) {
    if (occurrence.fixedOn) {
      const day = Math.round(
        (Date.parse(`${occurrence.fixedOn}T00:00:00Z`) -
          Date.parse(`${input.weekStart}T00:00:00Z`)) /
          86_400_000,
      );
      if (day >= firstDay && day <= 6) fixed.push({ occurrence, day, slot: 'ANY' });
    } else {
      free.push(occurrence);
    }
  }
  free.sort(
    (a, b) =>
      PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] ||
      b.minutes - a.minutes ||
      a.planSessionKey.localeCompare(b.planSessionKey) ||
      a.occurrence - b.occurrence,
  );

  const dayWindows = (day: number) => input.windows[at(WEEKDAYS, day)] ?? [];

  /** Regras entre a nova colocação e as já feitas. */
  function compatible(placed: readonly Placed[], day: number, occ: WeekOccurrence): boolean {
    const sameDay = placed.filter((p) => p.day === day);
    if (sameDay.length > 0 && !rules.allowTwoSessionsSameDay) return false;
    if (sameDay.length >= 2) return false;
    for (const other of placed) {
      const gap = Math.abs(other.day - day);
      if (other.occurrence.planSessionKey === occ.planSessionKey && gap < 2) return false;
      if (occ.intense && other.occurrence.intense && gap <= input.minEasyDaysBetweenIntense) {
        return false;
      }
      const lowerVsRun =
        (occ.heavyLower && other.occurrence.intenseRun) ||
        (occ.intenseRun && other.occurrence.heavyLower);
      if (lowerVsRun && gap < minGapDaysIntenseLower) return false;
    }
    if (occ.intense) {
      const intense = placed.filter((p) => p.occurrence.intense).length + 1;
      if (rules.maxIntenseSessionsPerWeek !== null && intense > rules.maxIntenseSessionsPerWeek) {
        return false;
      }
    }
    return true;
  }

  function slotsFor(placed: readonly Placed[], day: number, occ: WeekOccurrence): DaySlot[] | null {
    const sameDay = placed.filter((p) => p.day === day);
    const windows = dayWindows(day);
    if (windows.length === 0) return null;
    return fitSlots(windows, [...sameDay.map((p) => p.occurrence.minutes), occ.minutes]);
  }

  let best: { score: number; spread: number; placed: Placed[] } = {
    score: -1,
    spread: Number.POSITIVE_INFINITY,
    placed: [],
  };
  let nodes = 0;
  const suffixWeight: number[] = new Array(free.length + 1).fill(0);
  for (let i = free.length - 1; i >= 0; i -= 1) {
    suffixWeight[i] = at(suffixWeight, i + 1) + PRIORITY_WEIGHT[at(free, i).priority];
  }

  function spreadOf(placed: readonly Placed[]): number {
    const days = [...new Set(placed.map((p) => p.day))].sort((a, b) => a - b);
    let sum = 0;
    for (let i = 1; i < days.length; i += 1) sum += (at(days, i) - at(days, i - 1) - 2) ** 2;
    return sum;
  }

  function search(index: number, placed: Placed[], score: number): void {
    nodes += 1;
    if (nodes > NODE_LIMIT) return;
    if (index === free.length) {
      const spread = spreadOf(placed);
      if (score > best.score || (score === best.score && spread < best.spread)) {
        best = { score, spread, placed: [...placed] };
      }
      return;
    }
    if (score + at(suffixWeight, index) < best.score) return;
    const occ = at(free, index);
    for (let day = firstDay; day <= 6; day += 1) {
      if (!compatible(placed, day, occ)) continue;
      const slots = slotsFor(placed, day, occ);
      if (!slots) continue;
      placed.push({ occurrence: occ, day, slot: slots[slots.length - 1] ?? 'ANY' });
      search(index + 1, placed, score + PRIORITY_WEIGHT[occ.priority]);
      placed.pop();
    }
    search(index + 1, placed, score);
  }

  search(
    0,
    [...fixed],
    fixed.reduce((s, p) => s + PRIORITY_WEIGHT[p.occurrence.priority], 0),
  );

  // Dias de descanso mínimos: remove as sessões menos prioritárias até a regra valer.
  let result = best.placed;
  const occupiedDays = () => new Set(result.map((p) => p.day)).size;
  const availableDays = 7 - firstDay;
  if (rules.minRestDaysPerWeek !== null && firstDay === 0) {
    while (availableDays - occupiedDays() < rules.minRestDaysPerWeek) {
      const removable = result
        .filter((p) => !p.occurrence.fixedOn)
        .sort(
          (a, b) => PRIORITY_WEIGHT[a.occurrence.priority] - PRIORITY_WEIGHT[b.occurrence.priority],
        )[0];
      if (!removable) break;
      result = result.filter((p) => p !== removable);
    }
  }

  const placedKeys = new Set(
    result.map((p) => `${p.occurrence.planSessionKey}#${p.occurrence.occurrence}`),
  );
  // Esporte externo com dia fixo entra na agenda como ocorrência já posicionada.
  const assignments: Assignment[] = result
    .map((p) => ({
      planSessionKey: p.occurrence.planSessionKey,
      occurrence: p.occurrence.occurrence,
      date: addDays(input.weekStart, p.day),
      slot: p.slot,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]);
  const dropped: Dropped[] = free
    .filter((o) => !placedKeys.has(`${o.planSessionKey}#${o.occurrence}`))
    .map((o) => ({
      planSessionKey: o.planSessionKey,
      occurrence: o.occurrence,
      reason:
        'não coube na semana sem violar a disponibilidade ou o espaçamento entre sessões intensas',
    }));
  return { assignments, dropped };
}
