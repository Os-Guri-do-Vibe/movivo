/**
 * Modelo de exibição dos planos: os números da vitrine derivam do catálogo compartilhado
 * (o mesmo do checkout) — nenhum valor é digitado na landing.
 */
import { describe, expect, it } from 'vitest';

import { SUBSCRIPTION_PLANS } from '@movivo/shared';

import {
  LANDING_PLANS,
  PLAN_BENEFITS,
  anamnesisHref,
  billingCadence,
  buildLandingPlans,
  formatAmount,
  formatBRL,
} from './pricing';

const NBSP = String.fromCharCode(160);

describe('LANDING_PLANS', () => {
  it('um item por plano do catálogo, na mesma ordem e com os mesmos IDs', () => {
    expect(LANDING_PLANS.map((plan) => plan.id)).toEqual(SUBSCRIPTION_PLANS.map((plan) => plan.id));
  });

  it('mensal de 79,90 / 75,90 / 71,90 / 67,90, total = mensal × meses e economia sobre o mensal', () => {
    const byId = Object.fromEntries(LANDING_PLANS.map((plan) => [plan.id, plan]));
    expect(byId.MONTHLY).toMatchObject({ monthlyEquivalentCents: 7990, totalCents: 7990 });
    expect(byId.QUARTERLY).toMatchObject({
      monthlyEquivalentCents: 7590,
      totalCents: 22770,
      savingsCents: 1200,
    });
    expect(byId.SEMIANNUAL).toMatchObject({
      monthlyEquivalentCents: 7190,
      totalCents: 43140,
      savingsCents: 4800,
    });
    expect(byId.ANNUAL).toMatchObject({
      monthlyEquivalentCents: 6790,
      totalCents: 81480,
      savingsCents: 14400,
    });
  });

  it('destaca só o maior desconto (verdade matemática, não "mais vendido")', () => {
    expect(LANDING_PLANS.filter((plan) => plan.isBestValue).map((plan) => plan.id)).toEqual([
      'ANNUAL',
    ]);
  });

  it('o padrão do seletor é o plano recomendado do catálogo', () => {
    const recommended = SUBSCRIPTION_PLANS.find((plan) => plan.recommended)?.id;
    expect(LANDING_PLANS.find((plan) => plan.isDefault)?.id).toBe(recommended);
  });

  it('sem nenhum desconto no catálogo, nenhum plano ganha destaque', () => {
    const flat = buildLandingPlans(
      [
        {
          id: 'MONTHLY',
          label: 'Mensal',
          priceCents: 1000,
          monthlyCents: 1000,
          periodDays: 30,
          months: 1,
          discountPercent: 0,
          recommended: true,
        },
      ],
      1000,
    );
    expect(flat[0]?.isBestValue).toBe(false);
    expect(flat[0]?.savingsCents).toBe(0);
  });
});

describe('formatação', () => {
  it('formata centavos em reais (pt-BR)', () => {
    expect(formatBRL(81480)).toBe(`R$${NBSP}814,80`);
    expect(formatAmount(6790)).toBe('67,90');
  });

  it('descreve a periodicidade da cobrança', () => {
    expect(billingCadence(1)).toBe('por mês');
    expect(billingCadence(3)).toBe('a cada 3 meses');
    expect(billingCadence(12)).toBe('por ano');
  });

  it('leva o plano para a anamnese pelo parâmetro existente', () => {
    expect(anamnesisHref('ANNUAL')).toBe('/anamnese?plano=ANNUAL');
  });

  it('lista os benefícios comuns a todos os planos', () => {
    expect(PLAN_BENEFITS).toContain('Respaldo profissional');
  });
});
