import { Fragment } from 'react';

import { cn } from '@/lib/utils';

import styles from './fold-text.module.css';

/**
 * Trecho da frase: texto puro ou com tom próprio (classe) e/ou sublinhado. Espaço não
 * separável (`\u00A0`) mantém palavras juntas na mesma linha (ex.: "não muda").
 */
export type FoldPart = string | { text: string; className?: string; underline?: boolean };

type Run = { text: string; className?: string; underline?: boolean };

/** Espaços comuns separam palavras; o não separável fica dentro da palavra. */
const BREAKABLE_SPACE = /([^\S\u00A0]+)/;

/** Agrupa os trechos em palavras: a quebra de linha só acontece entre palavras. */
function toWords(parts: readonly FoldPart[]): Run[][] {
  const words: Run[][] = [];
  let current: Run[] = [];
  for (const part of parts) {
    const run = typeof part === 'string' ? { text: part } : part;
    run.text.split(BREAKABLE_SPACE).forEach((chunk, index) => {
      if (!chunk) return;
      // `split` com grupo de captura: os índices ímpares são os separadores.
      if (index % 2 === 1) {
        if (current.length) words.push(current);
        current = [];
      } else {
        current.push({ ...run, text: chunk });
      }
    });
  }
  if (current.length) words.push(current);
  return words;
}

/**
 * Marcação do Fold Text: cada caractere é uma peça (`data-fold-piece`) que desdobra da
 * dobradiça superior — a animação fica no efeito da seção (`motion/effects.ts`). Sem JS
 * ou com movimento reduzido é texto comum, já visível. A frase inteira vai para leitor
 * de tela e busca num `sr-only`; as peças são `aria-hidden`.
 */
export function FoldText({ parts, className }: { parts: readonly FoldPart[]; className?: string }) {
  const text = parts.map((part) => (typeof part === 'string' ? part : part.text)).join('');
  return (
    <span className={cn(styles.fold, className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {toWords(parts).map((word, wordIndex) => (
          <Fragment key={wordIndex}>
            {wordIndex > 0 ? ' ' : null}
            <span className={styles.word}>
              {word.map((run, runIndex) => (
                <span key={runIndex} className={cn(styles.run, run.className)}>
                  {Array.from(run.text, (char, charIndex) => (
                    <span key={charIndex} className={styles.segment}>
                      <span className={styles.piece} data-fold-piece="">
                        {char}
                      </span>
                    </span>
                  ))}
                  {run.underline ? (
                    <span className={styles.underline} data-fold-underline="" />
                  ) : null}
                </span>
              ))}
            </span>
          </Fragment>
        ))}
      </span>
    </span>
  );
}
