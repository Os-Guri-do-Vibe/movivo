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

/**
 * Sequência de nurturing de conversão do trial (US-4.3), dias 7/10/13/14 (Lucas §Épico 5).
 * ⚠️ Copy a aprovar (Helena/Sofia/Alexandre). Persona MOVI, dentro dos guardrails: garantia de
 * cancelamento visível, respaldo CREF, **nunca** "resultado garantido"/diagnóstico/tratamento.
 */
export type ConversionTouchpoint = 'day7' | 'day10' | 'day13' | 'day14';

export function conversionMessage(touchpoint: ConversionTouchpoint, checkoutUrl: string): string {
  switch (touchpoint) {
    case 'day7':
      return (
        'Uma semana treinando com a gente — você está mandando muito bem! 💪 Pra continuar com ' +
        'seu plano montado sob a metodologia do profissional CREF, dá uma olhada nas opções de ' +
        'assinatura quando quiser. Sem compromisso: cancela quando quiser.'
      );
    case 'day10':
      return (
        '10 dias de treino! Já dá pra sentir a diferença de ter um plano feito pra você. ⏳ ' +
        'Faltam poucos dias do seu período de experiência — se quiser seguir, tô por aqui pra ajudar.'
      );
    case 'day13':
      return (
        'Seu período de experiência está acabando. Pra não perder seu plano e o acompanhamento, ' +
        'é só assinar por aqui: ' +
        checkoutUrl +
        '\nVocê tem 7 dias de garantia e pode cancelar quando quiser, sem burocracia.'
      );
    case 'day14':
      return (
        'Último dia do seu período de experiência! 🙌 Se quiser continuar evoluindo com seu ' +
        'plano e a MOVI, é só garantir sua assinatura: ' +
        checkoutUrl +
        '\nCancelamento fácil, quando você quiser.'
      );
  }
}
