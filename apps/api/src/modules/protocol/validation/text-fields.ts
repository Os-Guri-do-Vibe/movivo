/**
 * Campos de texto livre de um `ProtocolStructure`, com o caminho de cada um — os MESMOS
 * campos que `ValidationService.checkLanguage` varre (`collectText`). Existe para o
 * feedback de correção e o reparo determinístico LOCALIZAREM uma violação de linguagem
 * (qual campo casou) sem reimplementar as regras: o casamento reusa `LANGUAGE_RULES` e
 * `containsPromptLeak`, as mesmas fontes do validador.
 *
 * Nunca devolve o texto para fora de quem chamou — o feedback só usa o `path`.
 */
import type { ProtocolStructure } from '@movivo/shared';

import { canonicalizeSecurityText } from '../../../core/agent-config/text-normalize';
import { containsPromptLeak } from './prompt-injection';
import { LANGUAGE_RULES } from './validation-rules';

export type ProtocolTextFieldKind = 'generalNotes' | 'dayLabel' | 'focus' | 'name' | 'notes';

export interface ProtocolTextField {
  /** Ex.: `sessions[1].exercises[2].notes`. */
  path: string;
  kind: ProtocolTextFieldKind;
  text: string;
}

export const PROMPT_LEAK_RULE = 'PROMPT_LEAK';

/** `true` se a regra é de linguagem/compliance de texto livre (inclui vazamento de prompt). */
export function isLanguageRule(rule: string): boolean {
  return rule === PROMPT_LEAK_RULE || LANGUAGE_RULES.some((r) => r.id === rule);
}

/** `true` se `text` dispara a regra de linguagem `rule` — mesma forma canônica do validador. */
export function languageRuleMatches(rule: string, text: string): boolean {
  if (!text) return false;
  const canonical = canonicalizeSecurityText(text);
  if (rule === PROMPT_LEAK_RULE) return containsPromptLeak(canonical);
  return LANGUAGE_RULES.some((r) => r.id === rule && r.pattern.test(canonical));
}

export function protocolTextFields(structure: ProtocolStructure): ProtocolTextField[] {
  const fields: ProtocolTextField[] = [
    { path: 'generalNotes', kind: 'generalNotes', text: structure.generalNotes ?? '' },
  ];
  structure.sessions.forEach((session, sessionIndex) => {
    fields.push(
      { path: `sessions[${sessionIndex}].dayLabel`, kind: 'dayLabel', text: session.dayLabel },
      { path: `sessions[${sessionIndex}].focus`, kind: 'focus', text: session.focus },
    );
    session.exercises.forEach((exercise, exerciseIndex) => {
      const base = `sessions[${sessionIndex}].exercises[${exerciseIndex}]`;
      fields.push(
        { path: `${base}.name`, kind: 'name', text: exercise.name },
        { path: `${base}.notes`, kind: 'notes', text: exercise.notes ?? '' },
      );
    });
  });
  return fields;
}
