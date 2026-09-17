/**
 * Copy do treino diário (US-8.1 / TASK-8.1.3).
 *
 * Achado 2026-09-12 (decisão do fundador): o quick reply "Treinei ✅"/"Hoje não" (US-8.1
 * original) foi REMOVIDO — nunca chegou a ser enviado por nenhum scheduler (o texto, os
 * botões e o parser existiam, mas nada os enfileirava), e a definição de "treinou" deixou
 * de admitir qualquer canal de WhatsApp: só o diário de treino web conta
 * (`workout_sessions.status = 'COMPLETED'`, ver `WorkoutJournalService.finish()`).
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

export function dailyWorkoutMessage(firstName: string, link: string): string {
  return `Bom dia, ${firstName}! Seu treino de hoje esta pronto: ${link}\n\nO planejamento segue a metodologia do profissional CREF da MOVIVO. Se quiser receber em outro horario, e so me dizer por aqui.`;
}

export function durationInsightMessage(observed: number, expected: number): string {
  return `Percebemos que seus ultimos treinos duraram em media ${observed} min, acima dos ${expected} min informados. Quer que o profissional CREF avalie um ajuste ou esse tempo esta tranquilo?`;
}

export function durationInsightButtons(insightId: string): readonly WhatsappQuickReplyButton[] {
  return [
    { id: `workout-insight:${insightId}:ADJUST`, title: 'Quero ajustar' },
    { id: `workout-insight:${insightId}:OK`, title: 'Esta tranquilo' },
  ];
}

const INSIGHT_PATTERN = /^workout-insight:([0-9a-f-]{36}):(ADJUST|OK)$/i;

export function parseDurationInsightButton(buttonId: string | undefined) {
  const match = buttonId ? INSIGHT_PATTERN.exec(buttonId) : null;
  return match?.[1] ? { id: match[1], adjust: match[2] === 'ADJUST' } : null;
}
