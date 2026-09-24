'use client';

import { useId, useState } from 'react';

import type { SubscriptionPlanId } from '@movivo/shared';

import { cn } from '@/lib/utils';
import { LANDING_EVENTS, planSelectEvent, trackLandingEvent } from '@/lib/landing/analytics';
import { selectPlan } from '@/lib/landing/plan-selection';
import {
  LANDING_PLANS,
  PLAN_BENEFITS,
  billingCadence,
  formatAmount,
  formatBRL,
  type LandingPlan,
} from '@/lib/landing/pricing';

import { TrialCta } from '../ui/pulse-button';

import styles from './pricing.module.css';

function PlanPrice({ plan }: { plan: LandingPlan }) {
  return (
    <>
      <p className={styles.price}>
        <span className={styles.currency} aria-hidden="true">
          R$
        </span>
        <strong aria-hidden="true">{formatAmount(plan.monthlyEquivalentCents)}</strong>
        <span className={styles.per} aria-hidden="true">
          /mês
        </span>
        <span className="sr-only">{`${formatBRL(plan.monthlyEquivalentCents)} por mês`}</span>
      </p>
      <p className={styles.total}>
        {plan.months === 1
          ? 'Cobrança mensal'
          : `${formatBRL(plan.totalCents)} ${billingCadence(plan.months)}`}
      </p>
      {plan.discountPercent > 0 ? (
        <p className={styles.discount}>
          <span>{plan.discountPercent}% OFF</span> economia de {formatBRL(plan.savingsCents)}
        </p>
      ) : (
        <p className={cn(styles.discount, styles.discountNone)}>Sem compromisso de período</p>
      )}
    </>
  );
}

function Benefits() {
  return (
    <ul className={styles.benefits}>
      {PLAN_BENEFITS.map((benefit) => (
        <li key={benefit}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M5 10.5 8.5 14 15 6.5" />
          </svg>
          {benefit}
        </li>
      ))}
    </ul>
  );
}

/**
 * Selo do plano em destaque (o recomendado pelo catálogo, `isDefault`). Texto factual:
 * sem "mais popular"/"mais vendido" enquanto não houver base de alunos que o sustente.
 */
const FEATURED_LABEL = 'Recomendado';

function trackSelect(plan: SubscriptionPlanId) {
  selectPlan(plan);
  trackLandingEvent(planSelectEvent(plan), { plan });
}

/**
 * Desktop: quatro cartões lado a lado, cada um com o próprio CTA. Mobile/tablet: seletor
 * (rádio nativo, acessível por teclado) + um cartão de detalhe com CTA único — o plano
 * escolhido segue para a anamnese pelo fluxo existente (`/anamnese?plano=ID`).
 */
export function PricingPlans() {
  const defaultPlan = LANDING_PLANS.find((plan) => plan.isDefault) ?? LANDING_PLANS[0];
  const [selectedId, setSelectedId] = useState<SubscriptionPlanId | undefined>(defaultPlan?.id);
  const selected = LANDING_PLANS.find((plan) => plan.id === selectedId) ?? defaultPlan;
  const groupName = useId();

  return (
    <>
      <div className={styles.cards}>
        {LANDING_PLANS.map((plan) => (
          <article
            key={plan.id}
            className={cn(styles.card, plan.isDefault && styles.cardFeatured)}
            aria-labelledby={`${groupName}-${plan.id}`}
          >
            {plan.isDefault ? <p className={styles.featuredBadge}>{FEATURED_LABEL}</p> : null}
            <div className={styles.cardHead}>
              <h3 id={`${groupName}-${plan.id}`} className={styles.planName}>
                {plan.label}
              </h3>
            </div>
            <PlanPrice plan={plan} />
            <TrialCta
              event={LANDING_EVENTS.pricingStartTrial}
              plan={plan.id}
              width="full"
              variant={plan.isDefault ? 'primary' : 'secondary'}
              onLight
              onTrack={() => trackSelect(plan.id)}
            >
              Começar 7 dias grátis
            </TrialCta>
            <Benefits />
          </article>
        ))}
      </div>

      <div className={styles.picker}>
        <fieldset className={styles.options}>
          <legend className="sr-only">Escolha o período do plano</legend>
          {LANDING_PLANS.map((plan) => (
            <label
              key={plan.id}
              className={cn(styles.option, plan.id === selected?.id && styles.optionActive)}
            >
              <input
                type="radio"
                name={groupName}
                value={plan.id}
                checked={plan.id === selected?.id}
                onChange={() => {
                  setSelectedId(plan.id);
                  trackSelect(plan.id);
                }}
                className={styles.radio}
              />
              <span className={styles.optionName}>{plan.label}</span>
              <span className={styles.optionPrice}>
                {formatBRL(plan.monthlyEquivalentCents)}
                <small>/mês</small>
              </span>
              {plan.discountPercent > 0 ? (
                <span className={styles.optionOff}>{plan.discountPercent}% OFF</span>
              ) : null}
            </label>
          ))}
        </fieldset>

        {selected ? (
          <div
            className={cn(styles.card, styles.detail, selected.isDefault && styles.cardFeatured)}
            aria-live="polite"
          >
            {selected.isDefault ? <p className={styles.featuredBadge}>{FEATURED_LABEL}</p> : null}
            <div className={styles.cardHead}>
              <p className={styles.planName}>{selected.label}</p>
            </div>
            <PlanPrice plan={selected} />
            <TrialCta
              event={LANDING_EVENTS.pricingStartTrial}
              plan={selected.id}
              width="full"
              magnetic={false}
            >
              Começar 7 dias grátis
            </TrialCta>
            <Benefits />
          </div>
        ) : null}
      </div>
    </>
  );
}
