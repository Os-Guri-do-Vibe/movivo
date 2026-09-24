import { cn } from '@/lib/utils';
import { SECTION_IDS } from '@/lib/landing/site';

import landing from '../landing.module.css';
import { SectionMotion } from '../motion/section-motion';
import { FoldText, type FoldPart } from '../ui/fold-text';

import styles from './manifesto.module.css';

/* Uma frase por vez, na ordem: cada uma dá um passo à frente da anterior. Os destaques
 * curtos usam espaço não separável para nunca quebrar no meio. */
const STATEMENTS: readonly { parts: readonly FoldPart[]; closing?: boolean }[] = [
  { parts: ['Potencial ', { text: 'não\u00A0muda', className: styles.pulso }, ' nada parado.'] },
  { parts: ['Você ', { text: 'não\u00A0precisa', className: styles.coral }, ' ser perfeito.'] },
  { parts: ['Precisa ', { text: 'continuar.', underline: true }] },
  { parts: ['Melhor do que ontem.'] },
  { parts: ['Mais perto de quem ', { text: 'você decidiu ser', className: styles.coral }, '.'] },
  { parts: [{ text: 'Nós fazemos acontecer!', className: styles.pulso }], closing: true },
];

/**
 * Why we move. Com movimento: as frases se revezam sozinhas no centro da caixa, em
 * loop, entrando em Fold Text (efeito `manifesto`). Sem JS ou com movimento reduzido:
 * as seis frases empilhadas e visíveis.
 */
export function Manifesto() {
  return (
    <section
      id={SECTION_IDS.manifesto}
      className={cn(landing.themeLight, styles.manifesto)}
      aria-labelledby="manifesto-title"
    >
      <h2 id="manifesto-title" className="sr-only" lang="en">
        Why we move
      </h2>

      <SectionMotion effect="manifesto" className={styles.stage}>
        <ol className={cn(landing.containerWide, styles.statements)}>
          {STATEMENTS.map((statement, index) => (
            <li
              key={index}
              className={cn(styles.statement, statement.closing && styles.closing)}
              data-manifesto-item=""
            >
              <FoldText parts={statement.parts} />
            </li>
          ))}
        </ol>
      </SectionMotion>
    </section>
  );
}
