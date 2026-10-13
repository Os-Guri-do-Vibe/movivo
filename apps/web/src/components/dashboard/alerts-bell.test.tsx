import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getAlerts: vi.fn(),
  getAlertsSummary: vi.fn(),
  getQueue: vi.fn(),
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
    api.getQueue.mockResolvedValue({
      mandatory: [],
      optional: [],
      substitutionMandatory: [],
      substitutionOptional: [],
      counts: {
        mandatory: 0,
        optional: 0,
        substitutionMandatory: 0,
        substitutionOptional: 0,
        total: 0,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('abre um popover com a notificação acionável, sem navegar ao clicar no sino', async () => {
    render(<AlertsBell />);

    const bell = await screen.findByRole('button', { name: 'Notificações: 1 pendência' });
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

    await userEvent.click(
      await screen.findByRole('button', { name: 'Notificações: nenhuma pendente' }),
    );
    expect(await screen.findByText('Nenhuma notificação pendente.')).toBeVisible();
  });

  it('agrega os itens pendentes da fila às notificações', async () => {
    api.getQueue.mockResolvedValue({
      mandatory: [
        {
          id: 'protocol-1',
          kind: 'PROTOCOL',
          severity: 'ALERT',
          createdAt: '2026-10-12T15:00:00.000Z',
          ageMinutes: 2,
          title: 'Protocolo para Revisão: Ana',
          summary: 'PENDING_SIGNATURE',
          status: 'PENDING_SIGNATURE',
          autoReleaseAt: null,
          origin: null,
        },
      ],
      optional: [],
      substitutionMandatory: [],
      substitutionOptional: [],
      counts: {
        mandatory: 1,
        optional: 0,
        substitutionMandatory: 0,
        substitutionOptional: 0,
        total: 1,
      },
    });
    render(<AlertsBell />);

    await userEvent.click(
      await screen.findByRole('button', { name: 'Notificações: 2 pendências' }),
    );
    expect(await screen.findByText('Protocolo para Revisão: Ana')).toBeVisible();
    expect(screen.getByRole('link', { name: /protocolo para revisão: ana/i })).toHaveAttribute(
      'href',
      '/dashboard/fila/protocol/protocol-1',
    );
  });
});
