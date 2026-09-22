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
 * Sequência de nurturing de conversão do trial (US-4.3), dias 7/10/13/14 (Lucas §Épico 5).
 * ⚠️ Copy a aprovar (Helena/Sofia/Alexandre). Persona MOVI, dentro dos guardrails: garantia de
 * cancelamento visível, respaldo CREF, **nunca** "resultado garantido"/diagnóstico/tratamento.
 */
export type ConversionTouchpoint = 'day7' | 'day10' | 'day13' | 'day14' | 'winback';

export function conversionMessage(
  touchpoint: ConversionTouchpoint,
  checkoutUrl: string,
  agentName: string,
): string {
  switch (touchpoint) {
    case 'day7':
      return (
        'Seus 7 dias gratuitos terminaram. Para continuar com a assessoria de treino MOVIVO, ' +
        'supervisionada por profissional CREF, assine o plano que você escolheu aqui: ' +
        checkoutUrl +
        '\nVocê pode cancelar quando quiser, sem burocracia.'
      );
    case 'day10':
      return (
        'Seu período gratuito terminou, mas seu plano escolhido continua disponível. ' +
        'Se quiser seguir com a assessoria MOVIVO, é só assinar por aqui: ' +
        checkoutUrl +
        '\nVocê pode cancelar quando quiser.'
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
        `Se quiser retomar seus treinos com a ${agentName}, seu plano escolhido está aqui: ` +
        checkoutUrl +
        '\nA assessoria é supervisionada por profissional CREF e você pode cancelar quando quiser.'
      );
    case 'winback':
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
}
