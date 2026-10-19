import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { QueueDetail } from '@/lib/dashboard-types';

const api = vi.hoisted(() => ({
  getQueueDetail: vi.fn(),
  resolveHandoff: vi.fn(),
  markNotificationRead: vi.fn(),
  captureDashboardEvent: vi.fn(),
}));
vi.mock('@/lib/dashboard-api', () => ({
  DashboardApiError: class DashboardApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
  ...api,
}));

import { DashboardApiError } from '@/lib/dashboard-api';

import { AlertDetail } from './alert-detail';

const ALERT_ID = '33333333-3333-4333-8333-333333333333';

function detail(overrides: Partial<NonNullable<QueueDetail['handoff']>> = {}, extra = {}) {
  return {
    item: {
      id: ALERT_ID,
      kind: 'HANDOFF',
      severity: 'ALERT',
      createdAt: '2026-10-12T14:30:00.000Z',
      ageMinutes: 5,
      title: 'Conversa requer atencao',
      summary: 'FORA_DE_ESCOPO',
      status: 'OPEN',
      autoReleaseAt: null,
      origin: null,
      read: false,
    },
    context: {},
    handoff: {
      reason: 'FORA_DE_ESCOPO',
      level: 'ALERT',
      status: 'OPEN',
      studentId: 'student-1',
      studentName: 'Ana Souza',
      sourceType: null,
      sourceId: null,
      createdAt: '2026-10-12T14:30:00.000Z',
      updatedAt: '2026-10-12T14:30:00.000Z',
      trigger: {
        content: 'Posso falar de investimentos com o AI Coach?',
        createdAt: '2026-10-12T14:29:00.000Z',
        direction: 'INBOUND',
      },
      ...overrides,
    },
    replay: {
      conversationId: 'c1',
      startedAt: '2026-10-12T14:00:00.000Z',
      studentName: 'Ana Souza',
      messages: [
        { role: 'USER', content: 'Oi', createdAt: '2026-10-12T14:00:00.000Z' },
        { role: 'ASSISTANT', content: 'Olá!', createdAt: '2026-10-12T14:00:10.000Z' },
      ],
    },
    ...extra,
  } as QueueDetail;
}

describe('AlertDetail', () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    api.markNotificationRead.mockResolvedValue(undefined);
    api.resolveHandoff.mockResolvedValue({ status: 'RESOLVED' });
  });

  it('mostra o que gerou o alerta, o aluno e registra a leitura ao carregar', async () => {
    api.getQueueDetail.mockResolvedValue(detail());
    render(<AlertDetail id={ALERT_ID} />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Assunto fora do escopo do AI Coach' }),
    ).toBeVisible();
    expect(screen.getByText('Posso falar de investimentos com o AI Coach?')).toBeVisible();
    expect(screen.getByText('Mensagem do aluno')).toBeVisible();
    expect(screen.getByText('Pendente')).toBeVisible();
    expect(screen.getByText('Ana Souza', { selector: 'dd' })).toBeVisible();
    expect(screen.getByRole('link', { name: /abrir conversa com o aluno/i })).toHaveAttribute(
      'href',
      '/dashboard/conversas?aluno=student-1',
    );
    expect(screen.getByRole('link', { name: /ver perfil do aluno/i })).toHaveAttribute(
      'href',
      '/dashboard/alunos/student-1',
    );
    expect(screen.getByRole('link', { name: /voltar para alertas/i })).toHaveAttribute(
      'href',
      '/dashboard/alertas',
    );
    await waitFor(() => expect(api.markNotificationRead).toHaveBeenCalledWith('alert', ALERT_ID));
  });

  it('avisa que a mensagem de origem não está disponível, sem inventar outra', async () => {
    api.getQueueDetail.mockResolvedValue(detail({ trigger: null }));
    render(<AlertDetail id={ALERT_ID} />);
    expect(
      await screen.findByText('A mensagem de origem não está disponível para este alerta.'),
    ).toBeVisible();
    expect(screen.queryByText('Mensagem do aluno')).not.toBeInTheDocument();
  });

  it('em alerta de treino explica a origem e mostra o contexto, sem mensagem de conversa', async () => {
    api.getQueueDetail.mockResolvedValue(
      detail(
        { sourceType: 'WORKOUT', reason: 'DOR_APOS_TREINO', level: 'SAFETY', trigger: null },
        {
          context: {
            sessionKey: 'A',
            scheduledDate: '2026-10-12',
            durationSeconds: 2520,
            perceivedEffort: 7,
            painExercises: 'Agachamento livre, Leg press',
            painNotes: 'Dor no joelho direito ao descer',
          },
        },
      ),
    );
    render(<AlertDetail id={ALERT_ID} />);

    expect(
      await screen.findByText('Gerado a partir do registro de treino do aluno.'),
    ).toBeVisible();
    expect(screen.getByText('42 min')).toBeVisible();
    expect(screen.getByText('7 de 10')).toBeVisible();
    expect(screen.getByText('Agachamento livre, Leg press')).toBeVisible();
    expect(screen.getByText('Dor no joelho direito ao descer')).toBeVisible();
    expect(screen.queryByText('Como o aluno se sentiu')).not.toBeInTheDocument();
    expect(screen.queryByText(/mensagem de origem não está disponível/)).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(
      'Prioridade de segurança: fale com o aluno antes de qualquer nova orientação de treino.',
    );
  });

  it('em alerta de check-in mostra a semana, o envio e as respostas do aluno', async () => {
    const checkin = detail(
      {},
      {
        context: {
          weekNumber: 3,
          completedAt: '2026-10-12T10:00:00.000Z',
          responses: JSON.stringify({ sleepQuality: 'BOA', nested: { x: 1 }, skipped: null }),
        },
      },
    );
    api.getQueueDetail.mockImplementation(async (kind: string) =>
      kind === 'CHECKIN'
        ? checkin
        : detail({ sourceType: 'CHECKIN', trigger: null, reason: 'CHECKIN_DOR_ARTICULAR' }),
    );
    render(<AlertDetail id={ALERT_ID} />);

    expect(await screen.findByText('Semana 3')).toBeVisible();
    expect(screen.getByText('sleep Quality')).toBeVisible();
    expect(screen.getByText('BOA')).toBeVisible();
    expect(screen.queryByText('nested')).not.toBeInTheDocument();
    expect(screen.getByText('Gerado a partir do check-in semanal.')).toBeVisible();
  });

  it('segue sem o contexto do check-in quando as respostas não carregam', async () => {
    api.getQueueDetail.mockImplementation(async (kind: string) => {
      if (kind === 'CHECKIN') throw new Error('indisponível');
      return detail({ sourceType: 'CHECKIN', trigger: null });
    });
    render(<AlertDetail id={ALERT_ID} />);

    expect(await screen.findByText('Gerado a partir do check-in semanal.')).toBeVisible();
    expect(screen.queryByText('Contexto da origem')).not.toBeInTheDocument();
  });

  it('exige motivo e observações e resolve sem sair da tela', async () => {
    api.getQueueDetail.mockResolvedValue(detail());
    render(<AlertDetail id={ALERT_ID} />);
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByRole('button', { name: 'Marcar como resolvido' })).toBeDisabled();
    expect(screen.getByText('Escolha um motivo.')).toBeVisible();
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();

    await userEvent.click(screen.getByRole('radio', { name: 'Sem necessidade de intervenção' }));
    await userEvent.type(screen.getByLabelText('Observações'), 'Pergunta fora do escopo.');
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como resolvido' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar resolução' }));

    await waitFor(() =>
      expect(api.resolveHandoff).toHaveBeenCalledWith(
        ALERT_ID,
        'Sem necessidade de intervenção',
        'Pergunta fora do escopo.',
      ),
    );
    expect(await screen.findByText('Alerta resolvido e registrado na auditoria.')).toBeVisible();
    expect(screen.getByText('Resolvido')).toBeVisible();
    expect(screen.getByText(/O registro da resolução está na trilha de auditoria/)).toBeVisible();
  });

  it('aceita um motivo próprio quando escolhe "Outro"', async () => {
    api.getQueueDetail.mockResolvedValue(detail());
    render(<AlertDetail id={ALERT_ID} />);
    await screen.findByRole('heading', { level: 1 });

    await userEvent.click(screen.getByRole('radio', { name: 'Outro' }));
    await userEvent.type(screen.getByLabelText('Descreva o motivo'), 'Encaminhado ao RT');
    await userEvent.type(screen.getByLabelText('Observações'), 'Conversei por ligação.');
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como resolvido' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar resolução' }));

    await waitFor(() =>
      expect(api.resolveHandoff).toHaveBeenCalledWith(
        ALERT_ID,
        'Encaminhado ao RT',
        'Conversei por ligação.',
      ),
    );
  });

  it('mantém as anotações e mostra o erro quando a resolução falha', async () => {
    api.getQueueDetail.mockResolvedValue(detail());
    api.resolveHandoff.mockRejectedValue(new Error('offline'));
    render(<AlertDetail id={ALERT_ID} />);
    await screen.findByRole('heading', { level: 1 });

    await userEvent.click(screen.getByRole('radio', { name: 'Sem necessidade de intervenção' }));
    await userEvent.type(screen.getByLabelText('Observações'), 'Anotação importante.');
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como resolvido' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar resolução' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível registrar a resolução. Suas anotações foram mantidas; tente novamente.',
    );
    expect(screen.getByLabelText('Observações')).toHaveValue('Anotação importante.');
  });

  it('alerta já resolvido mostra a data e remove o formulário', async () => {
    api.getQueueDetail.mockResolvedValue(
      detail({ status: 'RESOLVED', updatedAt: '2026-10-12T18:02:00.000Z' }),
    );
    render(<AlertDetail id={ALERT_ID} />);
    expect(await screen.findByText(/Resolvido em/)).toBeVisible();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Marcar como resolvido' })).not.toBeInTheDocument();
  });

  it('trata alerta inexistente sem registrar leitura', async () => {
    api.getQueueDetail.mockRejectedValue(new DashboardApiError(404, 'Alerta de atendimento não encontrado.'));
    render(<AlertDetail id={ALERT_ID} />);
    expect(await screen.findByRole('heading', { name: 'Alerta não encontrado' })).toBeVisible();
    expect(api.markNotificationRead).not.toHaveBeenCalled();
  });

  it('oferece nova tentativa quando o carregamento falha e só então registra a leitura', async () => {
    api.getQueueDetail
      .mockRejectedValueOnce(new Error('Sem conexão'))
      .mockResolvedValueOnce(detail());
    render(<AlertDetail id={ALERT_ID} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão');
    expect(api.markNotificationRead).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(api.markNotificationRead).toHaveBeenCalledTimes(1));
  });
});
