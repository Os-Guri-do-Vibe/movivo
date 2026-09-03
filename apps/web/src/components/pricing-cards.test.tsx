/**
 * Testes do grid de planos da landing (`PricingCards`): um cartão por plano de
 * `SUBSCRIPTION_PLANS`, o cálculo de economia/preço mensal equivalente, o destaque do
 * plano recomendado e o rastro de brilho por ponteiro (`--spot-x`/`--spot-y`).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SUBSCRIPTION_PLANS } from '@movivo/shared';

import { PricingCards } from './pricing-cards';

/**
 * `Intl.NumberFormat('pt-BR', { style: 'currency', ... })` separa "R$" do valor com um
 * NBSP (U+00A0), não um espaço comum. `toHaveTextContent`/`getByText` normalizam o texto
 * do DOM (qualquer `\s`, NBSP incluso, vira espaço comum) mas não normalizam a string de
 * busca — então formatamos preços de teste sempre por aqui, já convertidos.
 */
const NBSP = String.fromCharCode(160);
function brlLabel(cents: number): string {
  const formatted = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
  return formatted.split(NBSP).join(' ');
}

describe('PricingCards', () => {
  it('renderiza um cartao por plano, com CTA e lista de features', () => {
    render(<PricingCards />);

    for (const plan of SUBSCRIPTION_PLANS) {
      expect(screen.getByText(plan.label)).toBeVisible();
    }
    const ctas = screen.getAllByRole('link', { name: 'Treinar Grátis' });
    expect(ctas).toHaveLength(SUBSCRIPTION_PLANS.length);
    for (const plan of SUBSCRIPTION_PLANS) {
      expect(
        ctas.some(
          (cta) =>
            cta.getAttribute('data-analytics-event') ===
            `pricing_${plan.id.toLowerCase()}_anamnesis_click`,
        ),
      ).toBe(true);
    }
    expect(screen.getAllByText('Treinos 100% personalizados')).toHaveLength(
      SUBSCRIPTION_PLANS.length,
    );
  });

  it('o plano mensal descreve cobranca mensal, sem economia calculada', () => {
    render(<PricingCards />);
    expect(screen.getByText('Cobrança mensal. Flexibilidade para começar.')).toBeVisible();
  });

  it('planos multi-mes mostram o preco mensal equivalente e o percentual de economia', () => {
    render(<PricingCards />);
    const quarterly = SUBSCRIPTION_PLANS.find((plan) => plan.id === 'QUARTERLY');
    if (!quarterly) throw new Error('fixture sem plano trimestral');
    const monthly = SUBSCRIPTION_PLANS.find((plan) => plan.id === 'MONTHLY');
    if (!monthly) throw new Error('fixture sem plano mensal');

    const months = 3;
    const fullMonthlyPrice = monthly.priceCents * months;
    const savings = Math.max(0, Math.round((1 - quarterly.priceCents / fullMonthlyPrice) * 100));
    const monthlyEquivalent = Math.round(quarterly.priceCents / months);

    const quarterlyCard = screen.getByText('Trimestral').closest('article');
    if (!quarterlyCard) throw new Error('cartão do plano trimestral não encontrado');
    expect(quarterlyCard).toHaveTextContent(
      `${brlLabel(monthlyEquivalent)} por mês. Economize ${savings}% em relação ao mensal.`,
    );
  });

  it('destaca o plano recomendado com o selo "Mais vendido"', () => {
    render(<PricingCards />);
    const recommended = SUBSCRIPTION_PLANS.filter((plan) => plan.recommended);
    expect(screen.getAllByText('Mais vendido')).toHaveLength(recommended.length);
  });

  it('atualiza a posicao do brilho no ponteiro e recolhe ao sair do cartao', () => {
    render(<PricingCards />);
    const [firstCard] = screen
      .getAllByRole('link', { name: 'Treinar Grátis' })
      .map((cta) => cta.closest('article') as HTMLElement);
    if (!firstCard) throw new Error('cartão de plano não encontrado');

    fireEvent.pointerMove(firstCard, { clientX: 40, clientY: 12 });
    expect(firstCard.style.getPropertyValue('--spot-x')).toBe('40px');
    expect(firstCard.style.getPropertyValue('--spot-y')).toBe('12px');

    fireEvent.pointerLeave(firstCard);
    expect(firstCard.style.getPropertyValue('--spot-x')).toBe('-9999px');
    expect(firstCard.style.getPropertyValue('--spot-y')).toBe('-9999px');
  });
});
