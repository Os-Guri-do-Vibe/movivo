/**
 * Testes das ações do portal (US-4.6/4.5): retomar/cancelar. Peak-End sem dark pattern
 * — cancelar exige confirmação, mas está sempre a um toque. `subscription-api`, `next/navigation`
 * e `env` mockados.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const manageSubscription = vi.fn();
const requestRefund = vi.fn();
const getCheckoutLink = vi.fn();
const refresh = vi.fn();

vi.mock('@/lib/env', () => ({ isAnalyticsEnabled: false }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/subscription-api', () => ({
  manageSubscription: (...args: unknown[]) => manageSubscription(...args),
  requestRefund: (...args: unknown[]) => requestRefund(...args),
  getCheckoutLink: (...args: unknown[]) => getCheckoutLink(...args),
}));

import { ManageSubscription } from './manage-subscription';

const TOKEN = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  manageSubscription.mockReset();
  manageSubscription.mockResolvedValue({ status: 'OK' });
  requestRefund.mockReset().mockResolvedValue({ status: 'REFUNDED' });
  getCheckoutLink.mockReset().mockResolvedValue({ url: 'https://movivo.test/checkout/novo' });
  refresh.mockReset();
});

describe('ManageSubscription', () => {
  it('ACTIVE: oferece cancelamento sem pausa indisponível no Asaas', () => {
    render(
      <ManageSubscription token={TOKEN} status="ACTIVE" plan="MONTHLY" paymentMethod="CARD" />,
    );
    expect(screen.queryByRole('button', { name: /Pausar/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancelar assinatura/ })).toBeInTheDocument();
  });

  it('PENDING_PAYMENT: dá para desistir, e o aviso diz que nenhuma cobrança será concluída', async () => {
    const user = userEvent.setup();
    render(
      <ManageSubscription
        token={TOKEN}
        status="PENDING_PAYMENT"
        plan="ANNUAL"
        paymentMethod="PIX"
      />,
    );
    await user.click(screen.getByRole('button', { name: /Cancelar assinatura/ }));
    expect(screen.getByText(/nenhuma cobrança será concluída/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Sim, cancelar/ }));
    await waitFor(() => expect(manageSubscription).toHaveBeenCalledWith(TOKEN, 'cancel'));
  });

  it('TRIALING: oferece cancelamento sem exibir pausa indisponível na API', () => {
    render(
      <ManageSubscription token={TOKEN} status="TRIALING" plan="MONTHLY" paymentMethod={null} />,
    );
    expect(screen.queryByRole('button', { name: /Pausar/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancelar assinatura/ })).toBeInTheDocument();
  });

  it('cancelar pede confirmação e então chama a API', async () => {
    const user = userEvent.setup();
    render(
      <ManageSubscription token={TOKEN} status="ACTIVE" plan="MONTHLY" paymentMethod="CARD" />,
    );
    await user.click(screen.getByRole('button', { name: /Cancelar assinatura/ }));
    expect(screen.getByText(/Não haverá novas mensalidades/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Sim, cancelar/ }));
    await waitFor(() => expect(manageSubscription).toHaveBeenCalledWith(TOKEN, 'cancel'));
    expect(refresh).toHaveBeenCalled();
  });

  it('parcelamento avisa que as parcelas da compra atual continuam devidas', async () => {
    const user = userEvent.setup();
    render(<ManageSubscription token={TOKEN} status="ACTIVE" plan="ANNUAL" paymentMethod="CARD" />);
    await user.click(screen.getByRole('button', { name: /Cancelar assinatura/ }));
    expect(screen.getByText(/parcelas da compra atual continuam devidas/)).toBeInTheDocument();
  });

  it('PAUSED: oferece retomar', async () => {
    const user = userEvent.setup();
    render(
      <ManageSubscription token={TOKEN} status="PAUSED" plan="MONTHLY" paymentMethod="CARD" />,
    );
    await user.click(screen.getByRole('button', { name: /Retomar/ }));
    await waitFor(() => expect(manageSubscription).toHaveBeenCalledWith(TOKEN, 'resume'));
  });

  it('mostra erro quando a ação falha', async () => {
    manageSubscription.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    render(
      <ManageSubscription token={TOKEN} status="PAUSED" plan="MONTHLY" paymentMethod="CARD" />,
    );
    await user.click(screen.getByRole('button', { name: /Retomar/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  describe('arrependimento (7 dias)', () => {
    const UNTIL = '2026-10-15T12:00:00.000Z';

    it('dentro do prazo mostra o limite e só pede o estorno depois de confirmar', async () => {
      const user = userEvent.setup();
      render(
        <ManageSubscription
          token={TOKEN}
          status="ACTIVE"
          plan="ANNUAL"
          paymentMethod="PIX"
          refundEligibleUntil={UNTIL}
        />,
      );
      expect(screen.getByText(/pode pedir o estorno integral até/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /Pedir estorno/ }));
      expect(requestRefund).not.toHaveBeenCalled();
      expect(screen.getByText(/Seu acesso é encerrado agora/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /Sim, pedir estorno/ }));
      await waitFor(() => expect(requestRefund).toHaveBeenCalledWith(TOKEN));
      expect(await screen.findByText(/Estorno solicitado/)).toBeInTheDocument();
      expect(refresh).toHaveBeenCalled();
    });

    it('estorno que o gateway recusou vira pedido manual, sem prometer devolução imediata', async () => {
      const user = userEvent.setup();
      requestRefund.mockResolvedValueOnce({ status: 'PENDING_MANUAL' });
      render(
        <ManageSubscription
          token={TOKEN}
          status="ACTIVE"
          plan="MONTHLY"
          paymentMethod="CARD"
          refundEligibleUntil={UNTIL}
        />,
      );
      await user.click(screen.getByRole('button', { name: /Pedir estorno/ }));
      await user.click(screen.getByRole('button', { name: /Sim, pedir estorno/ }));
      expect(await screen.findByText(/vamos concluí-lo manualmente/)).toBeInTheDocument();
    });

    it('fora do prazo não oferece estorno', () => {
      render(
        <ManageSubscription token={TOKEN} status="ACTIVE" plan="ANNUAL" paymentMethod="PIX" />,
      );
      expect(screen.queryByRole('button', { name: /Pedir estorno/ })).not.toBeInTheDocument();
    });

    it('falha ao pedir o estorno mostra erro e mantém o pedido disponível', async () => {
      const user = userEvent.setup();
      requestRefund.mockRejectedValueOnce(new Error('boom'));
      render(
        <ManageSubscription
          token={TOKEN}
          status="ACTIVE"
          plan="ANNUAL"
          paymentMethod="PIX"
          refundEligibleUntil={UNTIL}
        />,
      );
      await user.click(screen.getByRole('button', { name: /Pedir estorno/ }));
      await user.click(screen.getByRole('button', { name: /Sim, pedir estorno/ }));
      expect(await screen.findByRole('alert')).toBeInTheDocument();
    });
  });

  describe('assinar de novo', () => {
    const assign = vi.fn();

    beforeEach(() => {
      assign.mockReset();
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...window.location, assign },
      });
    });

    it('expirado: pede um link novo do checkout e leva o aluno até ele', async () => {
      const user = userEvent.setup();
      render(
        <ManageSubscription token={TOKEN} status="EXPIRED" plan="MONTHLY" paymentMethod="PIX" />,
      );
      await user.click(screen.getByRole('button', { name: 'Assinar novamente' }));
      await waitFor(() => expect(getCheckoutLink).toHaveBeenCalledWith(TOKEN));
      expect(assign).toHaveBeenCalledWith('https://movivo.test/checkout/novo');
    });

    it('cancelado sem acesso pago em curso também pode assinar de novo', () => {
      render(
        <ManageSubscription token={TOKEN} status="CANCELED" plan="MONTHLY" paymentMethod="CARD" />,
      );
      expect(screen.getByRole('button', { name: 'Assinar novamente' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Cancelar assinatura/ })).not.toBeInTheDocument();
    });

    it('cancelado com período pago em curso informa a data e não oferece recompra ainda', () => {
      render(
        <ManageSubscription
          token={TOKEN}
          status="CANCELED"
          plan="ANNUAL"
          paymentMethod="PIX"
          canRepurchaseAt="2026-12-01T12:00:00.000Z"
        />,
      );
      expect(screen.getByText(/poderá assinar de novo a partir dessa data/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Assinar novamente' })).not.toBeInTheDocument();
    });
  });
});
