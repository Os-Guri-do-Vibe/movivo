import { cn } from '@/lib/utils';
import { buildFaq } from '@/lib/landing/faq';
import { SECTION_IDS } from '@/lib/landing/site';

import landing from '../landing.module.css';

import { FaqList } from './faq-list';
import styles from './faq.module.css';

/** Perguntas frequentes: as mesmas do `FAQPage` em JSON-LD (`lib/landing/faq.ts`). */
export function Faq() {
  return (
    <section
      id={SECTION_IDS.faq}
      className={cn(landing.section, landing.themeWhite, styles.faq)}
      aria-labelledby="faq-title"
      data-section-view="faq"
    >
      <div className={landing.container}>
        <header className={styles.header}>
          <p className={landing.eyebrow}>Dúvidas</p>
          <h2 id="faq-title" className={cn(landing.h2, styles.title)}>
            Perguntas frequentes
          </h2>
        </header>
        <FaqList items={buildFaq()} />
      </div>
    </section>
  );
}
