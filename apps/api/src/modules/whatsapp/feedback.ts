/**
 * Botões de resposta rápida de feedback (US-3.6) — 👍/👎 anexados à resposta da MOVI.
 *
 * Um único lugar define o `id` do botão (enviado no outbound) e o parse do toque recebido
 * no webhook (US-3.1), para os dois lados nunca divergirem. No fake/dev o botão é só metadado.
 */
import type { QuickReplyButton } from './arara-transport';

export const FEEDBACK_UP_ID = 'fb_up';
export const FEEDBACK_DOWN_ID = 'fb_down';

/** Anexados à última bolha de uma resposta real (não a limite/segurança/DLQ). */
export const FEEDBACK_BUTTONS: readonly QuickReplyButton[] = [
  { id: FEEDBACK_UP_ID, title: '👍 Ajudou' },
  { id: FEEDBACK_DOWN_ID, title: '👎 Não ajudou' },
];

/** `UP`/`DOWN` se o id do botão é de feedback; `null` caso contrário. */
export function parseFeedback(buttonId: string | undefined): 'UP' | 'DOWN' | null {
  if (buttonId === FEEDBACK_UP_ID) return 'UP';
  if (buttonId === FEEDBACK_DOWN_ID) return 'DOWN';
  return null;
}
