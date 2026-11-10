import type { CoachingAction } from '@movivo/shared';

import { isPlanSubstitution } from './autonomy-policy';

/**
 * Janela da revisão opcional na Fila do Profissional: se ninguém revisar nem liberar, a mudança
 * é liberada sozinha. Fonte única do prazo gravado no caso (`auto_release_at`) e do atraso do
 * job de liberação.
 */
export const PROTOCOL_REVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Troca de exercício no protocolo: janela curta, o aluno está esperando o protocolo novo. */
export const SUBSTITUTION_REVIEW_WINDOW_MS = 5 * 60 * 1000;

export function reviewWindowMs(action: CoachingAction): number {
  return isPlanSubstitution(action) ? SUBSTITUTION_REVIEW_WINDOW_MS : PROTOCOL_REVIEW_WINDOW_MS;
}
