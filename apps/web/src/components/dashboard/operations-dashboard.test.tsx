import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { operationsResponse } from '../../../test/dashboard-fixtures';

const { getOperations } = vi.hoisted(() => ({ getOperations: vi.fn() }));
vi.mock('@/lib/dashboard-api', () => ({ getOperations }));

import { OperationsDashboard } from './operations-dashboard';

beforeEach(() => getOperations.mockReset());

describe('OperationsDashboard', () => {
  it('renderiza funil, SLA textual e replay já anonimizado', async () => {
    getOperations.mockResolvedValue(operationsResponse);
    render(<OperationsDashboard />);
    expect(await screen.findByRole('heading', { name: 'Operações' })).toBeVisible();
    expect(screen.getByText('Atenção · SLA excedido')).toBeVisible();
    expect(screen.getByText('Dentro da meta')).toBeVisible();
    expect(screen.getByLabelText(/Conversão: 22, 22%/)).toHaveAttribute('value', '22');
    expect(screen.getByText('[PESSOA] relatou dificuldade.')).toBeVisible();
  });

  it('mostra vazio de replays e recupera de erro', async () => {
    getOperations
      .mockRejectedValueOnce(new Error('Falha de métricas'))
      .mockResolvedValueOnce({ ...operationsResponse, replays: [] });
    render(<OperationsDashboard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha de métricas');
    await userEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(await screen.findByText('Nenhum replay disponível')).toBeVisible();
  });

  it('explicita métricas sem amostra sem exibir sucesso ou zero inventado', async () => {
    getOperations.mockResolvedValue({
      ...operationsResponse,
      funnel: { ...operationsResponse.funnel, firstWorkout: null },
      sla: { ...operationsResponse.sla, coachP95Seconds: null, coachBreached: false },
    });
    render(<OperationsDashboard />);
    expect(await screen.findByText('Sem amostra suficiente')).toBeVisible();
    expect(
      screen.getByLabelText('Primeiro treino reportado: métrica ainda indisponível'),
    ).toHaveAttribute('value', '0');
  });
});
