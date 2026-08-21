/**
 * Teto determinístico de formatação da resposta do Coach (substituto real de `maxResponseChars`).
 *
 * ## Por que isto existe
 * `maxResponseChars` nunca foi um teto: era uma frase no system prompt ("responda em no
 * máximo N caracteres") e nenhum ponto de código a aplicava. Remover o campo sem colocar
 * nada no lugar seria regressão de custo — token de SAÍDA custa ~4x o de entrada, e a saída
 * é justamente a parte que não tinha limite nenhum.
 *
 * O bloco `FORMATO DA MENSAGEM` do prompt continua sendo a primeira barreira (é ele que faz
 * o modelo escrever curto, que é o que economiza de verdade). Esta função é a segunda: roda
 * **depois** do LLM, antes de `deliver()`, e é o que garante o teto quando o modelo ignora a
 * instrução. Determinística, sem I/O, sem regex vinda de configuração.
 *
 * ## Ordem das operações (importa)
 * 1. markdown proibido some primeiro — `**x**` vira `*x*` (negrito real do WhatsApp) ou some,
 *    conforme `boldPolicy`; título/cerca de código somem sempre;
 * 2. listas são normalizadas/desmontadas conforme `allowLists`, com teto de itens;
 * 3. só então o teto de parágrafos/caracteres é aplicado — cortar antes faria o corte contar
 *    caractere de markup que ia ser removido.
 */
import {
  BLOCK_SIZE_SPEC,
  MAX_BOLD_SPANS,
  MAX_LIST_ITEMS,
  type AgentFormatting,
} from '@movivo/shared';

/** Marcador de item de lista aceito na saída do modelo. */
const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/u;

/** Cerca de bloco de código e título markdown — nunca renderizam no WhatsApp. */
const CODE_FENCE = /^\s*```.*$/gmu;
const HEADING = /^\s{0,3}#{1,6}\s*/gmu;

/**
 * Corta em `limit` caracteres preferindo o fim de frase; sem frase, o fim de palavra.
 * Nunca corta no meio de uma palavra: o aluno lê a mensagem, não o teto.
 */
export function truncateAtBoundary(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  // Só aceita o corte por frase se ele preservar pelo menos 60% do teto — abaixo disso o
  // corte por frase devolveria um pedaço curto demais para ser útil.
  if (sentence > limit * 0.6) return head.slice(0, sentence + 1).trim();
  const word = head.lastIndexOf(' ');
  return `${(word > 0 ? head.slice(0, word) : head).trim()}…`;
}

/** Normaliza o markup de destaque conforme a política publicada. */
function applyBoldPolicy(text: string, policy: AgentFormatting['boldPolicy']): string {
  // `**x**` (markdown) aparece literal na tela do WhatsApp; `*x*` é o negrito real.
  let out = text
    .replace(CODE_FENCE, '')
    .replace(HEADING, '')
    .replace(/\*\*(.+?)\*\*/gsu, '*$1*')
    .replace(/__(.+?)__/gsu, '$1')
    .replace(/~~(.+?)~~/gsu, '$1');

  const allowed = MAX_BOLD_SPANS[policy];
  let kept = 0;
  out = out.replace(/\*([^*\n]+)\*/gu, (_match, inner: string) => {
    kept += 1;
    return kept <= allowed ? `*${inner}*` : inner;
  });
  return out;
}

/** Aplica a política de listas: teto de itens, ou desmonte completo em frases corridas. */
function applyListPolicy(text: string, allowLists: boolean): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let itemsInMessage = 0;

  for (const line of lines) {
    if (!LIST_ITEM.test(line)) {
      out.push(line);
      continue;
    }
    const content = line.replace(LIST_ITEM, '').trim();
    if (!allowLists) {
      // Sem lista: o item vira uma frase. Preserva o conteúdo em vez de descartá-lo — o
      // aluno perderia informação por uma escolha de formatação.
      if (content) out.push(/[.!?…]$/u.test(content) ? content : `${content}.`);
      continue;
    }
    itemsInMessage += 1;
    if (itemsInMessage <= MAX_LIST_ITEMS && content) out.push(`- ${content}`);
  }
  return out.join('\n');
}

/**
 * Aplica o teto de formatação publicado. Devolve sempre uma string não vazia: se o texto
 * ficar vazio depois da normalização (só markup, por exemplo), o original é devolvido — um
 * teto de custo nunca pode transformar uma resposta em silêncio.
 */
export function applyResponseFormatting(text: string, formatting: AgentFormatting): string {
  const spec = BLOCK_SIZE_SPEC[formatting.blockSize];

  const normalized = applyListPolicy(
    applyBoldPolicy(text, formatting.boldPolicy),
    formatting.allowLists,
  )
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

  const paragraphs = normalized
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, spec.paragraphs)
    .map((paragraph) => truncateAtBoundary(paragraph, spec.maxCharsPerParagraph));

  const result = paragraphs.join('\n\n').trim();
  return result || text.trim();
}
