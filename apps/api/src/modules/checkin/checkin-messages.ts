/**
 * Copy do check-in semanal (achado 2026-09-13) — substitui o fluxo de botão de WhatsApp.
 * Só duas mensagens: o convite (com o link do formulário) e o lembrete de reengajamento.
 *
 * # Guardrail de linguagem (inegociável — `CLAUDE.md`)
 * Nunca "diagnóstico"/"tratamento"/"cura"/resultado garantido; a IA nunca decide sozinha,
 * sempre "profissional CREF, usando IA como ferramenta".
 */
export function checkinWeeklyInviteMessage(firstName: string | null, link: string): string {
  const greeting = firstName ? `${firstName}, mais` : 'Mais';
  return (
    `${greeting} uma semana de movimento concluída! Responda seu check-in semanal: ${link}\n\n` +
    'O profissional CREF da MOVIVO acompanha suas respostas.'
  );
}

export function checkinWeeklyNudgeMessage(link: string): string {
  return `Seu movimento pode recomeçar no seu ritmo. Que tal fazer seu check-in agora? ${link}`;
}
