import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHECKIN_ID,
  checkinItem,
  HANDOFF_ID,
  handoffItem,
  PARQ_ID,
  parqItem,
  protocolDetail,
  PROTOCOL_ID,
} from '../../../test/dashboard-fixtures';

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));

const api = vi.hoisted(() => ({
  getQueueDetail: vi.fn(),
  signProtocol: vi.fn(),
  releaseParq: vi.fn(),
  resolveHandoff: vi.fn(),
  saveProtocol: vi.fn(),
  captureDashboardEvent: vi.fn(),
}));
vi.mock('@/lib/dashboard-api', () => ({
  DashboardApiError: class DashboardApiError extends Error {},
  ...api,
}));

import { QueueDetail } from './queue-detail';

const parqDetail = {
  item: parqItem,
  context: { goal: 'Condicionamento' },
  parq: { flags: ['Resposta de risco Q2'], state: 'BLOCKED_PENDING_CLEARANCE' },
};

const handoffDetail = {
  item: handoffItem,
  context: { reason: 'Relato anonimizado que exige revisão.' },
  handoff: { reason: 'Relato anonimizado', level: 'SAFETY', status: 'OPEN' },
  replay: protocolDetail.replay,
};

const checkinDetail = {
  item: checkinItem,
  context: { checkinEffort: 'Dor relatada' },
  handoff: { reason: checkinItem.summary, level: 'SAFETY', status: 'OPEN' },
};

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  navigation.replace.mockReset();
  api.signProtocol.mockResolvedValue({ status: 'SIGNED' });
  api.releaseParq.mockResolvedValue({ status: 'RELEASED' });
  api.resolveHandoff.mockResolvedValue({ status: 'RESOLVED' });
});

describe('QueueDetail', () => {
  it('renderiza protocolo e exige confirmação para assinar', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    expect(await screen.findByRole('heading', { name: /Protocolo · versão 1/i })).toBeVisible();
    expect(screen.getByText('[PESSOA] relatou dificuldade.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Assinar protocolo' }));
    expect(api.signProtocol).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar e assinar' }));
    await waitFor(() => expect(api.signProtocol).toHaveBeenCalledWith(PROTOCOL_ID));
    expect(await screen.findByRole('status')).toHaveTextContent('auditoria registrada');
  });

  it('libera PAR-Q somente após a decisão humana confirmada', async () => {
    api.getQueueDetail.mockResolvedValue(parqDetail);
    render(<QueueDetail kind="PARQ" id={PARQ_ID} />);
    expect(await screen.findByText('Resposta de risco Q2')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Registrar liberação' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/registro profissional/i), 'Revisão concluída.');
    expect(screen.getByRole('button', { name: 'Registrar liberação' })).toBeDisabled();
    await userEvent.selectOptions(
      screen.getByLabelText('Decisão'),
      'Liberar após revisão profissional',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Registrar liberação' }));
    expect(api.releaseParq).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar liberação' }));
    await waitFor(() =>
      expect(api.releaseParq).toHaveBeenCalledWith(PARQ_ID, 'Revisão concluída.'),
    );
  });

  it('registra a resolução de handoff SAFETY com confirmação', async () => {
    api.getQueueDetail.mockResolvedValue(handoffDetail);
    render(<QueueDetail kind="HANDOFF" id={HANDOFF_ID} />);
    expect(await screen.findByText('SEGURANÇA · PRIORIDADE')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Marcar como resolvido' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Observações'), 'Registro profissional.');
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como resolvido' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar resolução' }));
    await waitFor(() =>
      expect(api.resolveHandoff).toHaveBeenCalledWith(
        HANDOFF_ID,
        'Contato realizado e orientação registrada.',
        'Registro profissional.',
      ),
    );
    expect(navigation.replace).toHaveBeenCalledWith('/dashboard');
  });

  it('resolve sinalização de CHECKIN SAFETY pelo endpoint de handoff e atualiza a fila', async () => {
    api.getQueueDetail.mockResolvedValue(checkinDetail);
    render(<QueueDetail kind="CHECKIN" id={CHECKIN_ID} />);
    expect(await screen.findByText('SEGURANÇA · PRIORIDADE')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Resolver sinalização de check-in' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Resolver sinalização' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Observações'), 'Revisão profissional registrada.');
    await userEvent.click(screen.getByRole('button', { name: 'Resolver sinalização' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar resolução' }));
    await waitFor(() =>
      expect(api.resolveHandoff).toHaveBeenCalledWith(
        CHECKIN_ID,
        'Contato realizado e orientação registrada.',
        'Revisão profissional registrada.',
      ),
    );
    expect(navigation.replace).toHaveBeenCalledWith('/dashboard');
  });

  it('oferece recuperação quando o detalhe falha', async () => {
    api.getQueueDetail
      .mockRejectedValueOnce(new Error('Caso indisponível'))
      .mockResolvedValueOnce(protocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Caso indisponível');
    await userEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(await screen.findByText('Protocolo aguardando revisão')).toBeVisible();
  });
});
