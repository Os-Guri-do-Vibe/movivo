/**
 * Um texto com `\n---\n` vira UMA mensagem do WhatsApp por trecho (um balão cada). Vive aqui
 * porque quem envia (API) e quem exibe o histórico (painel "Conversas") precisam concordar:
 * o painel mostra um balão por trecho, exatamente como o aluno vê no celular.
 */
export const WHATSAPP_BUBBLE_SEPARATOR = '\n---\n';

/** Trechos não vazios, na ordem em que saem no WhatsApp. */
export function splitWhatsappBubbles(text: string): string[] {
  return text.split(WHATSAPP_BUBBLE_SEPARATOR).filter((bubble) => bubble.trim());
}
