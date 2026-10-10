import { whatsappBold as bold } from '../../core/text/whatsapp-format';

/**
 * Copy de assinatura (US-4.2) — dunning conversacional do PAST_DUE (decisão do fundador): a MOVI
 * manda o link de pagamento no WhatsApp durante a janela de graça, sem bloqueio abrupto. Dentro
 * dos guardrails (persona MOVI, cancelamento sempre possível, nunca "resultado garantido").
 */
export function dunningMessage(checkoutUrl: string): string {
  return (
    'Oi! Notei que o pagamento da sua assinatura não passou desta vez. 💚 Seu acesso segue ' +
    'liberado por enquanto, quando puder, é só atualizar por aqui: ' +
    checkoutUrl +
    '\nQualquer dúvida, me chama. Você pode cancelar quando quiser, sem burocracia.'
  );
}

/**
 * Primeira cobrança não liquidada (Pix vencido, QR do Pix Automático expirado, cartão reprovado
 * na análise de risco). Diferente do dunning: não existe período pago em curso, então a copy
 * não promete acesso liberado — só oferece um novo link.
 */
export function firstPaymentFailedMessage(checkoutUrl: string): string {
  return (
    'Oi! O pagamento da sua assinatura MOVIVO não foi concluído, então ela ainda não está ' +
    'ativa. Se quiser seguir, é só gerar um novo pagamento por aqui: ' +
    checkoutUrl +
    '\nQualquer dúvida, me chama. Você pode cancelar quando quiser, sem burocracia.'
  );
}

/** Confirmação pós-webhook: só sai depois que o backend autenticou o evento do provedor. */
export function paymentConfirmationMessage(cancelUrl: string): string {
  return (
    'Pagamento confirmado 💚 Sua assinatura MOVIVO está ativa e seu acesso continua liberado. ' +
    'Sua orientação de treino segue supervisionada por profissional de Educação Física ' +
    'registrado no CREF. Você pode gerenciar ou cancelar sua assinatura por aqui: ' +
    cancelUrl +
    '\nQualquer dúvida, me chama por aqui.'
  );
}

/** Resposta ao pedido de cancelamento/gerenciamento (WhatsApp ou página pública `/conta`). */
export function subscriptionAccessMessage(portalUrl: string): string {
  return (
    'Claro! Aqui está o seu link para gerenciar ou cancelar a assinatura MOVIVO, sem burocracia:\n' +
    `${portalUrl}\n\n` +
    'Se precisar de ajuda com qualquer coisa, é só me chamar por aqui. 💚'
  );
}

/** Link novo do checkout, pedido por quem abriu um link vencido. */
export function checkoutLinkMessage(checkoutUrl: string): string {
  return (
    'Aqui está um novo link para ativar a sua assinatura MOVIVO:\n' +
    `${checkoutUrl}\n\n` +
    'Você pode cancelar quando quiser, sem burocracia. Continue se movendo. 👊🏼'
  );
}

/**
 * Sequência de nurturing de conversão do trial (US-4.3), dias 7/10/13/14 (Lucas §Épico 5).
 * ⚠️ Copy a aprovar (Helena/Sofia/Alexandre). Persona MOVI, dentro dos guardrails: garantia de
 * cancelamento visível, respaldo CREF, **nunca** "resultado garantido"/diagnóstico/tratamento.
 */
export type ConversionTouchpoint = 'day7' | 'day10' | 'day13' | 'day14' | 'winback';

/**
 * Fim dos 7 dias gratuitos (touchpoint `day7`) e seus follow-ups (`day10`, `day13`, `day14`),
 * todos com este mesmo texto. Os dois links são curtos e personalizados (`/checkout/<código>` e
 * `/cancelar/<código>`), no mesmo padrão do link do check-in diário.
 */
export function trialEndedMessage(
  firstName: string,
  checkoutUrl: string,
  cancelUrl: string,
): string {
  return (
    `${bold(firstName)}, seus 7 dias gratuitos com a MOVIVO chegaram ao fim. 💚\n\n` +
    'Para continuar com o acompanhamento MOVIVO, é só ativar sua assinatura:\n' +
    `${checkoutUrl}\n\n` +
    'Você pode cancelar quando quiser, sem burocracia:\n' +
    `${cancelUrl}\n\n` +
    'Continue se movendo. 👊🏼'
  );
}

/** Fim do período pago sem renovação (ACTIVE → EXPIRED). `planLabel`: mensal, trimestral… */
export function planEndedMessage(
  firstName: string,
  planLabel: string,
  checkoutUrl: string,
  cancelUrl: string,
): string {
  return (
    `${bold(firstName)}, seu plano ${bold(planLabel.toLowerCase())} MOVIVO chegou ao fim. 💚\n\n` +
    'Para continuar com o acompanhamento MOVIVO, é só renovar sua assinatura:\n' +
    `${checkoutUrl}\n\n` +
    'Você pode cancelar quando quiser, sem burocracia:\n' +
    `${cancelUrl}\n\n` +
    'Continue se movendo. 👊🏼'
  );
}

/**
 * Win-back pós-trial. Não é agendado pela sequência (coincidiria com o dia 10); só sai quando
 * disparado explicitamente.
 */
export function winbackMessage(checkoutUrl: string): string {
  return (
    'Vi que seu período de experiência terminou e você decidiu não seguir agora, tudo bem, ' +
    'sem pressão! 🙏 Só pra eu melhorar: o que faltou pra fazer sentido? (preço, tempo, ' +
    'rotina...) Se quiser voltar, o plano que você escolheu continua aqui: ' +
    checkoutUrl +
    // "Valeu por treinar" no lugar de "obrigada por treinar" (Sprint 11): a mensagem é
    // assinada pela persona do titular, que pode ser masculina ou feminina, e o
    // particípio "obrigada/obrigado" travaria o gênero da agente. Mesmo tom informal.
    '\nDe qualquer forma, valeu por treinar com a gente. 💚'
  );
}
