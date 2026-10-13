import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DashboardAlert } from '@/lib/dashboard-types';

const api = vi.hoisted(() => ({ getAlerts: vi.fn() }));
vi.mock('@/lib/dashboard-api', () => api);

class MockEventSource {
  constructor(readonly url: string) {}

  addEventListener = vi.fn();
  close = vi.fn();
}

import { AlertsBoard } from './alerts-board';

function alert(overrides: Partial<DashboardAlert> = {}): DashboardAlert {
  return {
    id: 'alert-1',
    studentName: 'Ana',
    level: 'ALERT',
    reason: 'FORA_DE_ESCOPO',
    sourceType: null,
    status: 'OPEN',
    createdAt: '2026-10-12T14:30:00.000Z',
    updatedAt: '2026-10-12T14:30:00.000Z',
    read: false,
    ...overrides,
  };
}

describe('AlertsBoard', () => {
  beforeEach(() => vi.stubGlobal('EventSource', MockEventSource));
  afterEach(() => {
    vi.unstubAllGlobals();
    api.getAlerts.mockReset();
  });

  it('lista os pendentes com o indicador de não lido e o link para o alerta', async () => {
    api.getAlerts.mockResolvedValue({
      open: [
        alert(),
        alert({
          id: 'alert-2',
          level: 'SAFETY',
          reason: 'RED_FLAG',
          read: true,
          studentName: null,
        }),
      ],
      resolved: [],
    });
    render(<AlertsBoard />);

    expect(await screen.findByRole('link', { name: /assunto fora do escopo/i })).toHaveAttribute(
      'href',
      '/dashboard/alertas/alert-1',
    );
    expect(screen.getByText('Não lido.')).toBeInTheDocument();
    expect(screen.getAllByText('Não lido.')).toHaveLength(1);
    expect(screen.getByText('Aluno não identificado')).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Pendentes (2)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('mostra os resolvidos com a data da resolução e sem marca de não lido', async () => {
    api.getAlerts.mockResolvedValue({
      open: [],
      resolved: [alert({ status: 'RESOLVED', sourceType: 'WORKOUT' })],
    });
    render(<AlertsBoard />);

    await userEvent.click(await screen.findByRole('tab', { name: 'Resolvidos (1)' }));
    expect(await screen.findByText(/Resolvido em/)).toBeVisible();
    expect(screen.getByText(/Treino/)).toBeVisible();
    expect(screen.queryByText('Não lido.')).not.toBeInTheDocument();
  });

  it('mostra o estado vazio de cada aba', async () => {
    api.getAlerts.mockResolvedValue({ open: [], resolved: [] });
    render(<AlertsBoard />);

    expect(await screen.findByText('Nenhum alerta pendente')).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: 'Resolvidos (0)' }));
    expect(screen.getByText('Nenhum alerta resolvido ainda')).toBeVisible();
  });

  it('mostra o erro e permite tentar de novo', async () => {
    api.getAlerts
      .mockRejectedValueOnce(new Error('Sem conexão'))
      .mockResolvedValueOnce({ open: [alert()], resolved: [] });
    render(<AlertsBoard />);

    expect(await screen.findByText('Sem conexão')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /assunto fora do escopo/i })).toBeVisible(),
    );
  });
});
