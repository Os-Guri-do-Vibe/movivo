/**
 * Alerta de frequência para o profissional CREF (pedido do fundador, 2026-10-13): quando o
 * aluno falta pela 3ª sessão prevista seguida, ou falta em mais de 60% das sessões previstas
 * das últimas duas semanas, o profissional (Léo) precisa entrar em contato manualmente para
 * entender o motivo. É um alerta ao PAINEL, nunca uma mensagem automática ao aluno.
 *
 * `evaluateAttendance` é pura (sem I/O) e usa só `dayStatus`: "faltou" tem uma única
 * definição no sistema (sessão prevista sem registro; treino em andamento não é falta).
 */
import { createHash } from 'node:crypto';

import type { WorkoutDayStatus } from './workout-journal.service';

/** Faltas seguidas (descanso não interrompe a sequência) a partir das quais o alerta abre. */
export const ATTENDANCE_STREAK_THRESHOLD = 3;
/** Alerta quando a proporção de faltas é MAIOR que este valor (60%). */
export const ATTENDANCE_RATE_THRESHOLD = 0.6;
/** Amostra mínima: com menos sessões previstas na janela, 2 de 3 faltas seria ruído. */
export const ATTENDANCE_MIN_PLANNED = 4;
/** Janela, em dias fechados, da proporção de faltas. */
export const ATTENDANCE_WINDOW_DAYS = 14;

export const ATTENDANCE_STREAK_REASON = 'FALTAS_SEGUIDAS';
export const ATTENDANCE_RATE_REASON = 'FALTAS_FREQUENTES';

/** Tempo em que um novo alerta do mesmo motivo não é aberto (o aberto já cobre o caso). */
export const ATTENDANCE_COOLDOWN_DAYS = {
  [ATTENDANCE_STREAK_REASON]: 7,
  [ATTENDANCE_RATE_REASON]: 14,
};

export type AttendanceFinding =
  | { reason: typeof ATTENDANCE_STREAK_REASON; streak: number; streakStart: string }
  | { reason: typeof ATTENDANCE_RATE_REASON; planned: number; missed: number };

export function evaluateAttendance(
  window: ReadonlyArray<{ date: string; status: WorkoutDayStatus }>,
): AttendanceFinding | null {
  // Sequência: do dia mais recente para trás, pulando descanso, até uma sessão feita (ou
  // iniciada) ou o começo do protocolo.
  let streak = 0;
  let streakStart = '';
  for (const { date, status } of [...window].reverse()) {
    if (status.kind === 'REST') continue;
    if (status.kind !== 'MISSED') break;
    streak += 1;
    streakStart = date;
  }
  if (streak >= ATTENDANCE_STREAK_THRESHOLD) {
    return { reason: ATTENDANCE_STREAK_REASON, streak, streakStart };
  }

  const planned = window.filter(({ status }) =>
    ['MISSED', 'DONE', 'IN_PROGRESS'].includes(status.kind),
  ).length;
  const missed = window.filter(({ status }) => status.kind === 'MISSED').length;
  if (planned >= ATTENDANCE_MIN_PLANNED && missed / planned > ATTENDANCE_RATE_THRESHOLD) {
    return { reason: ATTENDANCE_RATE_REASON, planned, missed };
  }
  return null;
}

/** UUID determinístico (formato v5) para a idempotência do alerta: `uq_handoff_alerts_source`. */
export function deterministicUuid(key: string): string {
  const hex = createHash('sha256').update(key).digest('hex');
  const variant = (8 + (Number.parseInt(hex.charAt(16), 16) % 4)).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
