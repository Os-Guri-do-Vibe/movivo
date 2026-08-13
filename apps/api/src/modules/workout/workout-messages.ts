/**
 * Copy e parsing do quick reply diário de treino (US-8.1 / TASK-8.1.3).
 *
 * # Guardrail de linguagem (inegociável — `CLAUDE.md`)
 * Toda string daqui fala de **treino registrado**, nunca de "evolução do quadro",
 * "progresso clínico", "diagnóstico", "tratamento" ou promessa de resultado. E a IA
 * nunca aparece como autoridade: o enquadramento é sempre acompanhamento **com a
 * metodologia do profissional CREF**, com a IA como ferramenta. `workout-messages.spec.ts`
 * varre estas constantes contra a lista de termos proibidos — não editar a copy sem
 * rodar aquele teste.
 */
import type { WhatsappQuickReplyButton } from '../jobs/whatsapp-outbound.contract';

export const WORKOUT_QUICK_REPLY_TEXT =
  'Fechando o dia: você conseguiu fazer o treino de hoje? Um toque já registra. ' +
  'O acompanhamento segue a metodologia do profissional CREF da MOVIVO.';

export const WORKOUT_DONE_TITLE = 'Treinei ✅';
export const WORKOUT_SKIPPED_TITLE = 'Hoje não';

/** Confirmação após o toque. Registra o fato; não promete nem interpreta resultado. */
export const WORKOUT_DONE_ACK =
  'Treino registrado. Obrigado por avisar — isso mantém seu acompanhamento com o profissional CREF da MOVIVO em dia.';
export const WORKOUT_SKIPPED_ACK =
  'Anotado, nenhum treino registrado hoje. Sem cobrança: seu plano continua igual e o profissional CREF da MOVIVO acompanha o conjunto da semana.';

/**
 * `workout:<DONE|SKIP>:<YYYY-MM-DD>:<sessionKey>`. A parte variável fica por último
 * porque `sessionKey` (`ProtocolSession.dayLabel`) é texto livre de até 60 chars e pode
 * conter `:` — o regex ancorado no fim é o que torna o parse inequívoco. Cabe no limite
 * de 100 chars de `buttonId` do webhook (8 + 5 + 11 + 60 = 84).
 */
const BUTTON_PATTERN = /^workout:(DONE|SKIP):(\d{4}-\d{2}-\d{2}):(.{1,60})$/;

export interface WorkoutButton {
  readonly done: boolean;
  readonly completedAt: string;
  readonly sessionKey: string;
}

export function workoutButtons(
  completedAt: string,
  sessionKey: string,
): readonly WhatsappQuickReplyButton[] {
  return [
    { id: `workout:DONE:${completedAt}:${sessionKey}`, title: WORKOUT_DONE_TITLE },
    { id: `workout:SKIP:${completedAt}:${sessionKey}`, title: WORKOUT_SKIPPED_TITLE },
  ];
}

export function parseWorkoutButton(buttonId: string | undefined): WorkoutButton | null {
  const match = buttonId ? BUTTON_PATTERN.exec(buttonId) : null;
  if (!match) return null;
  const [, action, completedAt, sessionKey] = match;
  if (!completedAt || !sessionKey) return null;
  return { done: action === 'DONE', completedAt, sessionKey };
}
