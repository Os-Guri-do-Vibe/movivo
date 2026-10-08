/**
 * Normalização compartilhada dos comparadores determinísticos de texto (L1 e temas proibidos).
 *
 * ## Por que a versão anterior não bastava
 * O `normalize()` que vivia dentro de `l1-guardrail.service.ts` fazia NFD + remoção de
 * acento + lowercase, e comparava por **substring crua**. Isso tem duas falhas conhecidas
 * (achados do Sato), e a segunda passou a ser inaceitável quando o resultado do match deixou
 * de ser "sinalizar" e virou "bloquear":
 *
 *  1. **Evasão por Unicode.** Sem NFKC, variantes de largura/compatibilidade (`ｄｏｒ`) não
 *     colapsam para a forma canônica. Sem remover zero-width (`U+200B–U+200D`, `U+FEFF`,
 *     `U+2060`) e o Tag Block (`U+E0000–U+E007F`), basta intercalar um caractere invisível
 *     entre duas letras para o termo deixar de casar — sem mudar nada na tela do aluno.
 *  2. **Substring crua.** `"dor"` casa dentro de `"dormi"` e `"adorei"`. Tolerável quando a
 *     ação era só FLAG; inaceitável quando bloqueia a resposta.
 *
 * A normalização aqui reduz o texto a tokens alfanuméricos separados por espaço único, e o
 * match compara com espaço nas duas pontas — o que dá **limite de palavra** de graça,
 * inclusive para termos de várias palavras.
 */

/** Zero-width e joiners usados para quebrar match sem alterar o texto renderizado. */
const INVISIBLE = /[\u200B-\u200D\uFEFF\u2060\u00AD]/gu;

/** Unicode Tag Block — invisível em qualquer cliente, popular em evasão de filtro. */
const TAG_BLOCK = /[\u{E0000}-\u{E007F}]/gu;

/** Marcas de combinação (acentos), após a decomposição NFD. */
const COMBINING = /\p{M}/gu;

/** Tudo que não é letra nem dígito vira separador — pontuação não fabrica limite de palavra. */
const NON_ALNUM = /[^\p{L}\p{N}]+/gu;

/**
 * Forma canônica para comparação: minúscula, sem acento, sem invisível, tokens separados
 * por um único espaço. Nunca é usada para exibir nem para persistir — só para comparar.
 */
export function normalizeForMatch(value: string): string {
  return canonicalizeSecurityText(value)
    .normalize('NFD')
    .replace(COMBINING, '')
    .toLocaleLowerCase('pt-BR')
    .replace(NON_ALNUM, ' ')
    .trim();
}

/**
 * `true` se `term` aparece em `normalizedText` **como palavra inteira** (ou sequência
 * inteira de palavras). `normalizedText` já deve vir de `normalizeForMatch`; `term` é
 * normalizado aqui, porque vem do banco e pode ter sido gravado em qualquer forma.
 */
export function matchesTerm(normalizedText: string, term: string): boolean {
  const needle = normalizeForMatch(term);
  if (!needle) return false;
  return ` ${normalizedText} `.includes(` ${needle} `);
}

/** Comprimento mínimo de um termo normalizado aceito como gatilho de bloqueio (Sato). */
export const MIN_NORMALIZED_TERM_LENGTH = 4;

/**
 * Forma canônica preservando pontuação e acentos para detectores baseados em regex.
 * Compatibilidade e caracteres invisíveis são normalizados num ponto compartilhado.
 */
export function canonicalizeSecurityText(value: string): string {
  return value.normalize('NFKC').replace(INVISIBLE, '').replace(TAG_BLOCK, '');
}

// ---------------------------------------------------------------------------------------
// Visões "desofuscadas" para detectores de injeção/vazamento.
//
// Um regex só enxerga o texto como foi escrito. O atacante controla a forma — letras
// espaçadas, leetspeak, homóglifos cirílicos/gregos, repetição de letra, payload em base64/
// hex/percent/`\u`, texto invertido ou ROT13 — e o modelo entende todas essas formas. Em vez
// de tentar um regex por disfarce, geramos várias VISÕES canônicas do mesmo texto e rodamos os
// MESMOS padrões em cada uma. Nunca usadas para exibir nem persistir; só para comparar.
// ---------------------------------------------------------------------------------------

/** Teto de entrada examinada: limita custo e superfície de ReDoS. */
const MAX_VIEW_INPUT = 20_000;
const MAX_DECODED_PAYLOADS = 8;
const MAX_DECODE_DEPTH = 2;

/** Homóglifos cirílicos/gregos (minúsculos) → letra latina equivalente. */
const CONFUSABLES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    а: 'a',
    е: 'e',
    к: 'k',
    м: 'm',
    н: 'h',
    о: 'o',
    р: 'p',
    с: 'c',
    т: 't',
    у: 'y',
    х: 'x',
    і: 'i',
    ј: 'j',
    ѕ: 's',
    ԁ: 'd',
    ӏ: 'l',
    ѡ: 'w',
    ԛ: 'q',
    α: 'a',
    β: 'b',
    ε: 'e',
    ι: 'i',
    κ: 'k',
    ν: 'v',
    ο: 'o',
    ρ: 'p',
    τ: 't',
    υ: 'u',
    χ: 'x',
  }),
);

const LEET: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '|': 'l',
};

function foldConfusables(value: string): string {
  let out = '';
  for (const ch of value) out += CONFUSABLES.get(ch) ?? ch;
  return out;
}

/** minúscula, sem acento, sem invisível, homóglifos → latino. Preserva pontuação e espaços. */
export function foldText(value: string): string {
  const canonical = canonicalizeSecurityText(value);
  return foldConfusables(
    canonical.normalize('NFD').replace(COMBINING, '').toLocaleLowerCase('pt-BR'),
  );
}

function rot13(value: string): string {
  return value.replace(/[a-z]/gi, (ch) => {
    const base = ch <= 'Z' ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + 13) % 26) + base);
  });
}

/**
 * Junta corridas de 4+ caracteres isolados separados por um espaço só ("i g n o r e",
 * "h t t p s : / /"), mesmo no meio de um texto maior. O resto do texto fica intacto.
 */
export function despaceSpelledOut(value: string): string {
  return value.replace(/(?<!\S)(?:\S ){3,}\S(?!\S)/gu, (run) => run.replace(/ /gu, ''));
}

/** `true` se há uma corrida de 6+ tokens de um caractere ("i g n o r e") — sinal de disfarce. */
export function hasSpelledOutRun(value: string): boolean {
  return /(?:(?<![\p{L}\p{N}])[\p{L}\p{N}](?![\p{L}\p{N}])[\s._*|,;:/\\-]+){6,}/u.test(value);
}

/** Só letras e dígitos, sem separador: expõe palavras coladas por espaçamento arbitrário. */
export function squashLetters(value: string): string {
  return value.replace(/[^\p{L}\p{N}]+/gu, '');
}

function printableRatio(value: string): number {
  let printable = 0;
  let total = 0;
  for (const ch of value) {
    total++;
    const code = ch.codePointAt(0) ?? 0;
    if (
      code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 32 && code !== 127 && code !== 0xfffd)
    ) {
      printable++;
    }
  }
  return total === 0 ? 0 : printable / total;
}

function acceptDecoded(decoded: string): string | null {
  return decoded.length >= 8 && /\p{L}{3}/u.test(decoded) && printableRatio(decoded) >= 0.9
    ? decoded
    : null;
}

/** Payloads embutidos: base64/base64url, hex, percent-encoding, `\uXXXX` e `&#NNN;`. */
function decodeEmbedded(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/[A-Za-z0-9+/_-]{16,}={0,2}/gu)) {
    if (out.length >= MAX_DECODED_PAYLOADS) break;
    try {
      const normalized = match[0].replace(/-/gu, '+').replace(/_/gu, '/');
      const decoded = acceptDecoded(Buffer.from(normalized, 'base64').toString('utf8'));
      if (decoded) out.push(decoded);
    } catch {
      // token que parece base64 mas não é — ignora.
    }
  }
  for (const match of text.matchAll(/(?:\b[0-9a-f]{2}\b[\s:,-]*){10,}|\b[0-9a-f]{24,}\b/giu)) {
    if (out.length >= MAX_DECODED_PAYLOADS) break;
    const hex = match[0].replace(/[^0-9a-f]/giu, '');
    if (hex.length % 2 !== 0) continue;
    const decoded = acceptDecoded(Buffer.from(hex, 'hex').toString('utf8'));
    if (decoded) out.push(decoded);
  }
  if (/(?:%[0-9a-f]{2}){4,}/iu.test(text)) {
    try {
      const decoded = acceptDecoded(decodeURIComponent(text));
      if (decoded) out.push(decoded);
    } catch {
      // percent-encoding malformado — ignora.
    }
  }
  if (/(?:\\u[0-9a-f]{4}){3,}|(?:&#x?[0-9a-f]+;){3,}/iu.test(text)) {
    const decoded = text
      .replace(/\\u([0-9a-f]{4})/giu, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(x?)([0-9a-f]+);/giu, (_m, x: string, num: string) => {
        const code = parseInt(num, x ? 16 : 10);
        return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
      });
    if (decoded !== text) out.push(decoded);
  }
  return out;
}

/**
 * Todas as visões do texto para detecção: original canônico, dobrado (sem acento/homóglifo),
 * sem letra repetida, leetspeak, sem espaçamento, invertido, ROT13 e cada payload decodificado
 * (até 2 níveis, com as mesmas visões). O primeiro item é sempre o canônico original; a
 * visão dobrada pode ter sido deduplicada, então use `foldText` quando precisar dela.
 */
export function deobfuscatedViews(text: string, depth = 0): string[] {
  const input = text.slice(0, MAX_VIEW_INPUT);
  const canonical = canonicalizeSecurityText(input);
  const folded = foldText(input);
  const views = new Set<string>([canonical, folded]);
  views.add(folded.replace(/(\p{L})\1{2,}/gu, '$1'));
  views.add(folded.replace(/[01345@$7|]/gu, (ch) => LEET[ch] ?? ch));
  views.add(despaceSpelledOut(folded));
  views.add([...folded].reverse().join(''));
  views.add(rot13(folded));
  if (depth < MAX_DECODE_DEPTH) {
    for (const payload of decodeEmbedded(canonical)) {
      for (const view of deobfuscatedViews(payload, depth + 1)) views.add(view);
    }
  }
  return [...views];
}

/** Desfaz "defang" de URL/e-mail ("exemplo[.]com", "exemplo ponto com", "hxxp", "(at)"). */
export function refang(value: string): string {
  return value
    .replace(/hxxp/giu, 'http')
    .replace(/\s*[[(]\s*\.\s*[\])]\s*/gu, '.')
    .replace(/\s+(?:dot|ponto)\s+/giu, '.')
    .replace(/\s*[[(]\s*(?:at|arroba)\s*[\])]\s*/giu, '@')
    .replace(/\s*:\s*\/\s*\/\s*/gu, '://');
}
