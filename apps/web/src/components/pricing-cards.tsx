'use client';

import type { PointerEvent } from 'react';
import { Check } from 'lucide-react';

import { SUBSCRIPTION_PLANS, type SubscriptionPlanId } from '@movivo/shared';

import { StartCta } from '@/components/start-cta';

import styles from '@/app/landing.module.css';

const PLAN_MONTHS: Record<SubscriptionPlanId, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

const FEATURES = [
  'Treinos 100% personalizados',
  'Feedbacks de 100% dos treinos',
  'Grupo exclusivo no WhatsApp',
  'Acompanhamento direto via WhatsApp',
  'Brindes exclusivos durante eventos',
] as const;

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatPrice(cents: number): string {
  return brl.format(cents / 100);
}

function updateSpotlight(event: PointerEvent<HTMLElement>): void {
  const card = event.currentTarget;
  const rect = card.getBoundingClientRect();
  card.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
  card.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
}

function clearSpotlight(event: PointerEvent<HTMLElement>): void {
  event.currentTarget.style.setProperty('--spot-x', '-9999px');
  event.currentTarget.style.setProperty('--spot-y', '-9999px');
}

export function PricingCards() {
  const monthlyPrice = SUBSCRIPTION_PLANS.find(({ id }) => id === 'MONTHLY')?.priceCents;

  if (!monthlyPrice) return null;

  return (
    <div className={styles.planGrid}>
      {SUBSCRIPTION_PLANS.map((plan) => {
        const months = PLAN_MONTHS[plan.id];
        const fullMonthlyPrice = monthlyPrice * months;
        const savings = Math.max(0, Math.round((1 - plan.priceCents / fullMonthlyPrice) * 100));
        const monthlyEquivalent = Math.round(plan.priceCents / months);

        return (
          <article
            key={plan.id}
            className={`${styles.planSpotlight} ${plan.recommended ? styles.featuredPlan : ''}`}
            onPointerMove={updateSpotlight}
            onPointerLeave={clearSpotlight}
          >
            <div className={styles.planCard}>
              {plan.recommended ? <span className={styles.planBadge}>Mais vendido</span> : null}

              <p className={styles.planEyebrow}>{plan.label}</p>
              <div className={styles.planDivider} />

              <div className={styles.planPriceRow}>
                <strong>{formatPrice(plan.priceCents)}</strong>
                <del className={months === 1 ? styles.planOriginalPricePlaceholder : undefined}>
                  {formatPrice(fullMonthlyPrice)}
                </del>
              </div>

              <p className={styles.planDescription}>
                {months === 1
                  ? 'Cobrança mensal. Flexibilidade para começar.'
                  : `${formatPrice(monthlyEquivalent)} por mês. Economize ${savings}% em relação ao mensal.`}
              </p>

              <StartCta
                label="Treinar Grátis"
                location={`pricing_${plan.id.toLowerCase()}`}
                showMicrocopy={false}
                buttonClassName={styles.planCta}
              />

              <ul className={styles.planFeatures}>
                {FEATURES.map((feature) => (
                  <li key={feature}>
                    <span>
                      <Check aria-hidden="true" />
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          </article>
        );
      })}
    </div>
  );
}
