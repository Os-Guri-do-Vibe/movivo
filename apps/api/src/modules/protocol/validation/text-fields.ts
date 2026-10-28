/**
 * Regras de linguagem de texto livre do protocolo legado: identifica se um código de violação
 * é de linguagem/compliance (inclui vazamento de prompt). Sai junto do módulo de protocolo.
 */
import { LANGUAGE_RULES } from './validation-rules';

export const PROMPT_LEAK_RULE = 'PROMPT_LEAK';

/** `true` se a regra é de linguagem/compliance de texto livre (inclui vazamento de prompt). */
export function isLanguageRule(rule: string): boolean {
  return rule === PROMPT_LEAK_RULE || LANGUAGE_RULES.some((r) => r.id === rule);
}
