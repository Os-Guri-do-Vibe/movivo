import { render, screen, waitFor } from '@testing-library/react';
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
  studentId: '22222222-2222-4222-8222-222222222222',
  studentName: 'Ana Souza',
  canResolve: true,
  ...over,
});

beforeEach(() => getExceptions.mockReset());

describe('ExceptionsQueue', () => {
  it('lista os casos abertos com tipo, prioridade, domínio e idade, com link para o caso', async () => {
    getExceptions.mockResolvedValue([item()]);
    render(<ExceptionsQueue />);

    const link = await screen.findByRole('link', { name: /Ana Souza/ });
    expect(link).toHaveAttribute('href', '/dashboard/fila/11111111-1111-4111-8111-111111111111');
    expect(link).toHaveTextContent('Sinal de segurança');
    expect(link).toHaveTextContent('Urgente');
    expect(link).toHaveTextContent('Médico');
    expect(link).toHaveTextContent('há 3 h');
    expect(getExceptions).toHaveBeenCalledWith('OPEN', expect.anything());
  });

  it('avisa quando o caso é somente leitura para o papel', async () => {
    getExceptions.mockResolvedValue([item({ canResolve: false })]);
    render(<ExceptionsQueue />);
    expect(await screen.findByText('Somente leitura para o seu papel.')).toBeVisible();
  });

  it('mostra o vazio por domínio e troca de aba pedindo outra situação', async () => {
    getExceptions.mockResolvedValue([]);
    render(<ExceptionsQueue />);
    expect(await screen.findByText(/Nenhum caso em aberto no seu domínio/)).toBeVisible();

    await userEvent.click(screen.getByRole('tab', { name: 'Resolvidos' }));

    await waitFor(() =>
      expect(getExceptions).toHaveBeenLastCalledWith('RESOLVED', expect.anything()),
    );
    expect(await screen.findByText(/Nenhum caso resolvido no seu domínio/)).toBeVisible();
  });
});
