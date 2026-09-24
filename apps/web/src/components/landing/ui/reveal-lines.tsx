import { Fragment, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

import styles from '../landing.module.css';

type RevealLinesProps = {
  as?: 'h1' | 'h2' | 'h3' | 'p';
  lines: readonly ReactNode[];
  className?: string;
  id?: string;
  lang?: string;
};

/**
 * Título com máscara por linha para o reveal editorial. Continua um único elemento de
 * texto semântico: as linhas são `span`s separados por espaço, então leitor de tela e
 * busca leem a frase inteira. Sem JS (ou com movimento reduzido) o texto já está visível.
 */
export function RevealLines({ as: Tag = 'h2', lines, className, id, lang }: RevealLinesProps) {
  return (
    <Tag className={className} id={id} lang={lang} data-reveal-lines="">
      {lines.map((line, index) => (
        <Fragment key={index}>
          <span className={styles.line}>
            <span className={cn(styles.lineInner, 'mv-line')}>{line}</span>
          </span>
          {index < lines.length - 1 ? ' ' : null}
        </Fragment>
      ))}
    </Tag>
  );
}
