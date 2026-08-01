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
export type ConversionTouchpoint = 'day7' | 'day10' | 'day13' | 'day14' | 'winback';

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
      // US-4.4 — downgrade: no último dia, oferece o plano mais barato (Mensal R$39) como
      // último recurso antes de perder o usuário. Mesmo produto, período mais curto/barato.
      return (
        'Último dia do seu período de experiência! 🙌 Se o valor pesou, o plano Mensal sai por ' +
        'R$39 — o jeito mais leve de continuar com seu plano e a MOVI: ' +
        checkoutUrl +
        '\nSem fidelidade: você cancela quando quiser.'
      );
    case 'winback':
      // US-4.4 — win-back 3 dias pós-trial, SEM julgamento (Peak-End/Sofia): pergunta o motivo
      // e deixa a porta aberta com o plano mais barato. Sem dark pattern, saída digna.
      return (
        'Vi que seu período de experiência terminou e você decidiu não seguir agora — tudo bem, ' +
        'sem pressão! 🙏 Só pra eu melhorar: o que faltou pra fazer sentido? (preço, tempo, ' +
        'resultado...) Se quiser voltar, o plano Mensal é R$39 e você entra quando quiser: ' +
        checkoutUrl +
        '\nDe qualquer forma, obrigada por treinar com a gente. 💛'
      );
  }
}
