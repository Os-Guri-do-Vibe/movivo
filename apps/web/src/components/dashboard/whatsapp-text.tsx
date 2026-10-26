import { createElement, type ReactNode } from 'react';

/**
 * Renderiza o texto de uma mensagem com a MESMA formatação do WhatsApp, para o painel mostrar
 * o que o aluno vê no celular: *negrito*, _itálico_, ~riscado~, `mono`, ```bloco```, listas
 * ("- item", "* item", "1. item"), citação ("> texto") e links.
 *
 * Gera elementos React (nunca HTML em string): o texto do aluno é conteúdo não confiável e
 * nenhum caractere dele vira marcação além dos marcadores acima. Só links http/https viram `<a>`.
 *
 * Regras de marcador, como no WhatsApp: o de abertura não pode vir colado numa letra/número
 * (`snake_case_nome` não vira itálico), o conteúdo não começa nem termina em espaço, o de
 * fechamento não pode ser seguido de letra/número, e a formatação não atravessa quebra de linha.
 */

const TAGS = { '*': 'strong', _: 'em', '~': 's', '`': 'code' } as const;
type Marker = keyof typeof TAGS;

const isMarker = (char: string): char is Marker => char in TAGS;
const isWord = (char: string) => /[\p{L}\p{N}]/u.test(char);
const isSpace = (char: string) => /\s/.test(char);

const URL_AT_START = /^https?:\/\/[^\s<>]+/i;
/** Pontuação que costuma encerrar a frase, não o link. */
const URL_TRAILING = /[.,;:!?)\]}'"]+$/;

/** Posição do marcador que fecha o aberto em `open`, ou -1 se não houver um válido. */
function findClose(text: string, open: number, marker: Marker): number {
  const first = text[open + 1] ?? '';
  if (!first || isSpace(first) || first === marker) return -1;
  for (let j = open + 2; j < text.length; j += 1) {
    if (text[j] !== marker || isSpace(text[j - 1] ?? '')) continue;
    if (!isWord(text[j + 1] ?? '')) return j;
  }
  return -1;
}

function parseInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) out.push(buffer);
    buffer = '';
  };
  let i = 0;
  while (i < text.length) {
    const char = text[i] as string;
    const boundary = !isWord(text[i - 1] ?? '');
    if ((char === 'h' || char === 'H') && boundary) {
      const match = URL_AT_START.exec(text.slice(i));
      const url = match?.[0].replace(URL_TRAILING, '');
      if (url) {
        flush();
        out.push(
          <a
            key={`${keyPrefix}-${i}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-700 underline underline-offset-2 dark:text-sky-400"
          >
            {url}
          </a>,
        );
        i += url.length;
        continue;
      }
    }
    if (isMarker(char) && boundary) {
      const close = findClose(text, i, char);
      if (close > 0) {
        flush();
        const inner = text.slice(i + 1, close);
        const key = `${keyPrefix}-${i}`;
        out.push(
          char === '`'
            ? createElement(
                'code',
                {
                  key,
                  className: 'rounded bg-black/10 px-1 font-mono text-[0.9em] dark:bg-white/15',
                },
                inner,
              )
            : createElement(TAGS[char], { key }, ...parseInline(inner, key)),
        );
        i = close + 1;
        continue;
      }
    }
    buffer += char;
    i += 1;
  }
  flush();
  return out;
}

type Block =
  | { kind: 'text'; lines: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[]; start: number }
  | { kind: 'code'; text: string };

const QUOTE = /^>\s?(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^(\d+)\.\s+(.*)$/;

function parseLines(text: string): Block[] {
  const blocks: Block[] = [];
  for (const line of text.split('\n')) {
    const last = blocks.at(-1);
    const quote = QUOTE.exec(line);
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (quote) {
      if (last?.kind === 'quote') last.lines.push(quote[1] as string);
      else blocks.push({ kind: 'quote', lines: [quote[1] as string] });
    } else if (bullet) {
      if (last?.kind === 'ul') last.items.push(bullet[1] as string);
      else blocks.push({ kind: 'ul', items: [bullet[1] as string] });
    } else if (numbered) {
      if (last?.kind === 'ol') last.items.push(numbered[2] as string);
      else blocks.push({ kind: 'ol', items: [numbered[2] as string], start: Number(numbered[1]) });
    } else if (last?.kind === 'text') last.lines.push(line);
    else blocks.push({ kind: 'text', lines: [line] });
  }
  return blocks;
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const fence = /```\n?([\s\S]*?)\n?```/g;
  let from = 0;
  for (const match of text.matchAll(fence)) {
    blocks.push(...parseLines(text.slice(from, match.index)));
    blocks.push({ kind: 'code', text: match[1] as string });
    from = match.index + match[0].length;
  }
  blocks.push(...parseLines(text.slice(from)));
  // Linha vazia sozinha (antes/depois de um bloco) não é conteúdo.
  return blocks.filter((b) => b.kind !== 'text' || b.lines.some((line) => line.trim()));
}

/** Uma linha por vez: a formatação do WhatsApp não atravessa quebra de linha. */
function inlineLines(lines: string[], key: string): ReactNode[] {
  return lines.flatMap((line, index) => [
    ...(index > 0 ? ['\n'] : []),
    ...parseInline(line, `${key}-${index}`),
  ]);
}

/**
 * Blocos de texto formatado. Devolve um fragmento (os blocos entram direto no balão), com o
 * texto comum em `<p>` e `whitespace-pre-wrap` para preservar as quebras de linha.
 */
export function WhatsappText({ text }: { text: string }) {
  return (
    <>
      {parseBlocks(text).map((block, index) => {
        const key = `b${index}`;
        const spacing = 'mt-1 first:mt-0';
        switch (block.kind) {
          case 'quote':
            return (
              <blockquote
                key={key}
                className={`${spacing} whitespace-pre-wrap break-words border-l-4 border-muted-foreground/40 pl-2 text-foreground/80`}
              >
                {inlineLines(block.lines, key)}
              </blockquote>
            );
          case 'ul':
            return (
              <ul key={key} className={`${spacing} list-disc break-words pl-5`}>
                {block.items.map((item, i) => (
                  <li key={i}>{parseInline(item, `${key}-${i}`)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol
                key={key}
                start={block.start}
                className={`${spacing} list-decimal break-words pl-5`}
              >
                {block.items.map((item, i) => (
                  <li key={i}>{parseInline(item, `${key}-${i}`)}</li>
                ))}
              </ol>
            );
          case 'code':
            return (
              <pre
                key={key}
                className={`${spacing} overflow-x-auto whitespace-pre-wrap break-words rounded bg-black/10 p-2 font-mono text-[0.9em] dark:bg-white/15`}
              >
                {block.text}
              </pre>
            );
          default:
            return (
              <p key={key} className={`${spacing} whitespace-pre-wrap break-words text-foreground`}>
                {inlineLines(block.lines, key)}
              </p>
            );
        }
      })}
    </>
  );
}
