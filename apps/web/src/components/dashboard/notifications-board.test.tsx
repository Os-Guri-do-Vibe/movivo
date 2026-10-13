import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationHistoryItem, NotificationHistoryResponse } from '@/lib/dashboard-types';

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  search: new URLSearchParams(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace }),
  usePathname: () => '/dashboard/notificacoes',
  useSearchParams: () => navigation.search,
}));

const api = vi.hoisted(() => ({ getNotificationHistory: vi.fn() }));
vi.mock('@/lib/dashboard-api', () => api);

const provider = vi.hoisted(() => ({ markAllRead: vi.fn() }));
vi.mock('./notifications-provider', () => ({ useNotifications: () => provider }));

class MockEventSource {
  static last: MockEventSource | null = null;
  listeners = new Map<string, () => void>();
  constructor(readonly url: string) {
    MockEventSource.last = this;
  }

  addEventListener = (event: string, callback: () => void) => this.listeners.set(event, callback);
  close = vi.fn();
}

import { NotificationsBoard } from './notifications-board';

function item(overrides: Partial<NotificationHistoryItem> = {}): NotificationHistoryItem {
  return {
    type: 'alert',
    id: 'alert-1',
    read: false,
    createdAt: new Date().toISOString(),
    level: 'ALERT',
    title: null,
    studentName: 'Ana',
    reason: 'FORA_DE_ESCOPO',
    sourceType: null,
    section: null,
    origin: null,
    autoReleaseAt: null,
    status: 'PENDING',
    outcome: null,
    settledAt: null,
    ...overrides,
  };
}

function page(
  items: NotificationHistoryItem[],
  extra: Partial<NotificationHistoryResponse> = {},
): NotificationHistoryResponse {
  return {
    snapshotAt: '2026-10-13T12:00:00.000Z',
    items,
    nextCursor: null,
    unread: items.filter((entry) => !entry.read).length,
    openSafety: 0,
    ...extra,
  };
}

describe('NotificationsBoard', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource);
    navigation.search = new URLSearchParams();
    provider.markAllRead.mockResolvedValue({ ok: true, count: 2 });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    api.getNotificationHistory.mockReset();
    provider.markAllRead.mockReset();
    navigation.replace.mockReset();
  });

  it('agrupa por dia e mostra lidas e não lidas com o chip de estado', async () => {
    const yesterday = new Date(Date.now() - 24 * 3_600_000).toISOString();
    api.getNotificationHistory.mockResolvedValue(
      page([
        item(),
        item({
          type: 'protocol',
          id: 'p-1',
          title: 'Protocolo para Revisão: Bruno',
          createdAt: yesterday,
          read: true,
          status: 'SETTLED',
          outcome: 'SIGNED',
          settledAt: yesterday,
          section: 'MANDATORY',
        }),
      ]),
    );
    render(<NotificationsBoard />);

    expect(await screen.findByRole('heading', { level: 2, name: 'Hoje' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: 'Ontem' })).toBeVisible();
    const alert = screen.getByRole('link', { name: /assunto fora do escopo/i });
    expect(alert).toHaveAttribute('href', '/dashboard/alertas/alert-1');
    expect(within(alert).getByText('Pendente')).toBeVisible();
    expect(within(alert).getByText('Não lida.')).toBeInTheDocument();
    const protocol = screen.getByRole('link', { name: /protocolo para revisão: bruno/i });
    expect(protocol).toHaveAttribute('href', '/dashboard/fila/protocol/p-1');
    expect(within(protocol).getByText('Assinado')).toBeVisible();
    expect(within(protocol).queryByText('Não lida.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Não lidas (1)' })).toBeVisible();
    expect(screen.getByText('Fim das notificações dos últimos 30 dias.')).toBeVisible();
  });

  it('lê os filtros da URL e os grava ao trocar', async () => {
    navigation.search = new URLSearchParams('estado=nao-lidas&tipo=fila');
    api.getNotificationHistory.mockResolvedValue(page([item()]));
    render(<NotificationsBoard />);

    await waitFor(() =>
      expect(api.getNotificationHistory).toHaveBeenCalledWith({ state: 'unread', type: 'queue' }),
    );
    expect(screen.getByRole('button', { name: /Não lidas/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Alertas' }));
    expect(navigation.replace).toHaveBeenCalledWith(
      '/dashboard/notificacoes?estado=nao-lidas&tipo=alertas',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Todas' }));
    expect(navigation.replace).toHaveBeenLastCalledWith('/dashboard/notificacoes?tipo=fila');
  });

  it('mostra a faixa de segurança aberta', async () => {
    api.getNotificationHistory.mockResolvedValue(page([item()], { openSafety: 2 }));
    render(<NotificationsBoard />);
    expect(await screen.findByText('2 alertas de segurança abertos')).toBeVisible();
  });

  it('marca todas como lidas usando o corte da página e avisa por região de status', async () => {
    api.getNotificationHistory.mockResolvedValue(page([item(), item({ id: 'alert-2' })]));
    render(<NotificationsBoard />);
    await screen.findAllByRole('link', { name: /assunto fora do escopo/i });

    await userEvent.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }));

    await waitFor(() =>
      expect(provider.markAllRead).toHaveBeenCalledWith('2026-10-13T12:00:00.000Z'),
    );
    expect(await screen.findByText('2 notificações marcadas como lidas.')).toBeVisible();
    expect(screen.queryByText('Não lida.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Não lidas (0)' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Marcar todas como lidas' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('esvazia a lista no filtro "Não lidas" depois de marcar todas', async () => {
    navigation.search = new URLSearchParams('estado=nao-lidas');
    api.getNotificationHistory.mockResolvedValue(page([item()]));
    render(<NotificationsBoard />);
    await screen.findByRole('link', { name: /assunto fora do escopo/i });

    await userEvent.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }));
    expect(await screen.findByText('Nenhuma notificação não lida')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Ver todas' })).toBeVisible();
  });

  it('desfaz e mostra o erro quando marcar todas falha', async () => {
    provider.markAllRead.mockResolvedValue({ ok: false, count: 1 });
    api.getNotificationHistory.mockResolvedValue(page([item()]));
    render(<NotificationsBoard />);
    await screen.findByRole('link', { name: /assunto fora do escopo/i });

    await userEvent.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível marcar como lidas. Tente novamente.',
    );
    expect(screen.getByText('Não lida.')).toBeInTheDocument();
  });

  it('usa o singular quando só uma notificação é marcada', async () => {
    provider.markAllRead.mockResolvedValue({ ok: true, count: 1 });
    api.getNotificationHistory.mockResolvedValue(page([item()]));
    render(<NotificationsBoard />);
    await screen.findByRole('link', { name: /assunto fora do escopo/i });
    await userEvent.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }));
    expect(await screen.findByText('1 notificação marcada como lida.')).toBeVisible();
  });

  it('carrega mais por cursor e trata falha na página seguinte', async () => {
    api.getNotificationHistory
      .mockResolvedValueOnce(page([item()], { nextCursor: 'c1' }))
      .mockRejectedValueOnce(new Error('falha'))
      .mockResolvedValueOnce(page([item({ id: 'alert-9', reason: 'RED_FLAG' })]));
    render(<NotificationsBoard />);

    await userEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('Não foi possível carregar mais notificações.')).toBeVisible();
    expect(screen.getByRole('link', { name: /assunto fora do escopo/i })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('link', { name: /sinal de segurança/i })).toBeVisible();
    expect(api.getNotificationHistory).toHaveBeenLastCalledWith({
      state: 'all',
      type: 'all',
      cursor: 'c1',
    });
    expect(screen.getByText('Mais 1 notificações carregadas.')).toBeVisible();
  });

  it('mostra o erro da primeira página e permite tentar de novo', async () => {
    api.getNotificationHistory
      .mockRejectedValueOnce(new Error('falha'))
      .mockResolvedValueOnce(page([item()]));
    render(<NotificationsBoard />);

    expect(await screen.findByText('Não foi possível carregar as notificações.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('link', { name: /assunto fora do escopo/i })).toBeVisible();
  });

  it('avisa de novas notificações sem empurrar a lista e recarrega ao pedir', async () => {
    api.getNotificationHistory.mockResolvedValue(page([item()]));
    render(<NotificationsBoard />);
    await screen.findByRole('link', { name: /assunto fora do escopo/i });
    expect(screen.queryByRole('button', { name: /Novas notificações/ })).not.toBeInTheDocument();

    MockEventSource.last?.listeners.get('queue.updated')?.();
    const pill = await screen.findByRole('button', { name: 'Novas notificações · Mostrar' });
    api.getNotificationHistory.mockResolvedValue(page([item(), item({ id: 'alert-3' })]));
    await userEvent.click(pill);

    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(2));
    expect(screen.queryByRole('button', { name: /Novas notificações/ })).not.toBeInTheDocument();
  });

  it('mostra um vazio específico para cada situação', async () => {
    api.getNotificationHistory.mockResolvedValue(page([]));
    const { unmount } = render(<NotificationsBoard />);
    expect(await screen.findByText('Nenhuma notificação nos últimos 30 dias')).toBeVisible();
    unmount();

    navigation.search = new URLSearchParams('tipo=alertas');
    const alerts = render(<NotificationsBoard />);
    expect(await screen.findByText('Nenhum alerta nos últimos 30 dias')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(navigation.replace).toHaveBeenCalledWith('/dashboard/notificacoes');
    alerts.unmount();

    navigation.search = new URLSearchParams('tipo=fila');
    render(<NotificationsBoard />);
    expect(await screen.findByText('Nenhum item da Fila nos últimos 30 dias')).toBeVisible();
  });
});
