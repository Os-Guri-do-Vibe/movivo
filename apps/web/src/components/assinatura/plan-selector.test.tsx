/**
 * Testes do seletor de plano/pagamento (US-4.6): renderiza os 4 planos, alterna seleção
 * (aria-pressed) e o CTA chama o checkout com o plano/método escolhidos. `subscription-api`
 * e `env` mockados; nenhum dado de cartão é tocado (só recebemos a checkoutUrl).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const startCheckout = vi.fn();

vi.mock('@/lib/env', () => ({ isAnalyticsEnabled: false }));
vi.mock('@/lib/subscription-api', () => ({
  startCheckout: (...args: unknown[]) => startCheckout(...args),
  formatBRL: (c: number) => `R$ ${(c / 100).toFixed(2)}`,
}));

import { PlanSelector } from './plan-selector';

beforeEach(() => {
  startCheckout.mockReset();
  startCheckout.mockResolvedValue({ checkoutUrl: 'https://gateway.test/c/abc' });
  Object.defineProperty(window, 'location', { value: { href: '' }, writable: true });
});

const TOKEN = '11111111-1111-4111-8111-111111111111';

describe('PlanSelector', () => {
  it('renderiza os quatro planos', () => {
    render(<PlanSelector token={TOKEN} initialPlan="QUARTERLY" />);
    for (const label of ['Mensal', 'Trimestral', 'Semestral', 'Anual']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('pré-seleciona o plano inicial e permite trocar', async () => {
    const user = userEvent.setup();
    render(<PlanSelector token={TOKEN} initialPlan="QUARTERLY" />);
    const anual = screen.getByRole('button', { name: /Anual/ });
    expect(anual).toHaveAttribute('aria-pressed', 'false');
    await user.click(anual);
    expect(anual).toHaveAttribute('aria-pressed', 'true');
  });

  it('CTA chama o checkout com o plano e método escolhidos', async () => {
    const user = userEvent.setup();
    render(<PlanSelector token={TOKEN} initialPlan="MONTHLY" />);
    await user.click(screen.getByRole('button', { name: 'PIX' }));
    await user.click(screen.getByRole('button', { name: /Ir para o pagamento/ }));
    await waitFor(() => expect(startCheckout).toHaveBeenCalledWith(TOKEN, 'MONTHLY', 'PIX'));
  });

  it('mostra erro quando o checkout falha', async () => {
    startCheckout.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    render(<PlanSelector token={TOKEN} initialPlan="MONTHLY" />);
    await user.click(screen.getByRole('button', { name: /Ir para o pagamento/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
