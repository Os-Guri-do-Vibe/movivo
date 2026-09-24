/**
 * Planos: valores vindos do catálogo, destaque só onde é matematicamente verdadeiro,
 * CTA de cada plano preservando o ID até a anamnese e seletor acessível no mobile.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AnalyticsModule from '@/lib/landing/analytics';

const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('@/lib/landing/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof AnalyticsModule>()),
  trackLandingEvent: track,
}));

import { getSelectedPlan, selectPlan } from '@/lib/landing/plan-selection';

import { PricingPlans } from './pricing-plans';

beforeEach(() => track.mockClear());
afterEach(() => selectPlan(null));

function normalized(text: string | null): string {
  return (text ?? '').replace(/\s+/g, ' ');
}

describe('PricingPlans', () => {
  it('um cartão por plano, cada CTA levando o próprio plano à anamnese', () => {
    render(<PricingPlans />);
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(4);
    const hrefs = cards.map((card) =>
      within(card)
        .getByRole('link', { name: /Começar 7 dias grátis/ })
        .getAttribute('href'),
    );
    expect(hrefs).toEqual([
      '/anamnese?plano=MONTHLY',
      '/anamnese?plano=QUARTERLY',
      '/anamnese?plano=SEMIANNUAL',
      '/anamnese?plano=ANNUAL',
    ]);
  });

  it('mostra mensal equivalente, total e desconto derivados do catálogo', () => {
    render(<PricingPlans />);
    const annual = screen.getByRole('article', { name: 'Anual' });
    expect(normalized(annual.textContent)).toContain('67,90');
    expect(normalized(annual.textContent)).toContain('R$ 814,80 por ano');
    expect(normalized(annual.textContent)).toContain('15% OFF');
    const quarterly = screen.getByRole('article', { name: 'Trimestral' });
    expect(normalized(quarterly.textContent)).toContain('R$ 227,70 a cada 3 meses');
  });

  it('o destaque vai para o plano recomendado pelo catálogo — nada de "mais vendido"', () => {
    render(<PricingPlans />);
    const semiannual = screen.getByRole('article', { name: 'Semestral' });
    expect(within(semiannual).getByText('Recomendado')).toBeInTheDocument();
    // Cartão semestral + detalhe mobile (que começa no plano recomendado).
    expect(screen.getAllByText('Recomendado')).toHaveLength(2);
    expect(within(semiannual).getByRole('link')).toHaveAttribute(
      'href',
      '/anamnese?plano=SEMIANNUAL',
    );
    expect(screen.queryByText(/Maior economia/)).toBeNull();
    expect(screen.queryByText(/mais vendido|mais popular|preferido/i)).toBeNull();
  });

  it('o seletor mobile troca o plano, rastreia a escolha e atualiza o CTA', async () => {
    const user = userEvent.setup();
    render(<PricingPlans />);
    const quarterly = screen.getByRole('radio', { name: /Trimestral/ });
    await user.click(quarterly);
    expect(quarterly).toBeChecked();
    expect(track).toHaveBeenCalledWith('pricing_select_quarterly', { plan: 'QUARTERLY' });
    expect(getSelectedPlan()).toBe('QUARTERLY');
    const detailLinks = screen
      .getAllByRole('link', { name: /Começar 7 dias grátis/ })
      .map((link) => link.getAttribute('href'));
    expect(detailLinks.filter((href) => href === '/anamnese?plano=QUARTERLY')).toHaveLength(2);
  });

  it('clicar no CTA de um cartão registra a seleção do plano', async () => {
    const user = userEvent.setup();
    render(<PricingPlans />);
    const monthly = screen.getByRole('article', { name: 'Mensal' });
    await user.click(within(monthly).getByRole('link'));
    expect(track).toHaveBeenCalledWith('pricing_select_monthly', { plan: 'MONTHLY' });
    expect(track).toHaveBeenCalledWith('pricing_start_trial', { plan: 'MONTHLY' });
  });
});
