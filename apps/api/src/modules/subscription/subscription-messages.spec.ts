/**
 * Guardrail de regra de produto (achado 2026-09-09, correção do fundador): o Agente IA
 * Coach do WhatsApp nunca usa travessão "—" em nenhuma mensagem, nem nas fixas/
 * determinísticas de dunning e conversão de trial como estas. Mesmo achado, segunda regra:
 * a cor de marca é verde (Verde Pulso) — todo coração usado tem que ser 💚 (achado ao vivo:
 * `dunningMessage`/`conversionMessage('winback', ...)` saíam com 💛).
 */
import { describe, expect, it } from 'vitest';

import {
  conversionMessage,
  dunningMessage,
  paymentConfirmationMessage,
  type ConversionTouchpoint,
} from './subscription-messages';

const TOUCHPOINTS: ConversionTouchpoint[] = ['day7', 'day10', 'day13', 'day14', 'winback'];

const ALL_MESSAGES = [
  dunningMessage('https://pay.example/checkout/abc'),
  paymentConfirmationMessage(),
  ...TOUCHPOINTS.map((touchpoint) =>
    conversionMessage(touchpoint, 'https://pay.example/checkout/abc', 'ATLAS'),
  ),
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
