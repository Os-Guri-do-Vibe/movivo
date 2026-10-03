/**
 * Negrito do WhatsApp é `*texto*`. Valores livres (nome do aluno, título de treino gerado
 * pelo LLM) passam por aqui: marcadores de formatação e quebras de linha são removidos para
 * que nada quebre o negrito nem injete formatação na mensagem.
 */
export function whatsappBold(value: string): string {
  const clean = value
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `*${clean}*`;
}
