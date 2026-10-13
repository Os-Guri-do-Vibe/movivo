import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationItem, NotificationsResponse } from '@/lib/dashboard-types';

const api = vi.hoisted(() => ({
  getNotifications: vi.fn(),
  getNotificationsSummary: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

vi.mock('@/lib/dashboard-api', () => api);

class MockEventSource {
  constructor(readonly url: string) {}

  addEventListener = vi.fn();
  close = vi.fn();
}

import { AlertsBell } from './alerts-bell';
import { NotificationsProvider } from './notifications-provider';

const alertItem: NotificationItem = {
  type: 'alert',
  id: 'alert-1',
  read: false,
  createdAt: '2026-10-12T14:30:00.000Z',
  level: 'ALERT',
  title: null,
  studentName: 'Ana',
  reason: 'FORA_DE_ESCOPO',
  sourceType: null,
  section: null,
  origin: null,
  autoReleaseAt: null,
};

const protocolItem: NotificationItem = {
  type: 'protocol',
  id: 'protocol-1',
  read: false,
  createdAt: '2026-10-12T15:00:00.000Z',
  level: null,
  title: 'Protocolo para Revisão: Ana',
  studentName: null,
  reason: null,
  sourceType: null,
  section: 'MANDATORY',
  origin: 'PARQ',
  autoReleaseAt: null,
};

function response(
  items: NotificationItem[],
  extra: Partial<NotificationsResponse> = {},
): NotificationsResponse {
  return {
    snapshotAt: '2026-10-12T16:00:00.000Z',
    items,
    totalPending: items.length,
    unread: items.filter((item) => !item.read).length,
    openSafety: 0,
    ...extra,
  };
}

function setup(list: NotificationsResponse) {
  api.getNotificationsSummary.mockResolvedValue({
    unread: list.unread,
    openSafety: list.openSafety,
  });
  api.getNotifications.mockResolvedValue(list);
  return render(
    <NotificationsProvider>
      <AlertsBell />
    </NotificationsProvider>,
  );
}

describe('AlertsBell', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource);
    api.markNotificationRead.mockResolvedValue(undefined);
    api.markAllNotificationsRead.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.values(api).forEach((mock) => mock.mockReset());
  });

  it('conta apenas as não lidas e abre o popover sem navegar nem marcar nada', async () => {
    setup(response([alertItem, protocolItem]));

    const bell = await screen.findByRole('button', { name: 'Notificações: 2 não lidas' });
    await userEvent.click(bell);

    const dialog = await screen.findByRole('dialog', { name: 'Notificações' });
    expect(await screen.findByText('Assunto fora do escopo do AI Coach')).toBeVisible();
    expect(
      screen.getByRole('link', { name: /assunto fora do escopo do ai coach/i }),
    ).toHaveAttribute('href', '/dashboard/alertas/alert-1');
    expect(screen.getByRole('link', { name: /protocolo para revisão: ana/i })).toHaveAttribute(
      'href',
      '/dashboard/fila/protocol/protocol-1',
    );
    expect(api.markNotificationRead).not.toHaveBeenCalled();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(bell).toHaveFocus();
  });

  it('diferencia alerta de notificação da fila e mostra só as não lidas', async () => {
    setup(response([alertItem, { ...protocolItem, read: true }]));
    await userEvent.click(await screen.findByRole('button', { name: /Notificações: 1 não lida/ }));

    expect(await screen.findByText('Alerta · Atenção')).toBeVisible();
    expect(screen.getByText('Não lida.')).toBeInTheDocument();
    // A notificação já lida sai do popover: fica registrada só na tela Notificações.
    expect(screen.queryByText('Fila · Protocolo para revisão')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /protocolo para revisão/i })).not.toBeInTheDocument();
  });

  it('descreve a notificação da fila com urgência e origem', async () => {
    setup(response([protocolItem]));
    await userEvent.click(await screen.findByRole('button', { name: /Notificações: 1 não lida/ }));
    expect(await screen.findByText('Fila · Protocolo para revisão')).toBeVisible();
    expect(screen.getByText(/Revisão obrigatória · Origem: PAR-Q bloqueante/)).toBeVisible();
  });

  it('marca todas como lidas, atualiza o badge e avisa por região de status', async () => {
    // O servidor passa a devolver tudo como lido depois da gravação, como na produção.
    api.markAllNotificationsRead.mockImplementation(async () => {
      api.getNotificationsSummary.mockResolvedValue({ unread: 0, openSafety: 0 });
      api.getNotifications.mockResolvedValue(
        response([
          { ...alertItem, read: true },
          { ...protocolItem, read: true },
        ]),
      );
    });
    setup(response([alertItem, protocolItem]));
    await userEvent.click(await screen.findByRole('button', { name: 'Notificações: 2 não lidas' }));
    await screen.findByText('Assunto fora do escopo do AI Coach');

    await userEvent.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }));

    await waitFor(() =>
      expect(api.markAllNotificationsRead).toHaveBeenCalledWith('2026-10-12T16:00:00.000Z'),
    );
    expect(
      await screen.findByRole('button', { name: 'Notificações: nenhuma não lida' }),
    ).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Todas as notificações foram marcadas como lidas. Elas continuam em Notificações.',
    );
    expect(screen.queryByText('Não lida.')).not.toBeInTheDocument();
    // As lidas somem do popover e ficam só na tela Notificações.
    expect(screen.queryByText('Assunto fora do escopo do AI Coach')).not.toBeInTheDocument();
    expect(screen.getByText('Nenhuma notificação não lida')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Marcar todas como lidas' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('desfaz tudo e mostra o erro quando marcar todas falha', async () => {
    api.markAllNotificationsRead.mockRejectedValue(new Error('offline'));
    setup(response([alertItem, protocolItem]));
    await userEvent.click(await screen.findByRole('button', { name: 'Notificações: 2 não lidas' }));
    await screen.findByText('Assunto fora do escopo do AI Coach');

    await userEvent.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível marcar como lidas. Tente novamente.',
    );
    expect(await screen.findByRole('button', { name: 'Notificações: 2 não lidas' })).toBeVisible();
  });

  it('o botão desabilitado não dispara a ação quando não há não lidas', async () => {
    setup(response([{ ...alertItem, read: true }]));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Notificações: nenhuma não lida' }),
    );
    await screen.findByText('Nenhuma notificação não lida');

    await userEvent.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }));
    expect(api.markAllNotificationsRead).not.toHaveBeenCalled();
  });

  it('mantém visível a faixa de segurança aberta mesmo com o alerta já lido', async () => {
    setup(
      response([{ ...alertItem, level: 'SAFETY', reason: 'RED_FLAG', read: true }], {
        openSafety: 1,
      }),
    );
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Notificações: nenhuma não lida, 1 alerta de segurança aberto',
      }),
    );
    expect(await screen.findByText('1 alerta de segurança aberto')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ver alertas' })).toHaveAttribute(
      'href',
      '/dashboard/alertas',
    );
    expect(screen.getByText('Nenhuma notificação não lida')).toBeVisible();
  });

  it('o estado vazio orienta onde ficam as já lidas', async () => {
    setup(response([]));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Notificações: nenhuma não lida' }),
    );
    expect(await screen.findByText('Nenhuma notificação não lida')).toBeVisible();
    expect(screen.getByText(/ficam em Notificações/)).toBeVisible();
  });

  it('não confunde erro de carga com lista vazia e permite tentar de novo', async () => {
    api.getNotificationsSummary.mockResolvedValue({ unread: 1, openSafety: 0 });
    api.getNotifications
      .mockRejectedValueOnce(new Error('falha'))
      .mockResolvedValueOnce(response([alertItem]));
    render(
      <NotificationsProvider>
        <AlertsBell />
      </NotificationsProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Notificações: 1 não lida' }));

    expect(await screen.findByText('Não foi possível carregar as notificações.')).toBeVisible();
    expect(screen.queryByText('Nenhuma notificação não lida')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Assunto fora do escopo do AI Coach')).toBeVisible();
  });

  it('informa quando há mais não lidas do que as exibidas e leva ao registro completo', async () => {
    setup(response([alertItem], { unread: 14 }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Notificações: 14 não lidas' }),
    );
    expect(await screen.findByText('Mostrando 1 de 14 não lidas')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ver todas as notificações' })).toHaveAttribute(
      'href',
      '/dashboard/notificacoes',
    );
  });

  it('usa um único scroll: só a lista rola, com cabeçalho e rodapé fixos', async () => {
    setup(response([alertItem]));
    await userEvent.click(await screen.findByRole('button', { name: /Notificações: 1 não lida/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Notificações' });

    const scrollers = [dialog, ...dialog.querySelectorAll<HTMLElement>('*')].filter((node) =>
      node.className.toString().includes('overflow-y-auto'),
    );
    expect(scrollers).toHaveLength(1);
    expect(dialog.className).toContain('flex-col');
    expect(scrollers[0]).toContainElement(screen.getByRole('list'));
  });
});
