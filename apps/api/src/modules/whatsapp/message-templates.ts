/**
 * Copy do outbound (US-2.5 / TASK-2.5.2-2.5.3) — persona MOVI (Sofia §11): calorosa,
 * direta, sem hype. Respaldo CREF sempre visível; transparência de IA na 1ª mensagem da
 * entrega. Guardrails inegociáveis: nunca "diagnóstico/tratamento/cura/garantido"; a IA
 * nunca decide sozinha (sempre "profissional CREF, usando IA como ferramenta").
 *
 * `\n---\n` separa bolhas — o outbound envia cada trecho como uma mensagem (Sofia §11).
 */
import type { ProtocolStructure } from '@movivo/shared';

/** Separador de bolhas — o worker envia cada trecho como uma mensagem distinta. */
export const BUBBLE_SEPARATOR = '\n---\n';

/** Confirmação imediata no submit (PAR-Q liberado). Reforça SLA de 2h e respaldo CREF. */
export function confirmationMessage(): string {
  return (
    'Recebemos seus dados! 🙌 Seu plano de treino chega aqui no WhatsApp em até 2 horas — ' +
    'montado com inteligência artificial e com o respaldo de um profissional de Educação ' +
    'Física registrado no CREF. Já já te chamo por aqui.'
  );
}

/** Variante de cuidado (PAR-Q de risco): sem prometer plano automático, sem alarme. */
export function confirmationCareMessage(): string {
  return (
    'Recebemos suas respostas, obrigada pela confiança! 🙏 Por segurança, um profissional ' +
    'de Educação Física registrado no CREF vai revisar algumas informações antes de liberar ' +
    'seu plano. Assim que estiver tudo certo, a gente te avisa por aqui.'
  );
}

/** Mensagem de espera do fallback de DLQ (US-2.4 enfileira `protocol-waiting`). */
export function waitingMessage(): string {
  return (
    'Oi! Estamos finalizando os últimos ajustes do seu plano de treino. Assim que ficar ' +
    'pronto, te aviso aqui no WhatsApp. 🙌'
  );
}

/** Uma linha por exercício: "• Nome — 3x8-12 (descanso 90s)". */
function exerciseLine(ex: ProtocolStructure['sessions'][number]['exercises'][number]): string {
  const reps = ex.reps.min === ex.reps.max ? `${ex.reps.min}` : `${ex.reps.min}-${ex.reps.max}`;
  return `• ${ex.name} — ${ex.sets}x${reps} (descanso ${ex.restSeconds}s)`;
}

/**
 * Entrega do protocolo em bolhas: (1) transparência de IA + respaldo CREF; (2) primeiro
 * treino da semana em destaque (aha moment); (3) link para o plano completo (US-2.6).
 */
export function formatProtocolDelivery(content: ProtocolStructure, link: string): string {
  const first = content.sessions[0];
  const intro =
    'Oi! Aqui é a MOVI 💪 Seu plano de treino está pronto — ele foi montado com inteligência ' +
    'artificial dentro da metodologia de um profissional de Educação Física registrado no CREF.';

  const firstWorkout = first
    ? [
        `Seu primeiro treino desta semana — ${first.focus}:`,
        ...first.exercises.map(exerciseLine),
      ].join('\n')
    : 'Seu primeiro treino desta semana já está no seu plano.';

  const cta = `Quer ver o plano completo das próximas semanas? É só abrir: ${link}`;

  return [intro, firstWorkout, cta].join(BUBBLE_SEPARATOR);
}
