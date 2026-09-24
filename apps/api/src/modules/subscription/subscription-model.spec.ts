import { describe, expect, it } from 'vitest';

import { SUBSCRIPTION_PLANS } from '@movivo/shared';

import {
  canTransition,
  type ContractInput,
  isRecurringContract,
  paidThroughFor,
  PLAN_CATALOG,
  referencesContract,
  resolveAccess,
  TRIAL_DAYS,
} from './subscription-model';

describe('subscription-model — catálogo de planos (US-4.1)', () => {
  it('tem os 4 planos do MVP em centavos inteiros', () => {
    expect(Object.keys(PLAN_CATALOG).sort()).toEqual(
      ['ANNUAL', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL'].sort(),
    );
    expect(PLAN_CATALOG.MONTHLY.priceCents).toBe(7990);
    expect(PLAN_CATALOG.QUARTERLY.priceCents).toBe(22770);
    expect(PLAN_CATALOG.SEMIANNUAL.priceCents).toBe(43140);
    expect(PLAN_CATALOG.ANNUAL.priceCents).toBe(81480);
    expect(
      ['QUARTERLY', 'SEMIANNUAL', 'ANNUAL'].map((id) => {
        const months = { QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12 }[id] ?? 1;
        return Math.round(
          (1 - PLAN_CATALOG[id as keyof typeof PLAN_CATALOG].priceCents / (7990 * months)) * 100,
        );
      }),
    ).toEqual([5, 10, 15]);
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
    expect(canTransition('TRIALING', 'PENDING_PAYMENT')).toBe(true);
    expect(canTransition('PENDING_PAYMENT', 'ACTIVE')).toBe(true);
    expect(canTransition('ACTIVE', 'PAST_DUE')).toBe(true);
    expect(canTransition('ACTIVE', 'PAUSED')).toBe(true);
    expect(canTransition('PAST_DUE', 'ACTIVE')).toBe(true);
    expect(canTransition('PAUSED', 'ACTIVE')).toBe(true);
    expect(canTransition('EXPIRED', 'ACTIVE')).toBe(true); // win-back
    expect(canTransition('ACTIVE', 'EXPIRED')).toBe(true); // período pago sem renovação
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

  it('PENDING_PAYMENT / PAUSED / CANCELED / EXPIRED → RESTRICTED', () => {
    for (const status of ['PENDING_PAYMENT', 'PAUSED', 'CANCELED', 'EXPIRED'] as const) {
      expect(resolveAccess({ status, trialEndsAt: null, updatedAt: now }, GRACE, now)).toBe(
        'RESTRICTED',
      );
    }
  });

  it('CANCELED mantém o acesso até o fim do período já pago', () => {
    const canceled = { status: 'CANCELED' as const, trialEndsAt: null, updatedAt: now };
    expect(resolveAccess({ ...canceled, currentPeriodEnd: inFuture }, GRACE, now)).toBe('FULL');
    expect(resolveAccess({ ...canceled, currentPeriodEnd: inPast }, GRACE, now)).toBe('RESTRICTED');
  });
});

describe('subscription-model — contrato vigente e período pago', () => {
  const contract = (over: Partial<ContractInput> = {}): ContractInput => ({
    plan: 'MONTHLY',
    paymentMethod: 'CARD',
    externalSubscriptionId: 'sub_1',
    externalPaymentId: null,
    externalInstallmentId: null,
    externalAuthorizationId: null,
    ...over,
  });

  it('só assinatura mensal no cartão e Pix Automático são recorrentes', () => {
    expect(isRecurringContract({ plan: 'MONTHLY', paymentMethod: 'CARD' })).toBe(true);
    expect(isRecurringContract({ plan: 'ANNUAL', paymentMethod: 'PIX_AUTOMATIC' })).toBe(true);
    expect(isRecurringContract({ plan: 'QUARTERLY', paymentMethod: 'CARD' })).toBe(false);
    expect(isRecurringContract({ plan: 'MONTHLY', paymentMethod: 'PIX' })).toBe(false);
    expect(isRecurringContract({ plan: 'MONTHLY', paymentMethod: null })).toBe(false);
  });

  it('evento de contrato substituído não referencia o contrato vigente', () => {
    const pix = contract({
      paymentMethod: 'PIX',
      externalSubscriptionId: null,
      externalPaymentId: 'pay_new',
    });
    expect(
      referencesContract({ externalSubscriptionId: 'pay_old', externalPaymentId: 'pay_old' }, pix),
    ).toBe(false);
    expect(
      referencesContract({ externalSubscriptionId: 'pay_new', externalPaymentId: 'pay_new' }, pix),
    ).toBe(true);
    // Qualquer ID do contrato serve: o débito do Pix Automático só traz a autorização.
    const auto = contract({
      paymentMethod: 'PIX_AUTOMATIC',
      externalSubscriptionId: null,
      externalAuthorizationId: 'aut_1',
    });
    expect(
      referencesContract(
        { externalSubscriptionId: 'aut_1', externalAuthorizationId: 'aut_1' },
        auto,
      ),
    ).toBe(true);
    // Contrato desvinculado (troca em andamento) não casa com nada.
    expect(
      referencesContract(
        { externalSubscriptionId: 'sub_1' },
        contract({ externalSubscriptionId: null }),
      ),
    ).toBe(false);
  });

  it('recorrente paga um mês a partir do vencimento; cobrança única paga o período inteiro', () => {
    const at = new Date('2026-09-23T15:00:00Z');
    expect(
      paidThroughFor({ plan: 'MONTHLY', paymentMethod: 'CARD' }, '2026-10-23T03:00:00.000Z', at),
    ).toEqual(new Date('2026-11-23T03:00:00.000Z'));
    // Pix Automático trimestral: um débito cobre um mês, não os 90 dias do contrato.
    expect(
      paidThroughFor({ plan: 'QUARTERLY', paymentMethod: 'PIX_AUTOMATIC' }, undefined, at),
    ).toEqual(new Date('2026-10-23T15:00:00Z'));
    expect(paidThroughFor({ plan: 'QUARTERLY', paymentMethod: 'CARD' }, undefined, at)).toEqual(
      new Date(at.getTime() + 90 * 24 * 3600 * 1000),
    );
  });
});
