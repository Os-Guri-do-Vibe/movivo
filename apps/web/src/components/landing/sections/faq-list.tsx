'use client';

import type { FaqItem } from '@/lib/landing/faq';
import { trackLandingEvent } from '@/lib/landing/analytics';

import styles from './faq.module.css';

/**
 * Lista de perguntas em `<details>` nativo: teclado, leitor de tela e "buscar na página"
 * funcionam sem JavaScript, e o texto das respostas fica no HTML para buscadores e IAs.
 * O cliente só mede a abertura de cada pergunta.
 */
export function FaqList({ items }: { items: readonly FaqItem[] }) {
  return (
    <div className={styles.list}>
      {items.map((item) => (
        <details
          key={item.id}
          className={styles.item}
          onToggle={(event) => {
            if (event.currentTarget.open) trackLandingEvent('faq_item_open', { item: item.id });
          }}
        >
          <summary className={styles.summary}>
            <h3 className={styles.question}>{item.question}</h3>
            <span className={styles.icon} aria-hidden="true" />
          </summary>
          <p className={styles.answer}>{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
