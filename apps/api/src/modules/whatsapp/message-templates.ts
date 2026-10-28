/**
 * Copy fixa do outbound: calorosa, direta, sem hype. Respaldo CREF sempre visível; transparência de IA na 1ª mensagem da
 * entrega. Guardrails inegociáveis: nunca "diagnóstico/tratamento/cura/garantido"; a IA
 * nunca decide sozinha (sempre "profissional CREF, usando IA como ferramenta").
 *
 * `\n---\n` separa bolhas — o outbound envia cada trecho como uma mensagem (Sofia §11).
 */
import { WHATSAPP_BUBBLE_SEPARATOR } from '../jobs/whatsapp-outbound.contract';

/**
 * Alerta interno à equipe (não é mensagem ao aluno): só o tipo e a prioridade do caso, sem
 * dado de saúde nem o nome do aluno — o conteúdo se vê no painel.
 */
export function staffQueueAlertMessage(kindLabel: string, priorityLabel: string): string {
  return `Novo caso na fila MOVIVO\nTipo: ${kindLabel}\nPrioridade: ${priorityLabel}`;
}

/** Separador de bolhas — o worker envia cada trecho como uma mensagem distinta. */
export const BUBBLE_SEPARATOR = WHATSAPP_BUBBLE_SEPARATOR;

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
export function confirmationMessage(firstName: string | null): string {
  const greeting = firstName ? `Olá, ${firstName}!` : 'Olá!';
  return (
    `${greeting} 💚\n\n` +
    'Recebemos suas informações e seu processo na MOVIVO já começou.\n\n' +
    'Agora vamos analisar seus objetivos, sua rotina e tudo o que você compartilhou com a ' +
    'gente para preparar um treino que realmente faça sentido para você.\n\n' +
    'Assim que estiver pronto, você recebe tudo por aqui.\n\n' +
    'Seu próximo movimento começa agora.'
  );
}

/**
 * Variante de cuidado (PAR-Q de risco): sem prometer plano automático, sem alarme.
 *
 * "Agradecemos a confiança" no lugar de "obrigada pela confiança" (Sprint 11): a copy é
 * determinística e sai assinada pela persona do titular, que pode ser masculina ou feminina.
 * Particípio flexionável ("obrigada"/"obrigado") travaria o gênero da agente no texto; a
 * forma verbal na primeira pessoa do plural não flexiona. Nada além dessa palavra mudou.
 */
export function confirmationCareMessage(): string {
  return (
    'Recebemos suas respostas, agradecemos a confiança! 🙏 Por segurança, um profissional ' +
    'de Educação Física registrado no CREF vai revisar algumas informações antes de liberar ' +
    'seu plano. Assim que estiver tudo certo, a gente te avisa por aqui.'
  );
}

/**
 * Identificador interno da mensagem de verificação. A EvolutionAPI renderiza o texto
 * com o código; não depende de cadastro externo de Template.
 */
export const PHONE_VERIFICATION_TEMPLATE = 'verificacao_numero';

/**
 * Código de verificação de posse do número (US-6.5). Copy nos guardrails: enquadra a
 * fricção como proteção do que o usuário quer (o treino), e avisa para não repassar o
 * código. A EvolutionAPI envia este texto literal.
 */
export function phoneVerificationMessage(code: string): string {
  return (
    // `*...*` é o negrito do WhatsApp (o `**` do markdown apareceria literal).
    `Seu código de confirmação da MOVIVO é *${code}*.\n\n` +
    'Ele confirma que este WhatsApp é seu e é válido por 10 minutos.\n\n' +
    'Não compartilhe este código com ninguém.'
  );
}
