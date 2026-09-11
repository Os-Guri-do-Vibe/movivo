/**
 * Guardrail de regra de produto (achado 2026-09-09, correção do fundador): o Agente IA
 * Coach do WhatsApp nunca usa travessão "—" em nenhuma mensagem, nem nas fixas/
 * determinísticas como estas (que não passam pelo `stripEmDash` de `response-formatter.ts`,
 * reservado à saída LIVRE do LLM). Achado ao vivo: `SUBSTITUTION_NOT_SAFE_TO_APPLY_MESSAGE`
 * chegou a sair com travessão pro fundador em teste.
 *
 * Mesmo achado, segunda regra: a cor de marca da MOVIVO é verde (Verde Pulso) — todo
 * coração usado em copy tem que ser 💚, nunca outra cor (achado ao vivo:
 * `SUBSTITUTION_CATALOG_GAP_MESSAGE` saiu com 💙).
 */
import { describe, expect, it } from 'vitest';

import {
  DAILY_LIMIT_MESSAGE,
  DLQ_FALLBACK_MESSAGE,
  FORBIDDEN_TOPIC_RESPONSE,
  SAFETY_HANDOFF_MESSAGE,
  STANDARD_BLOCK_RESPONSE,
  SUBSTITUTION_ALREADY_PENDING_MESSAGE,
  SUBSTITUTION_CATALOG_GAP_MESSAGE,
  SUBSTITUTION_DISCARDED_MESSAGE,
  SUBSTITUTION_FALLBACK_MESSAGE,
  SUBSTITUTION_NOT_SAFE_TO_APPLY_MESSAGE,
  TECHNICAL_NO_EVIDENCE_MESSAGE,
} from './coach-messages';

const ALL_MESSAGES = [
  DAILY_LIMIT_MESSAGE,
  STANDARD_BLOCK_RESPONSE,
  FORBIDDEN_TOPIC_RESPONSE,
  TECHNICAL_NO_EVIDENCE_MESSAGE,
  SUBSTITUTION_FALLBACK_MESSAGE,
  SUBSTITUTION_ALREADY_PENDING_MESSAGE,
  SUBSTITUTION_CATALOG_GAP_MESSAGE,
  SUBSTITUTION_NOT_SAFE_TO_APPLY_MESSAGE,
  SUBSTITUTION_DISCARDED_MESSAGE,
  DLQ_FALLBACK_MESSAGE,
  SAFETY_HANDOFF_MESSAGE,
];

/**
 * Qualquer coração que não seja verde (Verde Pulso, cor da marca) — lista explícita de
 * codepoints, nunca um range: `💚` (U+1F49A, verde) fica ENTRE `💙`/`💛`/`💜`/`💞`/`💟` na
 * tabela Unicode, então um range ali dentro pegaria o próprio coração verde como "errado".
 */
const NON_GREEN_HEART =
  /[\u{2764}\u{1F493}\u{1F495}\u{1F496}\u{1F497}\u{1F498}\u{1F499}\u{1F49B}\u{1F49C}\u{1F49D}\u{1F49E}\u{1F49F}\u{1F5A4}\u{1F90D}\u{1F90E}\u{1F9E1}]/u;

describe('respostas pré-aprovadas do Coach', () => {
  it('nenhuma mensagem fixa usa travessão (—)', () => {
    for (const text of ALL_MESSAGES) expect(text).not.toContain('—');
  });

  it('todo coração usado é verde (💚), nunca outra cor', () => {
    for (const text of ALL_MESSAGES) expect(text).not.toMatch(NON_GREEN_HEART);
  });

  it('sanidade do regex: 💚 (verde) não é sinalizado como coração de outra cor', () => {
    expect('💚').not.toMatch(NON_GREEN_HEART);
    expect('💙').toMatch(NON_GREEN_HEART);
  });
});
