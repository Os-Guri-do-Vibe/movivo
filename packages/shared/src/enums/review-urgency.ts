/**
 * Urgência de revisão humana de um protocolo `PENDING_REVIEW` (fila do profissional).
 *
 * Só faz sentido enquanto `approvalStatus = PENDING_REVIEW` — nasce da distinção que o
 * `ValidationService` já faz internamente (`BLOCK_FALLBACK` vs `FLAG_HUMAN_REVIEW`), que
 * antes colapsava no mesmo `humanReviewRequired: true` sem diferenciação persistida.
 *
 * Apenas constantes — sem lógica de transição (regra da TASK-0.1.4).
 */
export const ProtocolReviewUrgency = {
  /** Falhou validação 2x (fallback template) — nunca libera sozinho, exige o CREF. */
  MANDATORY: 'MANDATORY',
  /** Flagado para revisão, mas liberável sozinho após a janela de cortesia de 1h. */
  OPTIONAL: 'OPTIONAL',
} as const;

export type ProtocolReviewUrgency =
  (typeof ProtocolReviewUrgency)[keyof typeof ProtocolReviewUrgency];

export const PROTOCOL_REVIEW_URGENCIES = Object.values(ProtocolReviewUrgency);
