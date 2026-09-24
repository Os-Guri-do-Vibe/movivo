/**
 * Testes da regra de preço dos planos. O catálogo é derivado da mensalidade fechada de
 * cada plano — estes testes travam os valores que a landing, o `/assinar` e o checkout
 * exibem/cobram, e o desconto exibido (sempre o real, arredondado ao inteiro).
 */
import { describe, expect, it } from 'vitest';

import {
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_PRICING,
  planDiscountPercent,
  planPriceCents,
} from './subscription.schema';

describe('planPriceCents', () => {
  it('é a mensalidade do plano × meses, em centavos inteiros', () => {
    expect(planPriceCents(1, 7990)).toBe(7990);
    expect(planPriceCents(3, 7590)).toBe(22770);
    expect(planPriceCents(12, 6790)).toBe(81480);
  });
});

describe('planDiscountPercent', () => {
  it('arredonda o desconto real sobre a base ao inteiro', () => {
    expect(planDiscountPercent(7990)).toBe(0);
    expect(planDiscountPercent(7590)).toBe(5); // 5,006%
    expect(planDiscountPercent(7190)).toBe(10); // 10,01%
    expect(planDiscountPercent(6790)).toBe(15); // 15,02%
  });

  it('nunca negativo (mensalidade acima da base não vira desconto)', () => {
    expect(planDiscountPercent(9000)).toBe(0);
  });
});

describe('SUBSCRIPTION_PLANS', () => {
  it('cobra R$79,90 / 75,90 / 71,90 / 67,90 por mês, total = mensal × meses', () => {
    const byId = Object.fromEntries(SUBSCRIPTION_PLANS.map((plan) => [plan.id, plan.priceCents]));
    expect(byId).toEqual({ MONTHLY: 7990, QUARTERLY: 22770, SEMIANNUAL: 43140, ANNUAL: 81480 });
    expect(SUBSCRIPTION_PLANS.map((plan) => plan.discountPercent)).toEqual([0, 5, 10, 15]);
  });

  it('mantém os identificadores e a ordem do contrato de checkout', () => {
    expect(SUBSCRIPTION_PLANS.map((plan) => plan.id)).toEqual([...SUBSCRIPTION_PLAN_IDS]);
  });

  it('marca exatamente um plano recomendado, o configurado', () => {
    const recommended = SUBSCRIPTION_PLANS.filter((plan) => plan.recommended);
    expect(recommended.map((plan) => plan.id)).toEqual([SUBSCRIPTION_PRICING.recommendedPlan]);
  });

  it('o desconto declarado é o desconto real sobre o mensal', () => {
    for (const plan of SUBSCRIPTION_PLANS) {
      const full = SUBSCRIPTION_PRICING.baseMonthlyCents * plan.months;
      expect(Math.round((1 - plan.priceCents / full) * 100)).toBe(plan.discountPercent);
    }
  });
});
