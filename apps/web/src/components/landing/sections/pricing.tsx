import { cn } from '@/lib/utils';
import { SECTION_IDS } from '@/lib/landing/site';
import { TRIAL_DAYS } from '@/lib/landing/pricing';

import landing from '../landing.module.css';

import { PricingPlans } from './pricing-plans';
import styles from './pricing.module.css';

export function Pricing() {
  return (
    <section
      id={SECTION_IDS.pricing}
      className={cn(landing.section, landing.themeLight, styles.pricing)}
      aria-labelledby="pricing-title"
      data-section-view="pricing"
    >
      <div className={landing.container}>
        <header className={styles.header}>
          <h2 id="pricing-title" className={landing.h2}>
            Comece a se mover.
          </h2>
          <p className={cn(landing.lead, landing.secondaryText)}>
            {TRIAL_DAYS} dias para experimentar a MOVIVO antes de decidir continuar.
          </p>
        </header>

        <PricingPlans />

        <div className={styles.footnote}>
          <p>
            <strong>Você só assina depois do período gratuito.</strong> Sem cartão para começar e
            sem cobrança automática ao fim do teste.
          </p>
          <p className={landing.secondaryText}>
            Todos os planos incluem o mesmo acompanhamento. O período muda só o valor. Para maiores
            de 18 anos.
          </p>
        </div>
      </div>
    </section>
  );
}
