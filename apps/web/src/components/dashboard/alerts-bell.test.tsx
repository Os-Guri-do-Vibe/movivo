import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getAlerts: vi.fn(),
  getAlertsSummary: vi.fn(),
}));

vi.mock('@/lib/dashboard-api', () => api);

class MockEventSource {
  constructor(readonly url: string) {}

  addEventListener = vi.fn();
  close = vi.fn();
}

import { AlertsBell } from './alerts-bell';

describe('AlertsBell', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource);
    api.getAlertsSummary.mockResolvedValue({ open: 1 });
    api.getAlerts.mockResolvedValue({
      open: [
        {
          id: 'alert-1',
          studentName: 'Ana',
          level: 'ALERT',
          reason: 'FORA_DE_ESCOPO',
          sourceType: 'CONVERSATION',
          status: 'OPEN',
          createdAt: '2026-10-12T14:30:00.000Z',
          updatedAt: '2026-10-12T14:30:00.000Z',
        },
      ],
      resolved: [],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('abre um popover com a notificação acionável, sem navegar ao clicar no sino', async () => {
    render(<AlertsBell />);

    const bell = await screen.findByRole('button', { name: 'Alertas: 1 pendente' });
    await userEvent.click(bell);

    const dialog = await screen.findByRole('dialog', { name: 'Notificações do AI Coach' });
    expect(api.getAlerts).toHaveBeenCalledOnce();
    expect(screen.getByText('Assunto fora do escopo do AI Coach')).toBeVisible();
    expect(
      screen.getByRole('link', { name: /assunto fora do escopo do ai coach/i }),
    ).toHaveAttribute('href', '/dashboard/alertas/alert-1');

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it('mostra o estado vazio quando não há intervenção pendente', async () => {
    api.getAlertsSummary.mockResolvedValue({ open: 0 });
    api.getAlerts.mockResolvedValue({ open: [], resolved: [] });
    render(<AlertsBell />);

    await userEvent.click(await screen.findByRole('button', { name: 'Alertas: nenhum pendente' }));
    expect(await screen.findByText('Nenhuma notificação pendente.')).toBeVisible();
  });
});
