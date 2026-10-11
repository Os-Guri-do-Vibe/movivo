import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ControlCenterConversationMessagesResponse } from '@movivo/shared';

import type * as ControlCenterApi from '@/lib/control-center-api';

const {
  getConversations,
  getConversationMessages,
  getNewerConversationMessages,
  markConversationRead,
  setConversationAiPaused,
  sendConversationMessage,
} = vi.hoisted(() => ({
  getConversations: vi.fn(),
  getConversationMessages: vi.fn(),
  getNewerConversationMessages: vi.fn(),
  markConversationRead: vi.fn(),
  setConversationAiPaused: vi.fn(),
  sendConversationMessage: vi.fn(),
}));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getConversations,
  getConversationMessages,
  getNewerConversationMessages,
  markConversationRead,
  setConversationAiPaused,
  sendConversationMessage,
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
        aiPaused: false,
        unreadCount: 0,
      },
      {
        studentId: BRUNO,
        name: null,
        phoneNumber: '+5511999990002',
        lastMessageAt: '2026-10-01T15:00:00.000Z',
        aiPaused: true,
        unreadCount: 0,
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
  getNewerConversationMessages.mockReset();
  markConversationRead.mockReset();
  markConversationRead.mockImplementation(async (studentId: string) => ({
    data: { studentId, unreadCount: 0 },
    meta: META,
  }));
  setConversationAiPaused.mockReset();
  sendConversationMessage.mockReset();
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

describe('ConversationsDashboard — atendimento manual', () => {
  const openAna = async () => {
    getConversations.mockResolvedValue(list);
    getConversationMessages.mockResolvedValue(
      history([msg('m1', 'INBOUND', 'Oi!', '2026-10-09T15:00:00.000Z')]),
    );
    render(<ConversationsDashboard />);
    await userEvent.click(await screen.findByRole('button', { name: /Ana Souza/ }));
    await screen.findByRole('log', { name: 'Mensagens' });
  };

  it('a borda do aluno na lista é verde com o AI Coach ativo e vermelha com ele pausado', async () => {
    getConversations.mockResolvedValue(list);
    render(<ConversationsDashboard />);
    const ana = await screen.findByRole('button', { name: /Ana Souza/ });
    const bruno = await screen.findByRole('button', { name: /\+55 \(11\) 99999-0002/ });

    expect(ana).toHaveClass('border-emerald-600');
    expect(ana).not.toHaveClass('border-red-600');
    expect(ana).toHaveTextContent('Atendimento automático ativo.');
    expect(bruno).toHaveClass('border-red-600');
    expect(bruno).not.toHaveClass('border-emerald-600');
    expect(bruno).toHaveTextContent('Atendimento automático pausado.');
  });

  it('com o AI Coach ativo: campo desabilitado e botão "Pausar" (vermelho, ícone de pausa)', async () => {
    await openAna();
    const input = screen.getByRole('textbox', { name: /Mensagem para Ana Souza/ });
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('placeholder', 'Pause o atendimento automático para escrever');
    expect(screen.getByRole('button', { name: 'Enviar mensagem' })).toBeDisabled();

    const toggle = screen.getByRole('button', {
      name: 'Pausar o atendimento automático do AI Coach',
    });
    expect(toggle).toHaveTextContent('Pausar');
    expect(toggle).toHaveClass('bg-red-600');
    expect(toggle.querySelector('svg.lucide-pause')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Ativar o atendimento/ })).toBeNull();
  });

  it('com o AI Coach pausado: campo habilitado e botão "Ativar" (verde, ícone de play)', async () => {
    getConversations.mockResolvedValue(list);
    getConversationMessages.mockResolvedValue(history([]));
    render(<ConversationsDashboard />);
    await userEvent.click(await screen.findByRole('button', { name: /\+55 \(11\) 99999-0002/ }));

    const input = await screen.findByRole('textbox', { name: /Mensagem para/ });
    expect(input).toBeEnabled();
    const toggle = screen.getByRole('button', {
      name: 'Ativar o atendimento automático do AI Coach',
    });
    expect(toggle).toHaveTextContent('Ativar');
    expect(toggle).toHaveClass('bg-emerald-700');
    expect(toggle.querySelector('svg.lucide-play')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Pausar o atendimento/ })).toBeNull();
  });

  it('clicar em "Pausar" pausa no servidor, habilita o campo, troca o botão e pinta a borda de vermelho', async () => {
    setConversationAiPaused.mockResolvedValue({
      data: { studentId: ANA, aiPaused: true },
      meta: META,
    });
    await openAna();

    await userEvent.click(
      screen.getByRole('button', { name: 'Pausar o atendimento automático do AI Coach' }),
    );

    expect(setConversationAiPaused).toHaveBeenCalledWith(ANA, true);
    expect(
      await screen.findByRole('button', { name: 'Ativar o atendimento automático do AI Coach' }),
    ).toHaveClass('bg-emerald-700');
    expect(screen.getByRole('textbox', { name: /Mensagem para Ana Souza/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Ana Souza/ })).toHaveClass('border-red-600');
  });

  it('clicar em "Ativar" reativa o AI Coach, trava o campo e volta a borda para verde', async () => {
    setConversationAiPaused.mockResolvedValue({
      data: { studentId: ANA, aiPaused: false },
      meta: META,
    });
    getConversations.mockResolvedValue({
      ...list,
      data: { conversations: list.data.conversations.map((item) => ({ ...item, aiPaused: true })) },
    });
    getConversationMessages.mockResolvedValue(history([]));
    render(<ConversationsDashboard />);
    await userEvent.click(await screen.findByRole('button', { name: /Ana Souza/ }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Ativar o atendimento automático do AI Coach' }),
    );

    expect(setConversationAiPaused).toHaveBeenCalledWith(ANA, false);
    await screen.findByRole('button', { name: 'Pausar o atendimento automático do AI Coach' });
    expect(screen.getByRole('textbox', { name: /Mensagem para Ana Souza/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Ana Souza/ })).toHaveClass('border-emerald-600');
  });

  it('envia a mensagem (Enter), mostra no histórico e limpa o campo', async () => {
    setConversationAiPaused.mockResolvedValue({
      data: { studentId: ANA, aiPaused: true },
      meta: META,
    });
    sendConversationMessage.mockResolvedValue({
      data: {
        message: msg('m9', 'OUTBOUND', 'Oi, Ana! Como foi o treino?', '2026-10-10T12:00:00.000Z'),
      },
      meta: META,
    });
    await openAna();
    await userEvent.click(
      screen.getByRole('button', { name: 'Pausar o atendimento automático do AI Coach' }),
    );
    const input = await screen.findByRole('textbox', { name: /Mensagem para Ana Souza/ });

    await userEvent.type(input, '  Oi, Ana! Como foi o treino?{Enter}');

    expect(sendConversationMessage).toHaveBeenCalledWith(ANA, 'Oi, Ana! Como foi o treino?');
    const log = screen.getByRole('log', { name: 'Mensagens' });
    expect(await within(log).findByText('Oi, Ana! Como foi o treino?')).toBeVisible();
    expect(input).toHaveValue('');
  });

  it('Shift+Enter quebra a linha em vez de enviar', async () => {
    setConversationAiPaused.mockResolvedValue({
      data: { studentId: ANA, aiPaused: true },
      meta: META,
    });
    await openAna();
    await userEvent.click(
      screen.getByRole('button', { name: 'Pausar o atendimento automático do AI Coach' }),
    );
    const input = await screen.findByRole('textbox', { name: /Mensagem para Ana Souza/ });
    await userEvent.type(input, 'linha 1{Shift>}{Enter}{/Shift}linha 2');
    expect(sendConversationMessage).not.toHaveBeenCalled();
    expect(input).toHaveValue('linha 1\nlinha 2');
  });

  it('não envia texto em branco', async () => {
    setConversationAiPaused.mockResolvedValue({
      data: { studentId: ANA, aiPaused: true },
      meta: META,
    });
    await openAna();
    await userEvent.click(
      screen.getByRole('button', { name: 'Pausar o atendimento automático do AI Coach' }),
    );
    const input = await screen.findByRole('textbox', { name: /Mensagem para Ana Souza/ });
    await userEvent.type(input, '   {Enter}');
    expect(sendConversationMessage).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Enviar mensagem' })).toBeDisabled();
  });

  it('erro ao enviar mantém o texto digitado e mostra o motivo', async () => {
    setConversationAiPaused.mockResolvedValue({
      data: { studentId: ANA, aiPaused: true },
      meta: META,
    });
    sendConversationMessage.mockRejectedValue(
      new ControlCenterApiError(409, 'O aluno não tem consentimento de dados de saúde vigente.'),
    );
    await openAna();
    await userEvent.click(
      screen.getByRole('button', { name: 'Pausar o atendimento automático do AI Coach' }),
    );
    const input = await screen.findByRole('textbox', { name: /Mensagem para Ana Souza/ });
    await userEvent.type(input, 'Oi{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('consentimento');
    expect(input).toHaveValue('Oi');
  });

  it('erro ao pausar mantém o estado e mostra o motivo', async () => {
    setConversationAiPaused.mockRejectedValue(
      new ControlCenterApiError(
        403,
        'Seu papel não pode pausar o atendimento nem escrever para o aluno.',
      ),
    );
    await openAna();
    await userEvent.click(
      screen.getByRole('button', { name: 'Pausar o atendimento automático do AI Coach' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Seu papel não pode');
    expect(screen.getByRole('textbox', { name: /Mensagem para Ana Souza/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Ana Souza/ })).toHaveClass('border-emerald-600');
  });
});

/** EventSource controlável: o teste dispara abertura, erro e eventos do servidor à mão. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(event: { data: string }) => void>>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  open() {
    act(() => this.onopen?.());
  }
  fail() {
    act(() => this.onerror?.());
  }
  emit(type: string, data: unknown, raw?: string) {
    act(() =>
      this.listeners
        .get(type)
        ?.forEach((listener) => listener({ data: raw ?? JSON.stringify(data) })),
    );
  }
}
const stream = (): FakeEventSource => {
  const current = FakeEventSource.instances.at(-1);
  if (!current) throw new Error('nenhum EventSource aberto');
  return current;
};

describe('ConversationsDashboard — tempo real', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const messageEvent = (studentId: string, extra: object = {}) => ({
    studentId,
    direction: 'INBOUND',
    at: '2026-10-10T18:00:00.000Z',
    ...extra,
  });

  async function openAna(initial = [msg('m1', 'INBOUND', 'Oi!', '2026-10-09T15:00:00.000Z')]) {
    getConversations.mockResolvedValue(list);
    getConversationMessages.mockResolvedValue(history(initial));
    render(<ConversationsDashboard />);
    await userEvent.click(await screen.findByRole('button', { name: /Ana Souza/ }));
    const log = await screen.findByRole('log', { name: 'Mensagens' });
    await within(log).findByText('Oi!');
    return log;
  }

  it('abre o stream de eventos depois de carregar a lista e fecha ao sair', async () => {
    getConversations.mockResolvedValue(list);
    const { unmount } = render(<ConversationsDashboard />);
    await screen.findByRole('list', { name: 'Conversas' });
    // O stream abre num efeito que roda depois da lista renderizar: espera, não assume.
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(stream().url).toBe('/api/dashboard/conversations/events');
    unmount();
    expect(stream().closed).toBe(true);
  });

  it('mostra "Ao vivo" quando conecta e "Reconectando…" quando cai', async () => {
    await openAna();
    expect(screen.getByText('Reconectando…')).toBeInTheDocument();
    stream().open();
    expect(screen.getByText('Ao vivo')).toBeInTheDocument();
    stream().fail();
    expect(screen.getByText('Reconectando…')).toBeInTheDocument();
  });

  it('mensagem nova do aluno aberto: busca só as novas e acrescenta ao fim, sem recarregar', async () => {
    const log = await openAna();
    getNewerConversationMessages.mockResolvedValue(
      history([
        msg('m1', 'INBOUND', 'Oi!', '2026-10-09T15:00:00.000Z'),
        msg('m2', 'INBOUND', 'Tudo bem?', '2026-10-10T18:00:00.000Z'),
      ]),
    );

    stream().emit('conversation.message', messageEvent(ANA));

    expect(await within(log).findByText('Tudo bem?')).toBeVisible();
    expect(getNewerConversationMessages).toHaveBeenCalledWith(ANA, '2026-10-09T15:00:00.000Z');
    // A mensagem já exibida (m1) não duplica e o histórico não foi recarregado do zero.
    expect(within(log).getAllByText('Oi!')).toHaveLength(1);
    expect(getConversationMessages).toHaveBeenCalledTimes(1);
  });

  it('o aviso do envio manual desta tela (messageId já carregado) não dispara nova busca', async () => {
    setConversationAiPaused.mockResolvedValue({
      data: { studentId: ANA, aiPaused: true },
      meta: META,
    });
    sendConversationMessage.mockResolvedValue({
      data: { message: msg('m9', 'OUTBOUND', 'Já vou aí', '2026-10-10T18:05:00.000Z') },
      meta: META,
    });
    await openAna();
    await userEvent.click(
      screen.getByRole('button', { name: 'Pausar o atendimento automático do AI Coach' }),
    );
    await userEvent.type(
      await screen.findByRole('textbox', { name: /Mensagem para/ }),
      'Já vou aí{Enter}',
    );
    await screen.findByText('Já vou aí', { selector: 'p' });

    stream().emit(
      'conversation.message',
      messageEvent(ANA, { direction: 'OUTBOUND', messageId: 'm9' }),
    );
    // Um aviso sem messageId (outro autor) ainda dispara a busca — o de m9 não.
    expect(getNewerConversationMessages).not.toHaveBeenCalled();
  });

  it('mensagem de OUTRO aluno: sobe para o topo da lista e não busca o chat aberto', async () => {
    await openAna();
    const before = within(screen.getByRole('list', { name: 'Conversas' }))
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(before[0]).toContain('Ana Souza');

    stream().emit('conversation.message', messageEvent(BRUNO));

    const after = within(screen.getByRole('list', { name: 'Conversas' })).getAllByRole('button');
    expect(after[0]).toHaveTextContent('+55 (11) 99999-0002');
    expect(getNewerConversationMessages).not.toHaveBeenCalled();
  });

  it('mensagem de aluno que ainda não está na lista: recarrega a lista', async () => {
    await openAna();
    getConversations.mockClear();
    stream().emit('conversation.message', messageEvent('99999999-9999-4999-8999-999999999999'));
    await waitFor(() => expect(getConversations).toHaveBeenCalledTimes(1));
  });

  it('mudança do atendimento vinda de outra tela atualiza a borda e o botão', async () => {
    await openAna();
    expect(screen.getByRole('button', { name: /Ana Souza/ })).toHaveClass('border-emerald-600');

    stream().emit('conversation.attendance', { studentId: ANA, aiPaused: true });

    expect(screen.getByRole('button', { name: /Ana Souza/ })).toHaveClass('border-red-600');
    expect(
      screen.getByRole('button', { name: 'Ativar o atendimento automático do AI Coach' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Mensagem para Ana Souza/ })).toBeEnabled();
  });

  it('ignora evento malformado sem derrubar a tela', async () => {
    await openAna();
    stream().emit('conversation.message', undefined, '{isso não é json');
    stream().emit('conversation.message', { studentId: 'não-é-uuid' });
    stream().emit('conversation.attendance', { studentId: ANA });
    expect(getNewerConversationMessages).not.toHaveBeenCalled();
    expect(screen.getByRole('log', { name: 'Mensagens' })).toBeInTheDocument();
  });

  it('ao reconectar, busca o que pode ter chegado durante a queda', async () => {
    await openAna();
    stream().open(); // 1ª conexão: nada a recuperar
    expect(getNewerConversationMessages).not.toHaveBeenCalled();

    getNewerConversationMessages.mockResolvedValue(
      history([msg('m3', 'INBOUND', 'enquanto você estava fora', '2026-10-10T19:00:00.000Z')]),
    );
    stream().fail();
    stream().open(); // reconexão

    expect(await screen.findByText('enquanto você estava fora')).toBeVisible();
  });

  it('sem conexão em tempo real, consulta o chat aberto a cada 15 segundos', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    getConversations.mockResolvedValue(list);
    getConversationMessages.mockResolvedValue(
      history([msg('m1', 'INBOUND', 'Oi!', '2026-10-09T15:00:00.000Z')]),
    );
    render(<ConversationsDashboard />);
    await user.click(await screen.findByRole('button', { name: /Ana Souza/ }));
    await screen.findByText('Oi!');
    stream().fail();
    getNewerConversationMessages.mockResolvedValue(
      history([msg('m4', 'INBOUND', 'pelo polling', '2026-10-10T20:00:00.000Z')]),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(await screen.findByText('pelo polling')).toBeVisible();
  });

  it('se o leitor subiu na conversa, não é puxado para baixo: aparece "Novas mensagens"', async () => {
    const log = await openAna();
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 400 });
    log.scrollTop = 0;
    fireEvent.scroll(log);

    getNewerConversationMessages.mockResolvedValue(
      history([msg('m5', 'INBOUND', 'olha isso', '2026-10-10T21:00:00.000Z')]),
    );
    stream().emit('conversation.message', messageEvent(ANA));

    const jump = await screen.findByRole('button', { name: 'Novas mensagens' });
    expect(log.scrollTop).toBe(0);
    await userEvent.click(jump);
    expect(screen.queryByRole('button', { name: 'Novas mensagens' })).toBeNull();
    expect(log.scrollTop).toBe(2000);
  });

  it('com o leitor no rodapé, mensagem nova desce sozinha e não mostra o aviso', async () => {
    const log = await openAna();
    getNewerConversationMessages.mockResolvedValue(
      history([msg('m6', 'INBOUND', 'no rodapé', '2026-10-10T21:30:00.000Z')]),
    );
    stream().emit('conversation.message', messageEvent(ANA));
    await within(log).findByText('no rodapé');
    expect(screen.queryByRole('button', { name: 'Novas mensagens' })).toBeNull();
  });
});

describe('ConversationsDashboard — mensagens não lidas', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const withUnread = (ana: number, bruno = 0) => ({
    ...list,
    data: {
      conversations: [
        { ...list.data.conversations[0], unreadCount: ana },
        { ...list.data.conversations[1], unreadCount: bruno },
      ],
    },
  });
  const row = (name: RegExp) => screen.getByRole('button', { name });
  const badge = (el: HTMLElement) =>
    el.querySelector('span[aria-hidden="true"].rounded-full.bg-emerald-700');

  it('mostra o selo verde com a contagem no fim do contato; sem não lidas, nada', async () => {
    getConversations.mockResolvedValue(withUnread(3));
    render(<ConversationsDashboard />);
    await screen.findByRole('list', { name: 'Conversas' });

    const ana = row(/Ana Souza/);
    expect(badge(ana)).toHaveTextContent('3');
    expect(ana).toHaveTextContent('3 mensagens não lidas.');
    expect(ana.querySelector('time')).toHaveClass('text-emerald-700');
    expect(badge(row(/\+55 \(11\) 99999-0002/))).toBeNull();
    expect(row(/\+55 \(11\) 99999-0002/).querySelector('time')).toHaveClass(
      'text-muted-foreground',
    );
  });

  it('usa o singular com uma mensagem e "99+" acima de 99', async () => {
    getConversations.mockResolvedValue(withUnread(1, 250));
    render(<ConversationsDashboard />);
    await screen.findByRole('list', { name: 'Conversas' });
    expect(row(/Ana Souza/)).toHaveTextContent('1 mensagem não lida.');
    expect(badge(row(/\+55 \(11\) 99999-0002/))).toHaveTextContent('99+');
  });

  it('abrir a conversa lê até a última mensagem vista e zera o selo', async () => {
    getConversations.mockResolvedValue(withUnread(2));
    getConversationMessages.mockResolvedValue(
      history([
        msg('m1', 'INBOUND', 'Oi!', '2026-10-09T14:00:00.000Z'),
        msg('m2', 'INBOUND', 'Tá aí?', '2026-10-09T15:00:00.000Z'),
      ]),
    );
    render(<ConversationsDashboard />);
    await userEvent.click(await screen.findByRole('button', { name: /Ana Souza/ }));

    await waitFor(() =>
      expect(markConversationRead).toHaveBeenCalledWith(ANA, '2026-10-09T15:00:00.000Z'),
    );
    await waitFor(() => expect(badge(row(/Ana Souza/))).toBeNull());
    expect(markConversationRead).toHaveBeenCalledTimes(1);
  });

  it('se o servidor ainda devolve não lidas, mostra o que sobrou e não entra em laço', async () => {
    markConversationRead.mockResolvedValue({
      data: { studentId: ANA, unreadCount: 1 },
      meta: META,
    });
    getConversations.mockResolvedValue(withUnread(2));
    getConversationMessages.mockResolvedValue(
      history([msg('m2', 'INBOUND', 'Tá aí?', '2026-10-09T15:00:00.000Z')]),
    );
    render(<ConversationsDashboard />);
    await userEvent.click(await screen.findByRole('button', { name: /Ana Souza/ }));

    await waitFor(() => expect(badge(row(/Ana Souza/))).toHaveTextContent('1'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(markConversationRead).toHaveBeenCalledTimes(1);
  });

  it('mensagem do aluno que NÃO está aberto acende o selo e soma às seguintes', async () => {
    getConversations.mockResolvedValue(withUnread(0, 1));
    getConversationMessages.mockResolvedValue(history([]));
    render(<ConversationsDashboard />);
    await userEvent.click(await screen.findByRole('button', { name: /Ana Souza/ }));
    await screen.findByRole('log', { name: 'Mensagens' });

    stream().emit('conversation.message', {
      studentId: BRUNO,
      direction: 'INBOUND',
      at: '2026-10-10T18:00:00.000Z',
    });
    stream().emit('conversation.message', {
      studentId: BRUNO,
      direction: 'INBOUND',
      at: '2026-10-10T18:01:00.000Z',
    });

    const bruno = screen.getByRole('button', { name: /\+55 \(11\) 99999-0002/ });
    expect(badge(bruno)).toHaveTextContent('3'); // 1 do servidor + 2 ao vivo
  });

  it('mensagem enviada por nós (OUTBOUND) não conta como não lida', async () => {
    getConversations.mockResolvedValue(withUnread(0, 0));
    render(<ConversationsDashboard />);
    await screen.findByRole('list', { name: 'Conversas' });
    stream().emit('conversation.message', {
      studentId: BRUNO,
      direction: 'OUTBOUND',
      at: '2026-10-10T18:00:00.000Z',
    });
    expect(badge(screen.getByRole('button', { name: /\+55 \(11\) 99999-0002/ }))).toBeNull();
  });

  it('conversa aberta e leitor no rodapé: a mensagem nova é lida na hora, sem acender o selo', async () => {
    getConversations.mockResolvedValue(withUnread(0));
    getConversationMessages.mockResolvedValue(
      history([msg('m1', 'INBOUND', 'Oi!', '2026-10-09T15:00:00.000Z')]),
    );
    render(<ConversationsDashboard />);
    await userEvent.click(await screen.findByRole('button', { name: /Ana Souza/ }));
    await screen.findByText('Oi!');
    getNewerConversationMessages.mockResolvedValue(
      history([msg('m2', 'INBOUND', 'Chegou agora', '2026-10-10T18:00:00.000Z')]),
    );

    stream().emit('conversation.message', {
      studentId: ANA,
      direction: 'INBOUND',
      at: '2026-10-10T18:00:00.000Z',
    });

    await screen.findByText('Chegou agora');
    await waitFor(() =>
      expect(markConversationRead).toHaveBeenCalledWith(ANA, '2026-10-10T18:00:00.000Z'),
    );
    expect(badge(row(/Ana Souza/))).toBeNull();
  });

  it('conversa aberta com o leitor rolado para cima: o selo acende e só apaga ao descer', async () => {
    getConversations.mockResolvedValue(withUnread(0));
    getConversationMessages.mockResolvedValue(
      history([msg('m1', 'INBOUND', 'Oi!', '2026-10-09T15:00:00.000Z')]),
    );
    render(<ConversationsDashboard />);
    await userEvent.click(await screen.findByRole('button', { name: /Ana Souza/ }));
    const log = await screen.findByRole('log', { name: 'Mensagens' });
    await within(log).findByText('Oi!');
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 400 });
    log.scrollTop = 0;
    fireEvent.scroll(log);
    getNewerConversationMessages.mockResolvedValue(
      history([msg('m2', 'INBOUND', 'Olha isso', '2026-10-10T18:00:00.000Z')]),
    );

    stream().emit('conversation.message', {
      studentId: ANA,
      direction: 'INBOUND',
      at: '2026-10-10T18:00:00.000Z',
    });

    await waitFor(() => expect(badge(row(/Ana Souza/))).toHaveTextContent('1'));
    expect(markConversationRead).not.toHaveBeenCalled();

    await userEvent.click(await screen.findByRole('button', { name: 'Novas mensagens' }));
    await waitFor(() =>
      expect(markConversationRead).toHaveBeenCalledWith(ANA, '2026-10-10T18:00:00.000Z'),
    );
    await waitFor(() => expect(badge(row(/Ana Souza/))).toBeNull());
  });

  it('aba em segundo plano: mensagem nova fica não lida até a aba voltar', async () => {
    getConversations.mockResolvedValue(withUnread(0));
    getConversationMessages.mockResolvedValue(
      history([msg('m1', 'INBOUND', 'Oi!', '2026-10-09T15:00:00.000Z')]),
    );
    render(<ConversationsDashboard />);
    await userEvent.click(await screen.findByRole('button', { name: /Ana Souza/ }));
    await screen.findByText('Oi!');

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    getNewerConversationMessages.mockResolvedValue(
      history([msg('m2', 'INBOUND', 'Enquanto você estava fora', '2026-10-10T18:00:00.000Z')]),
    );
    stream().emit('conversation.message', {
      studentId: ANA,
      direction: 'INBOUND',
      at: '2026-10-10T18:00:00.000Z',
    });
    await screen.findByText('Enquanto você estava fora');
    await waitFor(() => expect(badge(row(/Ana Souza/))).toHaveTextContent('1'));
    expect(markConversationRead).not.toHaveBeenCalled();

    visibility.mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() =>
      expect(markConversationRead).toHaveBeenCalledWith(ANA, '2026-10-10T18:00:00.000Z'),
    );
  });

  it('leitura feita em outra tela (evento) zera o selo aqui', async () => {
    getConversations.mockResolvedValue(withUnread(4));
    render(<ConversationsDashboard />);
    await screen.findByRole('list', { name: 'Conversas' });
    expect(badge(row(/Ana Souza/))).toHaveTextContent('4');

    stream().emit('conversation.read', { studentId: ANA, unreadCount: 0 });

    expect(badge(row(/Ana Souza/))).toBeNull();
  });
});
