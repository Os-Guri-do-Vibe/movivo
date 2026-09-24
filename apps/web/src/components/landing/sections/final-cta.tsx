import { cn } from '@/lib/utils';
import { LANDING_EVENTS } from '@/lib/landing/analytics';
import { SECTION_IDS } from '@/lib/landing/site';
import { TRIAL_DAYS } from '@/lib/landing/pricing';

import landing from '../landing.module.css';
import { MovivoLogo } from '../ui/movivo-logo';
import { TrialCta } from '../ui/pulse-button';

import styles from './final-cta.module.css';
import { FinalThreads } from './final-threads';

export function FinalCta() {
  return (
    <section
      id={SECTION_IDS.finalCta}
      className={cn(landing.themeDeep, styles.final)}
      aria-labelledby="final-title"
    >
      <div className={styles.media} aria-hidden="true">
        <FinalThreads />
      </div>
      <div className={styles.overlay} aria-hidden="true" />

      <div className={cn(landing.container, styles.content)}>
        <p className={styles.small} lang="en">
          You already have potential.
        </p>
        <h2 id="final-title" className={styles.display} lang="en">
          Move it.
        </h2>
        <MovivoLogo className={styles.logo} />
        <p className={styles.signature} lang="en">
          welcome to a brighter you.
        </p>
        <div className={styles.action}>
          <TrialCta event={LANDING_EVENTS.finalStartTrial} srSuffix=": começar 7 dias grátis">
            <span lang="en">Start moving</span>
          </TrialCta>
          <p className={styles.micro}>
            Começar {TRIAL_DAYS} dias grátis · sem cobrança durante o teste
          </p>
        </div>
      </div>
    </section>
  );
}
