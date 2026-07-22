/**
 * Estados possíveis de um protocolo de treino.
 *
 * Fonte: agregado raiz `Protocol` em `docs/arquitetura/ARQUITETURA.md` §7.
 *
 * `PENDING_SIGNATURE` é estrutural, não cosmético: nenhum protocolo chega ao usuário
 * sem assinatura/supervisão do profissional CREF (guardrail de Clóvis e Alexandre —
 * a IA nunca prescreve sozinha).
 *
 * Apenas constantes — nenhuma lógica de transição aqui (regra da TASK-0.1.4).
 */
export const ProtocolStatus = {
  /** Gerado pelo Motor Determinístico + LLM, ainda não revisado. */
  DRAFT: 'DRAFT',
  /** Aguardando assinatura/supervisão do profissional CREF. */
  PENDING_SIGNATURE: 'PENDING_SIGNATURE',
  /** Assinado e vigente para o usuário. */
  ACTIVE: 'ACTIVE',
  /** Substituído por uma versão mais nova (ajuste pós check-in). */
  SUPERSEDED: 'SUPERSEDED',
} as const;

export type ProtocolStatus = (typeof ProtocolStatus)[keyof typeof ProtocolStatus];

export const PROTOCOL_STATUSES = Object.values(ProtocolStatus);
