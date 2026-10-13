import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationItem } from '@/lib/dashboard-types';

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

import {
  NotificationsProvider,
  useMarkNotificationRead,
  useNotifications,
} from './notifications-provider';

const item: NotificationItem = {
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

function Probe() {
  const { unread, items, markRead } = useNotifications();
  return (
    <>
      <p data-testid="unread">{unread}</p>
      <p data-testid="read">{items.map((entry) => String(entry.read)).join(',')}</p>
      <button type="button" onClick={() => void markRead('alert', 'alert-1')}>
        ler
      </button>
    </>
  );
}

describe('NotificationsProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource);
    api.getNotificationsSummary.mockResolvedValue({ unread: 1, openSafety: 0 });
    api.getNotifications.mockResolvedValue({
      snapshotAt: '2026-10-12T16:00:00.000Z',
      items: [item],
      totalPending: 1,
      unread: 1,
      openSafety: 0,
    });
    api.markNotificationRead.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    Object.values(api).forEach((mock) => mock.mockReset());
  });

  it('um clique para ler baixa a contagem na hora e grava a leitura', async () => {
    function Watcher() {
      const { watchItems } = useNotifications();
      return (
        <button type="button" onClick={() => watchItems(true)}>
          abrir
        </button>
      );
    }
    render(
      <NotificationsProvider>
        <Watcher />
        <Probe />
      </NotificationsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('1'));
    screen.getByRole('button', { name: 'abrir' }).click();
    await waitFor(() => expect(screen.getByTestId('read')).toHaveTextContent('false'));

    // Depois da gravação o servidor passa a devolver o item como lido.
    api.markNotificationRead.mockImplementation(async () => {
      api.getNotificationsSummary.mockResolvedValue({ unread: 0, openSafety: 0 });
      api.getNotifications.mockResolvedValue({
        snapshotAt: '2026-10-12T16:01:00.000Z',
        items: [{ ...item, read: true }],
        totalPending: 1,
        unread: 0,
        openSafety: 0,
      });
    });
    screen.getByRole('button', { name: 'ler' }).click();

    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('0'));
    expect(screen.getByTestId('read')).toHaveTextContent('true');
    expect(api.markNotificationRead).toHaveBeenCalledWith('alert', 'alert-1');
  });

  it('a tela de detalhe grava a leitura uma única vez, só depois de carregar', async () => {
    const { rerender } = renderHook(
      ({ loaded }: { loaded: boolean }) => useMarkNotificationRead('alert', 'alert-1', loaded),
      { initialProps: { loaded: false }, wrapper: NotificationsProvider },
    );
    expect(api.markNotificationRead).not.toHaveBeenCalled();

    rerender({ loaded: true });
    await waitFor(() => expect(api.markNotificationRead).toHaveBeenCalledTimes(1));
    rerender({ loaded: true });
    expect(api.markNotificationRead).toHaveBeenCalledTimes(1);
  });

  it('tenta de novo uma vez quando a gravação falha', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.markNotificationRead.mockRejectedValueOnce(new Error('offline'));
    renderHook(() => useMarkNotificationRead('alert', 'alert-1', true), {
      wrapper: NotificationsProvider,
    });

    await waitFor(() => expect(api.markNotificationRead).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(api.markNotificationRead).toHaveBeenCalledTimes(2);
  });

  it('fora do provider ainda registra a leitura (conta sem acesso ao sino)', async () => {
    renderHook(() => useMarkNotificationRead('protocol', 'p-1', true));
    await waitFor(() => expect(api.markNotificationRead).toHaveBeenCalledWith('protocol', 'p-1'));
  });
});
