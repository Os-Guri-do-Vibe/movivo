/**
 * Ciclo menstrual (regras puras): leitura das mensagens do WhatsApp e estimativa da fase.
 * A fase é estimativa por calendário — serve para acolher o que a aluna relata, nunca para
 * prescrever sozinha nem para avaliar saúde.
 */
export const CYCLE_AUTHORIZE_PHRASE = 'AUTORIZO CICLO';
export const CYCLE_REVOKE_PHRASE = 'REVOGAR CICLO';

const DAY_MS = 86_400_000;
/** Mensagem longa é conversa, não registro. */
const MAX_LOG_LENGTH = 160;
/** Quanto para trás um "dia 28" ainda é aceito. */
const MAX_BACKDATE_DAYS = 45;
/** Dois inícios mais próximos que isto são a mesma menstruação. */
export const SAME_PERIOD_DAYS = 15;
const DEFAULT_LENGTH = 28;
const START_PATTERN =
  /\b(menstruei|menstruada|comecei a menstruar|menstruacao (veio|desceu|chegou|comecou))\b/;

export type CycleCommand =
  { kind: 'AUTHORIZE' } | { kind: 'REVOKE' } | { kind: 'LOG'; onDate: string; question: boolean };

export type CyclePhase = 'MENSTRUAL' | 'FOLLICULAR' | 'OVULATORY' | 'LUTEAL';

export interface CycleView {
  lastStart: string;
  cycleDay: number;
  typicalLength: number;
  /** `null` = atraso/irregular: não especular. */
  phase: CyclePhase | null;
}

function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function addDaysIso(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** "hoje" (padrão), "ontem", "anteontem" ou "dia 28" (o dia 28 mais recente até hoje). */
function startDateOf(text: string, today: string): string | null {
  if (/\banteontem\b/.test(text)) return addDaysIso(today, -2);
  if (/\bontem\b/.test(text)) return addDaysIso(today, -1);
  const day = /\bdia (\d{1,2})\b/.exec(text)?.[1];
  if (!day) return today;
  const [y, m] = today.split('-').map(Number) as [number, number];
  for (const back of [0, 1]) {
    const date = new Date(Date.UTC(y, m - 1 - back, Number(day)));
    if (date.getUTCDate() !== Number(day)) continue;
    const iso = date.toISOString().slice(0, 10);
    const ago = daysBetween(iso, today);
    if (ago >= 0) return ago <= MAX_BACKDATE_DAYS ? iso : null;
  }
  return null;
}

export function parseCycleMessage(text: string, today: string): CycleCommand | null {
  const normalized = plain(text).replace(/[.!]+$/g, '');
  if (normalized.toUpperCase() === CYCLE_AUTHORIZE_PHRASE) return { kind: 'AUTHORIZE' };
  if (normalized.toUpperCase() === CYCLE_REVOKE_PHRASE) return { kind: 'REVOKE' };
  if (normalized.length > MAX_LOG_LENGTH || !START_PATTERN.test(normalized)) return null;
  const onDate = startDateOf(normalized, today);
  return onDate ? { kind: 'LOG', onDate, question: normalized.includes('?') } : null;
}

export function cycleView(starts: readonly string[], today: string): CycleView | null {
  const sorted = starts.filter((d) => d <= today).sort();
  const lastStart = sorted.at(-1);
  if (!lastStart) return null;
  const intervals = sorted
    .slice(1)
    .map((d, i) => daysBetween(sorted[i] as string, d))
    .filter((n) => n >= 21 && n <= 45);
  const typicalLength =
    intervals.length > 0
      ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length)
      : DEFAULT_LENGTH;
  const cycleDay = daysBetween(lastStart, today) + 1;
  const ovulation = typicalLength - 14;
  const phase: CyclePhase | null =
    cycleDay > typicalLength + 7
      ? null
      : cycleDay <= 5
        ? 'MENSTRUAL'
        : cycleDay < ovulation - 1
          ? 'FOLLICULAR'
          : cycleDay <= ovulation + 1
            ? 'OVULATORY'
            : 'LUTEAL';
  return { lastStart, cycleDay, typicalLength, phase };
}
