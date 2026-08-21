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
