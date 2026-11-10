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

const bubbles = (...parts: string[]) => parts.join(BUBBLE_SEPARATOR);

/**
 * Confirmação imediata no submit (PAR-Q liberado), sem prometer prazo. Fluxo v2 (copy do Bruno,
 * 2026-11-10): a MOVIVO entrega DOIS protocolos (treino e alimentar), montados pelos agentes com
 * os profissionais de Educação Física e Nutrição. Nenhuma mensagem do fluxo leva link.
 */
export function confirmationMessage(firstName: string | null): string {
  return bubbles(
    firstName ? `Oi, ${firstName}! Recebemos suas respostas 💚` : 'Oi! Recebemos suas respostas 💚',
    'Agora nossos agentes de IA e os profissionais de Educação Física e Nutrição vão montar seus dois protocolos: o de *treino* e o *alimentar*, a partir do que você contou.',
    'Quando estiverem prontos, eles chegam aqui mesmo, nesta conversa.',
  );
}

/**
 * Variante de cuidado (PAR-Q de risco): sem prometer plano automático, sem alarme e sem emoji.
 * "Agradecemos" (e não "obrigada/obrigado"): a copy sai assinada por persona masculina ou
 * feminina e a forma verbal não trava o gênero.
 */
export function confirmationCareMessage(firstName: string | null = null): string {
  return bubbles(
    firstName
      ? `${firstName}, recebemos suas respostas. Agradecemos a confiança.`
      : 'Recebemos suas respostas. Agradecemos a confiança.',
    'Por segurança, um profissional de Educação Física registrado no CREF vai revisar algumas informações antes de liberar seus protocolos de treino e alimentar. É um cuidado que a gente tem sempre que algumas respostas pedem um olhar mais próximo.',
    'Assim que estiver tudo certo, avisamos por aqui. Se surgir alguma dúvida nesse meio-tempo, é só responder esta conversa.',
  );
}

/**
 * Identificador interno da mensagem de verificação. A EvolutionAPI renderiza o texto
 * com o código; não depende de cadastro externo de Template.
 */
export const PHONE_VERIFICATION_TEMPLATE = 'verificacao_numero';

/**
 * Código de verificação de posse do número (antes de existir cadastro): uma bolha só, com o aviso
 * contra golpe. `*...*` é o negrito do WhatsApp (o `**` do markdown apareceria literal).
 */
export function phoneVerificationMessage(code: string): string {
  return (
    `Seu código de verificação da MOVIVO é *${code}*.\n` +
    'Ele vale por 10 minutos e confirma que este WhatsApp é seu.\n' +
    'Não compartilhe com ninguém, nem com quem disser ser da MOVIVO.\n' +
    'Se não foi você que pediu, é só ignorar esta mensagem.'
  );
}
