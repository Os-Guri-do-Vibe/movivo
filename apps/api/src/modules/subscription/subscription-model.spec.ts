import { describe, expect, it } from 'vitest';

import { canTransition, PLAN_CATALOG, TRIAL_DAYS } from './subscription-model';

describe('subscription-model — catálogo de planos (US-4.1)', () => {
  it('tem os 4 planos do MVP em centavos inteiros', () => {
    expect(Object.keys(PLAN_CATALOG).sort()).toEqual(
      ['ANNUAL', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL'].sort(),
    );
    expect(PLAN_CATALOG.MONTHLY.priceCents).toBe(3900);
    expect(PLAN_CATALOG.QUARTERLY.priceCents).toBe(9900);
    expect(PLAN_CATALOG.ANNUAL.priceCents).toBe(34900);
    for (const spec of Object.values(PLAN_CATALOG)) {
      expect(Number.isInteger(spec.priceCents)).toBe(true);
      expect(Number.isInteger(spec.periodDays)).toBe(true);
    }
    expect(TRIAL_DAYS).toBe(7);
  });
});

describe('subscription-model — máquina de estados (US-4.1)', () => {
  it('permite as transições legítimas', () => {
    expect(canTransition('TRIALING', 'ACTIVE')).toBe(true);
    expect(canTransition('ACTIVE', 'PAST_DUE')).toBe(true);
    expect(canTransition('ACTIVE', 'PAUSED')).toBe(true);
    expect(canTransition('PAST_DUE', 'ACTIVE')).toBe(true);
    expect(canTransition('PAUSED', 'ACTIVE')).toBe(true);
    expect(canTransition('EXPIRED', 'ACTIVE')).toBe(true); // win-back
  });

  it('rejeita transições inválidas', () => {
    expect(canTransition('CANCELED', 'ACTIVE')).toBe(false); // terminal
    expect(canTransition('TRIALING', 'PAST_DUE')).toBe(false);
    expect(canTransition('PAUSED', 'PAST_DUE')).toBe(false);
  });

  it('trata a mesma origem/destino como no-op permitido (idempotência)', () => {
    expect(canTransition('ACTIVE', 'ACTIVE')).toBe(true);
    expect(canTransition('CANCELED', 'CANCELED')).toBe(true);
  });
});
