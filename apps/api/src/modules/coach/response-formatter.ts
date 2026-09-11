/**
 * Formatação determinística da resposta do Coach (substituto real de `maxResponseChars`).
 *
 * ## Por que isto existe
 * `maxResponseChars` nunca foi um teto: era uma frase no system prompt ("responda em no
 * máximo N caracteres") e nenhum ponto de código a aplicava. Remover o campo sem colocar
 * nada no lugar seria regressão de custo — token de SAÍDA custa ~4x o de entrada, e a saída
 * é justamente a parte que não tinha limite nenhum.
 *
 * O bloco `FORMATO DA MENSAGEM` do prompt continua sendo a primeira barreira (é ele que faz
 * o modelo escrever em blocos curtos, o que economiza de verdade). Esta função é a segunda:
 * roda **depois** do LLM, antes de `deliver()`. Determinística, sem I/O, sem regex vinda de
 * configuração.
 *
 * ## Achado 2026-09-08 (bug reproduzido ao vivo pelo fundador) — `blockSize` NUNCA corta conteúdo
 * `blockSize` (curto/médio/livre) é uma escolha de PARTICIONAMENTO — quantos parágrafos e
 * caracteres cabem numa bolha do WhatsApp — nunca de conteúdo. A versão anterior desta
 * função tratava o teto como destrutivo: parágrafo além de `spec.paragraphs` era descartado
 * (`.slice`) e parágrafo maior que `spec.maxCharsPerParagraph` era cortado no meio da frase
 * com reticências (`truncateAtBoundary`). Nenhum aluno via a diferença entre "a IA não tinha
 * mais o que dizer" e "a resposta foi cortada" — o pedido do fundador foi explícito: o teto
 * deve reparticionar em BOLHAS a mais, nunca apagar ou reticenciar conteúdo já gerado. A
 * resposta inteira sempre chega ao aluno; `blockSize` só decide como ela é fatiada entre
 * mensagens (`BUBBLE_SEPARATOR`, o mesmo separador que `WhatsappOutboundWorker.sendBubbles`
 * já usa pra enviar uma bolha por mensagem).
 *
 * ## Ordem das operações (importa)
 * 0. travessão (—) vira vírgula primeiro (achado 2026-09-02, correção do fundador — ver
 *    `stripEmDash`), antes de qualquer outra normalização mexer no texto;
 * 1. markdown proibido some em seguida — `**x**` vira `*x*` (negrito real do WhatsApp) ou
 *    some, conforme `boldPolicy`; título/cerca de código somem sempre;
 * 2. listas são normalizadas/desmontadas conforme `allowLists`, com teto de itens (esse teto
 *    continua descartando item excedente de propósito — lista de 6+ itens é má UX de
 *    WhatsApp, natureza diferente de perder conteúdo de uma explicação em prosa);
 * 3. só então o particionamento em bolhas por parágrafo/caractere é aplicado — particionar
 *    antes faria o corte contar caractere de markup que ia ser removido.
 */
import {
  BLOCK_SIZE_SPEC,
  MAX_BOLD_SPANS,
  MAX_LIST_ITEMS,
  type AgentFormatting,
} from '@movivo/shared';

import { BUBBLE_SEPARATOR } from '../whatsapp/message-templates';

/** Marcador de item de lista aceito na saída do modelo. */
const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/u;

/** Cerca de bloco de código e título markdown — nunca renderizam no WhatsApp. */
const CODE_FENCE = /^\s*```.*$/gmu;
const HEADING = /^\s{0,3}#{1,6}\s*/gmu;

/**
 * Travessão (—, U+2014) — achado 2026-09-02, correção do fundador: a saída soava "AI slop",
 * e o travessão foi o sintoma mais citado ("NUNCA DEVE SER USADO"). O bloco `FORMATO DA
 * MENSAGEM` do prompt já pede pra nunca usar, mas prompt sozinho nunca é teto neste sistema
 * (mesma razão de `applyBoldPolicy`/`applyListPolicy` existirem) — isto é a rede de
 * segurança determinística. Vírgula é a substituição mais segura pro uso típico de travessão
 * em português (marcar um aposto/explicação no meio da frase); troca sem espaço extra dos
 * dois lados vira dois espaços, por isso o `replace` seguinte limpa isso.
 */
const EM_DASH = /\s*—\s*/gu;

/**
 * Troca travessão por vírgula — rede de segurança determinística (ver `EM_DASH`).
 * Exportada porque `WorkoutPresentationService` (2ª bolha da entrega de protocolo) também
 * gera texto livre por LLM fora do pipeline de chat do Coach, e precisa da mesma garantia
 * sem herdar particionamento em bolhas/política de lista/negrito, que não se aplicam a ela.
 */
export function stripEmDash(text: string): string {
  return text
    .replace(EM_DASH, ', ')
    .replace(/,\s*([,.!?…])/gu, '$1') // travessão colado em outra pontuação não vira ", ,"/", ."
    .replace(/^,\s*/gmu, ''); // travessão no início da frase/linha não vira ", Texto"
}

/** Fim de frase reconhecido (ponto/exclamação/interrogação/reticências + espaço ou fim). */
const SENTENCE_BOUNDARY = /[^.!?…]+[.!?…]+(?:\s+|$)|[^.!?…]+$/gu;

/**
 * Achado 2026-09-08 (bug reproduzido ao vivo pelo fundador): substitui o antigo
 * `truncateAtBoundary` — que cortava com reticências e DESCARTAVA o resto do texto. Esta
 * função faz o mesmo trabalho de caber em `limit` caracteres, mas NUNCA perde conteúdo:
 * quebra em `limit`, preferindo fim de frase (sem frase, fim de palavra), e devolve o
 * restante como um chunk seguinte — que vira a PRÓXIMA bolha, não um corte com "…".
 */
function splitIntoBubbleChunks(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const sentences = (text.match(SENTENCE_BOUNDARY) ?? [text]).map((s) => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > limit && current) {
      chunks.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
    // Uma única frase maior que `limit` sozinha: quebra em fim de palavra — ainda sem perda,
    // só reparticiona (acontece raramente; frase técnica muito longa sem pontuação interna).
    while (current.length > limit) {
      const head = current.slice(0, limit);
      const word = head.lastIndexOf(' ');
      const boundary = word > limit * 0.6 ? word : limit;
      chunks.push(current.slice(0, boundary).trim());
      current = current.slice(boundary).trim();
    }
  }
  if (current) chunks.push(current);
  return chunks;
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
 * Aplica a formatação publicada e particiona em bolhas por `blockSize`. Devolve sempre uma
 * string não vazia: se o texto ficar vazio depois da normalização (só markup, por exemplo),
 * o original é devolvido — formatação nunca pode transformar uma resposta em silêncio.
 *
 * Achado 2026-09-08: NUNCA descarta parágrafo nem corta frase no meio. O que passa do teto
 * de `spec.paragraphs`/`spec.maxCharsPerParagraph` vira a BOLHA seguinte (`BUBBLE_SEPARATOR`)
 * — o worker de WhatsApp (`sendBubbles`) já envia cada bolha como mensagem separada.
 */
export function applyResponseFormatting(text: string, formatting: AgentFormatting): string {
  const spec = BLOCK_SIZE_SPEC[formatting.blockSize];

  const normalized = applyListPolicy(
    applyBoldPolicy(stripEmDash(text), formatting.boldPolicy),
    formatting.allowLists,
  )
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

  const paragraphs = normalized
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  // Parágrafo maior que uma bolha vira múltiplos chunks; nenhum é descartado.
  const chunks = paragraphs.flatMap((paragraph) =>
    splitIntoBubbleChunks(paragraph, spec.maxCharsPerParagraph),
  );

  // Agrupa os chunks em bolhas de até `spec.paragraphs` cada — a mesma "quantidade de
  // parágrafos por bolha" de antes, só que sobra vira PRÓXIMA bolha, não é apagada.
  const bubbles: string[] = [];
  for (let i = 0; i < chunks.length; i += spec.paragraphs) {
    bubbles.push(chunks.slice(i, i + spec.paragraphs).join('\n\n'));
  }

  const result = bubbles.join(BUBBLE_SEPARATOR).trim();
  return result || text.trim();
}
