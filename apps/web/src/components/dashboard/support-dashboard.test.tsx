import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { supportResponse } from '../../../test/control-center-fixtures';

const { getSupportSummary } = vi.hoisted(() => ({ getSupportSummary: vi.fn() }));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/control-center-api')>()),
  getSupportSummary,
}));

import { ControlCenterApiError } from '@/lib/control-center-api';

import { SupportDashboard } from './support-dashboard';

beforeEach(() => getSupportSummary.mockReset());

describe('SupportDashboard', () => {
  it('mostra contatos de atendimento sem expor dado de saúde', async () => {
    getSupportSummary.mockResolvedValue(supportResponse);
    render(<SupportDashboard />);
    expect(await screen.findByRole('heading', { name: 'Suporte' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Ana Souza' })).toBeVisible();
    expect(screen.getByText('ana@teste.com')).toBeVisible();
    expect(screen.getByText('+5511999990001')).toBeVisible();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText(/PAR-Q/)).not.toBeInTheDocument();
  });

  it('rotula contato incompleto como não informado', async () => {
    getSupportSummary.mockResolvedValue(supportResponse);
    render(<SupportDashboard />);
    expect(await screen.findByRole('heading', { name: 'Não informado' })).toBeVisible();
    expect(screen.getAllByText('Não informado').length).toBeGreaterThanOrEqual(3);
  });

  it('mostra o vazio quando não há cliente no escopo de suporte', async () => {
    getSupportSummary.mockResolvedValue({ ...supportResponse, data: { customers: [] } });
    render(<SupportDashboard />);
    expect(await screen.findByRole('heading', { name: 'Nenhum contato disponível' })).toBeVisible();
  });

  it('em 403 não oferece nova tentativa', async () => {
    getSupportSummary.mockRejectedValueOnce(
      new ControlCenterApiError(403, 'Sem acesso ao suporte.'),
    );
    render(<SupportDashboard />);
    expect(
      await screen.findByRole('heading', { name: 'Este setor não faz parte do seu acesso' }),
    ).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('avisa falha de atualização preservando a lista anterior', async () => {
    getSupportSummary
      .mockResolvedValueOnce(supportResponse)
      .mockRejectedValueOnce(new ControlCenterApiError(500, 'Servidor indisponível.'));
    render(<SupportDashboard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Atualizar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Servidor indisponível.');
    expect(screen.getByRole('heading', { name: 'Ana Souza' })).toBeVisible();
  });
});
