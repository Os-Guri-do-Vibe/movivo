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

/**
 * Confirmação imediata no submit (PAR-Q liberado), sem prometer prazo operacional.
 *
 * -- EXCEÇÃO DELIBERADA ao guardrail "presença/respaldo do CREF sempre visível"
 * (CLAUDE.md, "Guardrails de linguagem — inegociáveis"): a pedido explícito do
 * fundador em 2026-08-18, este texto específico não menciona IA nem CREF. O
 * guardrail geral continua valendo pras demais mensagens (`confirmationCareMessage`,
 * entrega do protocolo, etc.) — essa é uma exceção pontual desta mensagem, não uma
 * revogação da política. Ver conversa da sessão pra contexto.
 */
export function confirmationMessage(): string {
  return (
    'Recebemos seus dados! 🙌 Seu plano de treino está sendo preparado com base nas informações ' +
    'que você enviou no formulário. Assim que estiver pronto, avisaremos você por aqui.'
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

/**
 * Nome do Template aprovado pela Meta (categoria UTILITY) que carrega o corpo de
 * `phoneVerificationMessage` com `{{1}}` no lugar do código. É a PRIMEIRA mensagem que o
 * número recebe — fora da janela de 24h, `send()` (texto livre) é rejeitado pela AraraHQ
 * (`422 CONVERSATION_WINDOW_CLOSED`); só um Template pré-aprovado passa. Ver nota em
 * `arara-transport.ts`. Renomear aqui exige recriar o Template do mesmo nome na AraraHQ.
 */
export const PHONE_VERIFICATION_TEMPLATE = 'verificacao_numero';

/**
 * Código de verificação de posse do número (US-6.5). Copy nos guardrails: enquadra a
 * fricção como proteção do que o usuário quer (o treino), e avisa para não repassar o
 * código. **Precisa bater com o corpo aprovado do Template `PHONE_VERIFICATION_TEMPLATE`
 * na AraraHQ** — mudou aqui (2026-08-18, a pedido do fundador), precisa mudar lá também
 * quando a criação de Template for desbloqueada (hoje o envio real passa pela
 * EvolutionAPI, que manda este texto literal, sem depender do Template).
 */
export function phoneVerificationMessage(code: string): string {
  return (
    `Seu código da MOVIVO é ${code}. Ele confirma que este WhatsApp é seu e vale por 10 minutos. ` +
    'Nunca compartilhe este código com ninguém.'
  );
}

/** Mensagem de espera do fallback de DLQ (US-2.4 enfileira `protocol-waiting`). */
export function waitingMessage(): string {
  return (
    'Oi! Estamos finalizando os últimos ajustes do seu plano de treino. Assim que ficar ' +
    'pronto, te aviso aqui no WhatsApp. 🙌'
  );
}

/**
 * Uma linha por exercício: "• Nome — 3x8-12 (descanso 90s)" para exercício de reps, ou
 * "• Nome — 3x40s (descanso 20s)" para exercício de duração (prancha/caminhada/bike/tiros —
 * achado 2026-08-18, `reps`/`durationSeconds` são mutuamente exclusivos no schema).
 */
function exerciseLine(ex: ProtocolStructure['sessions'][number]['exercises'][number]): string {
  const amount =
    ex.durationSeconds !== undefined
      ? `${ex.durationSeconds}s`
      : ex.reps && ex.reps.min === ex.reps.max
        ? `${ex.reps.min}`
        : `${ex.reps?.min}-${ex.reps?.max}`;
  return `• ${ex.name} — ${ex.sets}x${amount} (descanso ${ex.restSeconds}s)`;
}

/**
 * Entrega do protocolo em bolhas: (1) transparência de IA + respaldo CREF; (2) primeiro
 * treino da semana em destaque (aha moment); (3) link para o plano completo (US-2.6).
 */
export function formatProtocolDelivery(
  content: ProtocolStructure,
  link: string,
  agentName: string,
): string {
  const first = content.sessions[0];
  const intro =
    `Oi! Aqui é a ${agentName} 💪 Seu plano de treino está pronto — ele foi montado com inteligência ` +
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
