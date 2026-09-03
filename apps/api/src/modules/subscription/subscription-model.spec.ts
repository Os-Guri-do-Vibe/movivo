import { describe, expect, it } from 'vitest';

import { SUBSCRIPTION_PLANS } from '@movivo/shared';

import { canTransition, PLAN_CATALOG, resolveAccess, TRIAL_DAYS } from './subscription-model';

describe('subscription-model — catálogo de planos (US-4.1)', () => {
  it('tem os 4 planos do MVP em centavos inteiros', () => {
    expect(Object.keys(PLAN_CATALOG).sort()).toEqual(
      ['ANNUAL', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL'].sort(),
    );
    expect(PLAN_CATALOG.MONTHLY.priceCents).toBe(7990);
    expect(PLAN_CATALOG.QUARTERLY.priceCents).toBe(20282);
    expect(PLAN_CATALOG.SEMIANNUAL.priceCents).toBe(38721);
    expect(PLAN_CATALOG.ANNUAL.priceCents).toBe(71500);
    expect(
      ['QUARTERLY', 'SEMIANNUAL', 'ANNUAL'].map((id) => {
        const months = { QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12 }[id] ?? 1;
        return Math.round(
          (1 - PLAN_CATALOG[id as keyof typeof PLAN_CATALOG].priceCents / (7990 * months)) * 100,
        );
      }),
    ).toEqual([15, 19, 25]);
    expect(SUBSCRIPTION_PLANS.find((plan) => plan.recommended)?.id).toBe('SEMIANNUAL');
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

describe('subscription-model — gate de acesso derivado do estado (US-4.2.3)', () => {
  const now = new Date('2026-08-01T12:00:00Z');
  const GRACE = 3;
  const inFuture = new Date(now.getTime() + 24 * 3600 * 1000);
  const inPast = new Date(now.getTime() - 24 * 3600 * 1000);

  it('sem assinatura → RESTRICTED', () => {
    expect(resolveAccess(null, GRACE, now)).toBe('RESTRICTED');
  });

  it('ACTIVE → FULL', () => {
    expect(resolveAccess({ status: 'ACTIVE', trialEndsAt: null, updatedAt: now }, GRACE, now)).toBe(
      'FULL',
    );
  });

  it('TRIALING na janela → FULL; expirado → RESTRICTED (não bloqueia abrupto, mas restringe)', () => {
    expect(
      resolveAccess({ status: 'TRIALING', trialEndsAt: inFuture, updatedAt: now }, GRACE, now),
    ).toBe('FULL');
    expect(
      resolveAccess({ status: 'TRIALING', trialEndsAt: inPast, updatedAt: now }, GRACE, now),
    ).toBe('RESTRICTED');
  });

  it('PAST_DUE dentro da graça → FULL; após a graça → RESTRICTED', () => {
    const enteredNow = { status: 'PAST_DUE' as const, trialEndsAt: null, updatedAt: now };
    const enteredOld = {
      status: 'PAST_DUE' as const,
      trialEndsAt: null,
      updatedAt: new Date(now.getTime() - (GRACE + 1) * 24 * 3600 * 1000),
    };
    expect(resolveAccess(enteredNow, GRACE, now)).toBe('FULL');
    expect(resolveAccess(enteredOld, GRACE, now)).toBe('RESTRICTED');
  });

  it('PAUSED / CANCELED / EXPIRED → RESTRICTED', () => {
    for (const status of ['PAUSED', 'CANCELED', 'EXPIRED'] as const) {
      expect(resolveAccess({ status, trialEndsAt: null, updatedAt: now }, GRACE, now)).toBe(
        'RESTRICTED',
      );
    }
  });
});
