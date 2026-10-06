/**
 * Guardrail de regra de produto (achado 2026-09-09, correção do fundador): o Agente IA
 * Coach do WhatsApp nunca usa travessão "—" em nenhuma mensagem, nem nas fixas/
 * determinísticas de dunning e conversão de trial como estas. Mesmo achado, segunda regra:
 * a cor de marca é verde (Verde Pulso) — todo coração usado tem que ser 💚 (achado ao vivo:
 * `dunningMessage`/`winbackMessage` saíam com 💛).
 */
import { describe, expect, it } from 'vitest';

import {
  dunningMessage,
  paymentConfirmationMessage,
  planEndedMessage,
  trialEndedMessage,
  winbackMessage,
} from './subscription-messages';

const ALL_MESSAGES = [
  dunningMessage('https://pay.example/checkout/abc'),
  paymentConfirmationMessage(),
  trialEndedMessage('Ana', 'https://movivo.test/checkout/abc', 'https://movivo.test/cancelar/abc'),
  planEndedMessage(
    'Ana',
    'Mensal',
    'https://movivo.test/checkout/abc',
    'https://movivo.test/cancelar/abc',
  ),
  winbackMessage('https://pay.example/checkout/abc'),
];

/** Ver `coach-messages.spec.ts` para a explicação de por que é uma lista, não um range. */
const NON_GREEN_HEART =
  /[\u{2764}\u{1F493}\u{1F495}\u{1F496}\u{1F497}\u{1F498}\u{1F499}\u{1F49B}\u{1F49C}\u{1F49D}\u{1F49E}\u{1F49F}\u{1F5A4}\u{1F90D}\u{1F90E}\u{1F9E1}]/u;

describe('copy de assinatura (dunning e conversão de trial)', () => {
  it('nenhuma mensagem usa travessão (—)', () => {
    for (const text of ALL_MESSAGES) expect(text).not.toContain('—');
  });

  it('todo coração usado é verde (💚), nunca outra cor', () => {
    for (const text of ALL_MESSAGES) expect(text).not.toMatch(NON_GREEN_HEART);
  });
});

describe('mensagens de fim de teste e de fim de plano', () => {
  const checkout = 'https://movivo.test/checkout/XcTJFfnN';
  const cancel = 'https://movivo.test/cancelar/XcTJFfnN';

  it('fim dos 7 dias gratuitos: nome em negrito e os dois links curtos, cada um em linha própria', () => {
    expect(trialEndedMessage('Ana', checkout, cancel)).toBe(
      '*Ana*, seus 7 dias gratuitos com a MOVIVO chegaram ao fim. 💚\n\n' +
        'Para continuar com o acompanhamento MOVIVO, é só ativar sua assinatura:\n' +
        `${checkout}\n\n` +
        'Você pode cancelar quando quiser, sem burocracia:\n' +
        `${cancel}\n\n` +
        'Continue se movendo. 👊🏼',
    );
  });

  it('fim do plano: nome e plano em negrito, e o convite é para renovar', () => {
    expect(planEndedMessage('Ana', 'Trimestral', checkout, cancel)).toBe(
      '*Ana*, seu plano *trimestral* MOVIVO chegou ao fim. 💚\n\n' +
        'Para continuar com o acompanhamento MOVIVO, é só renovar sua assinatura:\n' +
        `${checkout}\n\n` +
        'Você pode cancelar quando quiser, sem burocracia:\n' +
        `${cancel}\n\n` +
        'Continue se movendo. 👊🏼',
    );
  });

  it('neutraliza marcadores de formatação no nome', () => {
    expect(trialEndedMessage('A*na_', checkout, cancel)).toMatch(/^\*Ana\*, seus 7 dias/);
  });
});
