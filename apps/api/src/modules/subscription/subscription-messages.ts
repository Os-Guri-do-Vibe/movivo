/**
 * Copy de assinatura (US-4.2) — dunning conversacional do PAST_DUE (decisão do fundador): a MOVI
 * manda o link de pagamento no WhatsApp durante a janela de graça, sem bloqueio abrupto. Dentro
 * dos guardrails (persona MOVI, cancelamento sempre possível, nunca "resultado garantido").
 */
export function dunningMessage(checkoutUrl: string): string {
  return (
    'Oi! Notei que o pagamento da sua assinatura não passou desta vez. 💛 Seu acesso segue ' +
    'liberado por enquanto — quando puder, é só atualizar por aqui: ' +
    checkoutUrl +
    '\nQualquer dúvida, me chama. Você pode cancelar quando quiser, sem burocracia.'
  );
}
