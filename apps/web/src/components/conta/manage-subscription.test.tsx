/**
 * Testes das ações do portal (US-4.6/4.5): pausar/retomar/cancelar. Peak-End sem dark pattern
 * — cancelar exige confirmação, mas está sempre a um toque. `subscription-api`, `next/navigation`
 * e `env` mockados.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const manageSubscription = vi.fn();
const refresh = vi.fn();

vi.mock('@/lib/env', () => ({ isAnalyticsEnabled: false }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/subscription-api', () => ({
  manageSubscription: (...args: unknown[]) => manageSubscription(...args),
}));

import { ManageSubscription } from './manage-subscription';

const TOKEN = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  manageSubscription.mockReset();
  manageSubscription.mockResolvedValue({ status: 'OK' });
  refresh.mockReset();
});

describe('ManageSubscription', () => {
  it('ACTIVE: oferece pausar e cancelar', () => {
    render(<ManageSubscription token={TOKEN} status="ACTIVE" />);
    expect(screen.getByRole('button', { name: /Pausar/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancelar assinatura/ })).toBeInTheDocument();
  });

  it('cancelar pede confirmação e então chama a API', async () => {
    const user = userEvent.setup();
    render(<ManageSubscription token={TOKEN} status="ACTIVE" />);
    await user.click(screen.getByRole('button', { name: /Cancelar assinatura/ }));
    // Confirmação (Peak-End: oferece pausa em vez disso).
    await user.click(screen.getByRole('button', { name: /Sim, cancelar/ }));
    await waitFor(() => expect(manageSubscription).toHaveBeenCalledWith(TOKEN, 'cancel'));
    expect(refresh).toHaveBeenCalled();
  });

  it('pausar chama a API com a ação pause', async () => {
    const user = userEvent.setup();
    render(<ManageSubscription token={TOKEN} status="ACTIVE" />);
    await user.click(screen.getByRole('button', { name: /Pausar/ }));
    await waitFor(() => expect(manageSubscription).toHaveBeenCalledWith(TOKEN, 'pause'));
  });

  it('PAUSED: oferece retomar', async () => {
    const user = userEvent.setup();
    render(<ManageSubscription token={TOKEN} status="PAUSED" />);
    await user.click(screen.getByRole('button', { name: /Retomar/ }));
    await waitFor(() => expect(manageSubscription).toHaveBeenCalledWith(TOKEN, 'resume'));
  });

  it('mostra erro quando a ação falha', async () => {
    manageSubscription.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    render(<ManageSubscription token={TOKEN} status="PAUSED" />);
    await user.click(screen.getByRole('button', { name: /Retomar/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
