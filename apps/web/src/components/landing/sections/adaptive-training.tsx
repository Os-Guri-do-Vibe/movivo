import { cn } from '@/lib/utils';
import { SECTION_IDS } from '@/lib/landing/site';

import landing from '../landing.module.css';
import { SectionMotion } from '../motion/section-motion';
import { RevealLines } from '../ui/reveal-lines';

import styles from './adaptive-training.module.css';

const TIMELINE = [
  { when: 'Semana 01', what: 'Protocolo inicial' },
  { when: 'Semana 02', what: 'Feedback recebido' },
  { when: 'Semana 03', what: 'Carga e execução observadas' },
  { when: 'Semana 04', what: 'Ajustes no protocolo' },
  { when: 'Próximo ciclo', what: 'Nova evolução' },
] as const;

export function AdaptiveTraining() {
  return (
    <section
      id={SECTION_IDS.adaptive}
      className={cn(landing.section, landing.themePetroleum, styles.adaptive)}
      aria-labelledby="adaptive-title"
      data-section-view="adaptive"
    >
      <div className={landing.container}>
        <header className={styles.header}>
          <RevealLines
            id="adaptive-title"
            className={cn(landing.h2, styles.title)}
            lines={['Seu plano não deveria ficar parado.', 'Você também não.']}
          />
        </header>

        <SectionMotion effect="adaptive" className={styles.timelineWrap}>
          <div className={styles.track} aria-hidden="true">
            <span className={styles.trackFill} data-track-fill="" />
            <span className={styles.trackHead} data-track-head="" />
          </div>
          <ol className={styles.timeline}>
            {TIMELINE.map((step, index) => (
              <li key={step.when} className={styles.step} data-step="">
                <span className={styles.node} aria-hidden="true" />
                <p className={styles.when}>{step.when}</p>
                <p className={styles.what}>{step.what}</p>
                {index === TIMELINE.length - 1 ? (
                  <span className={styles.loop} aria-hidden="true">
                    ↻
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </SectionMotion>

        <p className={cn(landing.lead, styles.body)} data-reveal="">
          Feedbacks e contexto ajudam a manter o treino coerente com a sua evolução e com o que
          acontece fora da academia.
        </p>
      </div>
    </section>
  );
}
