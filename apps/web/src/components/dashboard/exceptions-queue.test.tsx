import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExceptionListItem } from '@movivo/shared';

import type * as ControlCenterApi from '@/lib/control-center-api';

const { getExceptions } = vi.hoisted(() => ({ getExceptions: vi.fn() }));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getExceptions,
}));

import { ExceptionsQueue } from './exceptions-queue';

const item = (over: Partial<ExceptionListItem> = {}): ExceptionListItem => ({
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'SAFETY',
  priority: 'URGENT',
  status: 'OPEN',
  domain: 'MEDICAL',
  summary: 'Sinal de segurança: CHEST_PAIN (EMERGENCY).',
  createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  assignedStaffId: null,
  reviewUrgency: null,
  autoReleaseAt: null,
  studentId: '22222222-2222-4222-8222-222222222222',
  studentName: 'Ana Souza',
  canResolve: true,
  ...over,
});

beforeEach(() => getExceptions.mockReset());

describe('ExceptionsQueue', () => {
  it('Alertas lista os casos abertos com tipo, prioridade, domínio e idade, com link para o caso', async () => {
    getExceptions.mockResolvedValue([item()]);
    render(<ExceptionsQueue scope="ALERTS" />);

    const link = await screen.findByRole('link', { name: /Ana Souza/ });
    expect(link).toHaveAttribute('href', '/dashboard/alertas/11111111-1111-4111-8111-111111111111');
    expect(link).toHaveTextContent('Sinal de segurança');
    expect(link).toHaveTextContent('Urgente');
    expect(link).toHaveTextContent('Médico');
    expect(link).toHaveTextContent('há 3 h');
    expect(getExceptions).toHaveBeenCalledWith('OPEN', 'ALERTS', expect.anything());
    expect(screen.queryByRole('region', { name: 'Revisão humana obrigatória' })).toBeNull();
  });

  it('avisa quando o caso é somente leitura para o papel', async () => {
    getExceptions.mockResolvedValue([item({ canResolve: false })]);
    render(<ExceptionsQueue scope="ALERTS" />);
    expect(await screen.findByText('Somente leitura para o seu papel.')).toBeVisible();
  });

  it('a Fila não tem abas: pede só o que está em aberto', async () => {
    getExceptions.mockResolvedValue([]);
    render(<ExceptionsQueue scope="QUEUE" />);
    expect(await screen.findByText(/Nenhum item na fila no seu domínio/)).toBeVisible();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(getExceptions).toHaveBeenCalledWith(undefined, 'QUEUE', expect.anything());
  });

  it('Alertas mantém as abas e troca de aba pedindo outra situação', async () => {
    getExceptions.mockResolvedValue([]);
    render(<ExceptionsQueue scope="ALERTS" />);
    expect(await screen.findByText(/Nenhum alerta no seu domínio/)).toBeVisible();

    await userEvent.click(screen.getByRole('tab', { name: 'Resolvidos' }));

    await waitFor(() =>
      expect(getExceptions).toHaveBeenLastCalledWith('RESOLVED', 'ALERTS', expect.anything()),
    );
    expect(await screen.findByText(/Nenhum caso resolvido no seu domínio/)).toBeVisible();
  });

  it('separa a revisão obrigatória da opcional e mostra o prazo do envio automático', async () => {
    getExceptions.mockResolvedValue([
      item({
        id: '33333333-3333-4333-8333-333333333333',
        kind: 'PROTOCOL_REVIEW',
        priority: 'HIGH',
        domain: 'TRAINING',
        studentName: 'Bruno Lima',
        reviewUrgency: 'MANDATORY',
      }),
      item({
        id: '44444444-4444-4444-8444-444444444444',
        kind: 'PROTOCOL_REVIEW',
        priority: 'NORMAL',
        domain: 'NUTRITION',
        studentName: 'Carla Dias',
        reviewUrgency: 'OPTIONAL',
        autoReleaseAt: new Date(Date.now() + 72 * 60_000).toISOString(),
      }),
    ]);
    render(<ExceptionsQueue scope="QUEUE" />);

    const mandatory = await screen.findByRole('region', { name: 'Revisão humana obrigatória' });
    const optional = screen.getByRole('region', { name: 'Revisão humana opcional' });
    expect(within(mandatory).getByRole('link', { name: /Bruno Lima/ })).toHaveTextContent(
      'Revisão obrigatória',
    );
    expect(within(mandatory).queryByText(/Carla Dias/)).toBeNull();
    const carla = within(optional).getByRole('link', { name: /Carla Dias/ });
    expect(carla).toHaveAttribute('href', '/dashboard/fila/44444444-4444-4444-8444-444444444444');
    expect(carla).toHaveTextContent('Envio automático em 1 h 12 min');
    expect(within(optional).queryByText(/Bruno Lima/)).toBeNull();
  });

  it('na Fila, o caso sem urgência de revisão (geração que falhou) fica na obrigatória', async () => {
    getExceptions.mockResolvedValue([item({ kind: 'DECISION_FAILURE', domain: 'TRAINING' })]);
    render(<ExceptionsQueue scope="QUEUE" />);
    const mandatory = await screen.findByRole('region', { name: 'Revisão humana obrigatória' });
    expect(within(mandatory).getByRole('link', { name: /Ana Souza/ })).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Revisão humana opcional' })).getByText(
        /Nada aguardando a janela de revisão/,
      ),
    ).toBeVisible();
  });
});
