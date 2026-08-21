/**
 * Defesa contra prompt injection (US-2.3 / TASK-2.3.4 — implementação real do baseline da US-1.8).
 *
 * Três camadas, todas determinísticas e sem I/O:
 *  1. **Delimitação estrutural**: dado do usuário vai dentro de `<mensagem_usuario>…</…>`,
 *     marcando-o como DADO, nunca instrução (Victor §7.1). O texto não pode forjar o
 *     fechamento da tag.
 *  2. **Heurística de injeção**: detecta padrões conhecidos ("ignore as instruções",
 *     "você agora é", "revele o prompt", "dados de outro usuário") e os neutraliza —
 *     sinaliza sem bloquear silenciosamente.
 *  3. **Anti-leak de saída**: a resposta não pode conter o system prompt.
 *
 * A GARANTIA de que a instrução embutida não vira comando é estrutural (delimitador +
 * neutralização), não confiança no LLM.
 */
import { canonicalizeSecurityText } from '../../../core/agent-config/text-normalize';
import { INJECTION_PATTERNS, SYSTEM_PROMPT_SENTINELS } from './validation-rules';

const OPEN = '<mensagem_usuario>';
const CLOSE = '</mensagem_usuario>';

/** `true` se o texto contém um padrão de injeção conhecido. */
export function detectInjection(text: string): boolean {
  const canonical = canonicalizeSecurityText(text);
  return INJECTION_PATTERNS.some((re) => re.test(canonical));
}

/**
 * Neutraliza dado do usuário para injeção segura no prompt: remove qualquer tentativa de
 * fechar/abrir o delimitador e sanitiza padrões de injeção conhecidos (substitui por um
 * marcador visível — nunca apaga em silêncio, para o comportamento não mudar às escondidas).
 */
export function neutralizeUserInput(text: string): string {
  let out = canonicalizeSecurityText(text).replace(/<\/?mensagem_usuario>/gi, '[removido]');
  for (const re of INJECTION_PATTERNS) {
    // INJECTION_PATTERNS são `i` (sem `g`); adicionamos `g` para trocar todas as ocorrências.
    const global = new RegExp(re.source, `${re.flags}g`);
    out = out.replace(global, (m) => `[instrução ignorada: ${m.slice(0, 20)}]`);
  }
  return out;
}

/** Embrulha o dado do usuário no delimitador, já neutralizado. */
export function wrapUserMessage(text: string): string {
  return `${OPEN}\n${neutralizeUserInput(text)}\n${CLOSE}`;
}

/** `true` se a SAÍDA contém uma sentinela do system prompt (vazamento). */
export function containsPromptLeak(text: string): boolean {
  const canonical = canonicalizeSecurityText(text).toLocaleLowerCase('pt-BR');
  return SYSTEM_PROMPT_SENTINELS.some((sentinel) =>
    canonical.includes(canonicalizeSecurityText(sentinel).toLocaleLowerCase('pt-BR')),
  );
}
