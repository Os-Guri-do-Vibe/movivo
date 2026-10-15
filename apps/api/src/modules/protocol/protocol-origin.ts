/**
 * Origem do conteúdo vigente de um protocolo (achado 2026-10-15, produção).
 *
 * `protocols.generated_by` já é a procedência de quem redigiu a versão (provedor da IA,
 * `FALLBACK_TEMPLATE`, ...). Quando o profissional CREF altera o conteúdo pelo painel, a
 * coluna passa a dizer isso — gravada pelo endpoint autenticado (`DashboardService`), nunca a
 * partir de flag do cliente. É o que faz a assinatura, as trocas automáticas e o AI Coach
 * tratarem o conteúdo como prescrição do profissional, não como sugestão da IA.
 *
 * A versão gerada pela IA continua preservada em `protocol_versions` (versão 1 e seguintes)
 * com o `generated_by` original.
 */

/** Conteúdo editado pelo profissional na fila de revisão, antes da assinatura. */
export const PROFESSIONAL_EDIT_ORIGIN = 'PROFESSIONAL_EDIT';

/** Conteúdo de um protocolo ativo alterado e republicado pelo profissional. */
export const MANUAL_AMENDMENT_ORIGIN = 'MANUAL_AMENDMENT';

const PROFESSIONAL_ORIGINS: ReadonlySet<string> = new Set([
  PROFESSIONAL_EDIT_ORIGIN,
  MANUAL_AMENDMENT_ORIGIN,
]);

export function isProfessionalAuthored(generatedBy: string | null | undefined): boolean {
  return generatedBy != null && PROFESSIONAL_ORIGINS.has(generatedBy);
}
