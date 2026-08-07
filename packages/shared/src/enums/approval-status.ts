/**
 * Estado de aprovação/roteamento de um protocolo ao painel do RT CREF (US-2.4).
 *
 * Modelo "gera-e-valida" (decisão do fundador, 2026-07): todo protocolo nasce roteado ao
 * painel do profissional. Sem risco mapeado (validador passou limpo) → `AUTO_APPROVED`
 * (assinado em nível de metodologia pelo RT, entregue). Validador bloqueou/flagou →
 * `PENDING_REVIEW` (não entrega, aguarda o painel — Sprint 5). PAR-Q de risco nem chega
 * a gerar protocolo (trava no Worker); `BLOCKED_PENDING_CLEARANCE` existe para o
 * frontend (US-2.6) rotular o estado de espera dessas sessões.
 *
 * Apenas constantes — sem lógica de transição (regra da TASK-0.1.4).
 */
export const ProtocolApprovalStatus = {
  /** Validador limpo → assinado (metodologia RT) e entregue. */
  AUTO_APPROVED: 'AUTO_APPROVED',
  /** Validador bloqueou/flagou → aguarda revisão humana no painel CREF (Sprint 5). */
  PENDING_REVIEW: 'PENDING_REVIEW',
  /** Conteudo revisado e assinado por profissional CREF autenticado. */
  HUMAN_APPROVED: 'HUMAN_APPROVED',
  /** PAR-Q de risco: sessão travada aguardando liberação profissional (Sprint 5). */
  BLOCKED_PENDING_CLEARANCE: 'BLOCKED_PENDING_CLEARANCE',
} as const;

export type ProtocolApprovalStatus =
  (typeof ProtocolApprovalStatus)[keyof typeof ProtocolApprovalStatus];

export const PROTOCOL_APPROVAL_STATUSES = Object.values(ProtocolApprovalStatus);
