/**
 * Carga de treino (determinística). Carga interna em todas as modalidades = sRPE
 * (PSE × minutos), inclusive esporte externo. Sessão "intensa" = PSE prevista ≥ 7.
 */
import type { PlanSession } from '@movivo/shared';

export const INTENSE_RPE = 7;

export function srpe(rpe: number, minutes: number): number {
  return Math.round(rpe * minutes);
}

export function sessionLoad(session: Pick<PlanSession, 'estimatedRpe' | 'estimatedMinutes'>) {
  return srpe(session.estimatedRpe, session.estimatedMinutes);
}

/** Carga semanal prevista de um conjunto de sessões-modelo (frequência × carga). */
export function weeklyLoad(sessions: readonly PlanSession[]): number {
  return sessions.reduce((sum, s) => sum + sessionLoad(s) * s.weeklyFrequency, 0);
}

export function isIntense(session: Pick<PlanSession, 'estimatedRpe' | 'content'>): boolean {
  if (session.content.modality === 'RUNNING') {
    const kind = session.content.kind;
    if (['TEMPO', 'THRESHOLD', 'INTERVALS', 'HILLS', 'RACE', 'TEST'].includes(kind)) return true;
  }
  if (session.content.modality === 'HYROX') {
    if (['SIMULATION', 'COMPROMISED_RUNNING'].includes(session.content.kind)) return true;
  }
  return session.estimatedRpe >= INTENSE_RPE;
}

export function intenseSessionsPerWeek(sessions: readonly PlanSession[]): number {
  return sessions.filter(isIntense).reduce((sum, s) => sum + s.weeklyFrequency, 0);
}

/** Sessão de membros inferiores pesada: alto impacto no desempenho de corrida intensa. */
export function isHeavyLower(session: Pick<PlanSession, 'content' | 'estimatedRpe'>): boolean {
  if (session.content.modality !== 'STRENGTH') return false;
  const focus = session.content.focus.toLowerCase();
  const lower = /(inferior|perna|quadr|posterior|glút|gluteo|agach|lower|leg)/.test(focus);
  return lower && session.estimatedRpe >= 6;
}
