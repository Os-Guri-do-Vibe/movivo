import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ControlCenterConversationMessagesResponse } from '@movivo/shared';

import type * as ControlCenterApi from '@/lib/control-center-api';

const { getConversations, getConversationMessages } = vi.hoisted(() => ({
  getConversations: vi.fn(),
  getConversationMessages: vi.fn(),
}));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getConversations,
  getConversationMessages,
}));

import { ControlCenterApiError } from '@/lib/control-center-api';

import { ConversationsDashboard } from './conversations-dashboard';

const META = {
  generatedAt: '2026-10-09T12:00:00.000Z',
  timezone: 'America/Sao_Paulo' as const,
  dataQuality: [],
};
const ANA = '11111111-1111-4111-8111-111111111111';
const BRUNO = '22222222-2222-4222-8222-222222222222';

const list = {
  data: {
    conversations: [
      {
        studentId: ANA,
        name: 'Ana Souza',
        phoneNumber: '+5511999990001',
        lastMessageAt: '2026-10-09T15:00:00.000Z',
      },
      {
        studentId: BRUNO,
        name: null,
        phoneNumber: '+5511999990002',
        lastMessageAt: '2026-10-01T15:00:00.000Z',
      },
    ],
  },
  meta: META,
};

const msg = (
  id: string,
  direction: 'INBOUND' | 'OUTBOUND',
  content: string,
  createdAt: string,
  messageType: 'TEXT' | 'AUDIO' = 'TEXT',
) => ({ id, direction, content, createdAt, messageType });

function history(
  messages: ControlCenterConversationMessagesResponse['data']['messages'],
  olderCursor: string | null = null,
): ControlCenterConversationMessagesResponse {
  return {
    data: {
      student: { id: ANA, name: 'Ana Souza', phoneNumber: '+5511999990001' },
      messages,
      olderCursor,
    },
    meta: META,
  };
}

beforeEach(() => {
  getConversations.mockReset();
  getConversationMessages.mockReset();
});

describe('ConversationsDashboard', () => {
  it('lista nome e número de cada aluno e usa o telefone quando não há nome', async () => {
    getConversations.mockResolvedValue(list);
    render(<ConversationsDashboard />);
    const items = within(await screen.findByRole('list', { name: 'Conversas' }));
    expect(items.getByText('Ana Souza')).toBeVisible();
    expect(items.getByText('+55 (11) 99999-0001')).toBeVisible();
    // Sem nome, o telefone vira o título (e aparece também como subtítulo).
    expect(items.getAllByText('+55 (11) 99999-0002').length).toBeGreaterThan(0);
    expect(screen.getByText('Selecione uma conversa')).toBeInTheDocument();
  });

  it('usa a foto do WhatsApp via rota same-origin', async () => {
    getConversations.mockResolvedValue(list);
    const { container } = render(<ConversationsDashboard />);
    await screen.findByRole('list', { name: 'Conversas' });
    const photo = container.querySelector(`img[src="/api/dashboard/conversations/${ANA}/photo"]`);
    expect(photo).not.toBeNull();
  });

  it('abre o chat: aluno à esquerda com o nome, MOVIVO à direita com o rótulo', async () => {
    getConversations.mockResolvedValue(list);
    getConversationMessages.mockResolvedValue(
      history([
        msg('m1', 'INBOUND', 'Posso trocar o agachamento?', '2026-10-09T15:00:00.000Z'),
        msg('m2', 'OUTBOUND', 'Pode sim, use a leg press.', '2026-10-09T15:01:00.000Z'),
      ]),
    );
    render(<ConversationsDashboard />);
    await userEvent.click(await screen.findByRole('button', { name: /Ana Souza/ }));

    const log = await screen.findByRole('log', { name: 'Mensagens' });
    await waitFor(() => expect(within(log).getByText('Pode sim, use a leg press.')).toBeVisible());
    expect(getConversationMessages).toHaveBeenCalledWith(ANA, undefined, expect.any(AbortSignal));

    const inbound = within(log).getByText('Posso trocar o agachamento?').closest('div')
      ?.parentElement as HTMLElement;
    expect(inbound).toHaveClass('items-start');
    expect(within(inbound).getByText('Ana Souza')).toBeInTheDocument();

    const outbound = within(log).getByText('Pode sim, use a leg press.').closest('div')
      ?.parentElement as HTMLElement;
    expect(outbound).toHaveClass('items-end');
    expect(within(outbound).getByText('MOVIVO')).toBeInTheDocument();
  });

  it('identifica o tipo de mídia e mostra separador de dia', async () => {
    getConversations.mockResolvedValue(list);
    getConversationMessages.mockResolvedValue(
      history([msg('m1', 'INBOUND', 'transcrição do áudio', '2026-09-01T15:00:00.000Z', 'AUDIO')]),
    );
    render(<ConversationsDashboard />);
    await userEvent.click(await screen.findByRole('button', { name: /Ana Souza/ }));
    const log = await screen.findByRole('log', { name: 'Mensagens' });
    await within(log).findByText('Áudio');
    expect(within(log).getByText('1 de setembro de 2026')).toBeInTheDocument();
  });

  it('carrega mensagens anteriores pelo cursor e as insere antes das atuais', async () => {
    getConversations.mockResolvedValue(list);
    getConversationMessages
      .mockResolvedValueOnce(
        history(
          [msg('m2', 'OUTBOUND', 'recente', '2026-10-09T15:00:00.000Z')],
          '2026-10-09T15:00:00.000Z',
        ),
      )
      .mockResolvedValueOnce(history([msg('m1', 'INBOUND', 'antiga', '2026-10-08T15:00:00.000Z')]));
    render(<ConversationsDashboard />);
    await userEvent.click(await screen.findByRole('button', { name: /Ana Souza/ }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Carregar mensagens anteriores' }),
    );

    expect(getConversationMessages).toHaveBeenLastCalledWith(ANA, '2026-10-09T15:00:00.000Z');
    const log = screen.getByRole('log', { name: 'Mensagens' });
    await within(log).findByText('antiga');
    const texts = within(log)
      .getAllByText(/^(antiga|recente)$/)
      .map((node) => node.textContent);
    expect(texts).toEqual(['antiga', 'recente']);
    expect(screen.queryByRole('button', { name: 'Carregar mensagens anteriores' })).toBeNull();
  });

  it('filtra a lista por nome ou número', async () => {
    getConversations.mockResolvedValue(list);
    render(<ConversationsDashboard />);
    await screen.findByRole('list', { name: 'Conversas' });
    await userEvent.type(screen.getByRole('searchbox'), '0002');
    const items = within(screen.getByRole('list', { name: 'Conversas' }));
    expect(items.queryByText('Ana Souza')).toBeNull();
    await userEvent.clear(screen.getByRole('searchbox'));
    await userEvent.type(screen.getByRole('searchbox'), 'ana');
    expect(screen.getByRole('list', { name: 'Conversas' })).toHaveTextContent('Ana Souza');
  });

  it('mostra erro da conversa sem derrubar a lista', async () => {
    getConversations.mockResolvedValue(list);
    getConversationMessages.mockRejectedValue(new ControlCenterApiError(500, 'Falhou feio.'));
    render(<ConversationsDashboard />);
    await userEvent.click(await screen.findByRole('button', { name: /Ana Souza/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Falhou feio.');
    expect(screen.getByRole('list', { name: 'Conversas' })).toBeInTheDocument();
  });

  it('trata lista vazia e acesso negado', async () => {
    getConversations.mockResolvedValueOnce({ data: { conversations: [] }, meta: META });
    const { unmount } = render(<ConversationsDashboard />);
    expect(await screen.findByText('Nenhuma conversa registrada ainda.')).toBeInTheDocument();
    unmount();

    getConversations.mockRejectedValueOnce(new ControlCenterApiError(403, 'Sem acesso.'));
    render(<ConversationsDashboard />);
    expect(await screen.findByText('Este setor não faz parte do seu acesso')).toBeInTheDocument();
  });
});
