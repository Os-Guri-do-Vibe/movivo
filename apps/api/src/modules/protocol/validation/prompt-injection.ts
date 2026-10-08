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
import {
  canonicalizeSecurityText,
  deobfuscatedViews,
  foldText,
  hasSpelledOutRun,
  squashLetters,
} from '../../../core/agent-config/text-normalize';
import {
  INJECTION_PATTERNS,
  SQUASHED_INJECTION_PATTERNS,
  SYSTEM_PROMPT_SENTINELS,
} from './validation-rules';

const OPEN = '<mensagem_usuario>';
const CLOSE = '</mensagem_usuario>';

/**
 * `true` se o texto contém um padrão de injeção conhecido, na forma escrita OU em qualquer
 * disfarce comum (acento/homóglifo, leetspeak, letra repetida, soletrado, invertido, ROT13,
 * payload em base64/hex/percent/`\u`). Continua sendo heurística — sinal e neutralização, não
 * barreira: a garantia de segurança é estrutural (envelope, sem ferramentas, validação de saída).
 */
export function detectInjection(text: string): boolean {
  const views = deobfuscatedViews(text);
  if (views.some((view) => INJECTION_PATTERNS.some((re) => re.test(view)))) return true;
  const folded = foldText(text);
  if (!hasSpelledOutRun(folded)) return false;
  const squashed = squashLetters(folded);
  return SQUASHED_INJECTION_PATTERNS.some((re) => re.test(squashed));
}

/** `true` se o padrão aparece já na forma escrita (sem precisar de desofuscação). */
function matchesAsWritten(text: string): boolean {
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
  // Injeção só visível depois de desofuscar (soletrada, codificada, homóglifos…): não dá para
  // localizar o trecho no texto original, então a mensagem inteira é marcada de forma visível.
  if (!matchesAsWritten(text) && detectInjection(text)) {
    out = `[conteúdo suspeito de instrução ofuscada] ${out}`;
  }
  return out;
}

/** Embrulha o dado do usuário no delimitador, já neutralizado. */
export function wrapUserMessage(text: string): string {
  return `${OPEN}\n${neutralizeUserInput(text)}\n${CLOSE}`;
}

/**
 * `true` se a SAÍDA contém uma sentinela do system prompt (vazamento) — inclusive soletrada,
 * invertida, em ROT13 ou codificada, formas que um modelo induzido a "esconder" o prompt usa.
 */
export function containsPromptLeak(text: string): boolean {
  const views = deobfuscatedViews(text);
  const asWritten = canonicalizeSecurityText(text).toLocaleLowerCase('pt-BR');
  if (
    SYSTEM_PROMPT_SENTINELS.some((sentinel) =>
      asWritten.includes(canonicalizeSecurityText(sentinel).toLocaleLowerCase('pt-BR')),
    )
  ) {
    return true;
  }
  const foldedSentinels = SYSTEM_PROMPT_SENTINELS.map((sentinel) => foldText(sentinel));
  if (views.some((view) => foldedSentinels.some((sentinel) => view.includes(sentinel)))) {
    return true;
  }
  const folded = foldText(text);
  if (!hasSpelledOutRun(folded)) return false;
  const squashed = squashLetters(folded);
  return foldedSentinels.some((sentinel) => squashed.includes(squashLetters(sentinel)));
}

/**
 * Texto de origem NÃO confiável (nome de exercício salvo no protocolo, resumo gerado por
 * modelo) que precisa ser interpolado no SYSTEM prompt — onde ele ganharia o privilégio de
 * instrução. Achata quebras de linha e aspas, limita o tamanho e devolve `null` quando casa
 * padrão de injeção ou vaza o prompt; quem chama troca por uma formulação genérica.
 */
export function safePromptFact(text: string, maxLength = 120): string | null {
  const flat = canonicalizeSecurityText(text)
    .replace(/[\r\n"“”]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength);
  if (!flat || detectInjection(flat) || containsPromptLeak(flat)) return null;
  return flat;
}
