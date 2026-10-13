'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  getNotifications,
  getNotificationsSummary,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/dashboard-api';
import type { NotificationItem, NotificationType } from '@/lib/dashboard-types';

const REFRESH_INTERVAL_MS = 30_000;
const RETRY_DELAY_MS = 2_000;

type ListStatus = 'idle' | 'loading' | 'ready' | 'error';

interface NotificationsContextValue {
  /** `false` fora do provider (ex.: conta sem acesso ao sino): só registra a leitura. */
  available: boolean;
  unread: number;
  openSafety: number;
  totalPending: number;
  items: NotificationItem[];
  listStatus: ListStatus;
  /** Avisa que o popover está aberto: mantém a lista fresca enquanto estiver. */
  watchItems: (watching: boolean) => void;
  reloadItems: () => Promise<void>;
  /** Otimista: o badge cai na hora; falha tenta de novo uma vez e depois volta ao servidor. */
  markRead: (type: NotificationType, id: string) => Promise<void>;
  /** `true` quando o servidor confirmou; em erro tudo volta ao estado anterior. */
  markAllRead: () => Promise<boolean>;
}

const NOOP: NotificationsContextValue = {
  available: false,
  unread: 0,
  openSafety: 0,
  totalPending: 0,
  items: [],
  listStatus: 'idle',
  watchItems: () => undefined,
  reloadItems: async () => undefined,
  markRead: async (type, id) => {
    await markNotificationRead(type, id).catch(() => undefined);
  },
  markAllRead: async () => false,
};

const NotificationsContext = createContext<NotificationsContextValue>(NOOP);

export function useNotifications(): NotificationsContextValue {
  return useContext(NotificationsContext);
}

/**
 * Marca o item como lido quando a tela de detalhe carrega com sucesso. É o único ponto que
 * grava a leitura: cobre sino, listas, Fila, link direto e nova aba. Se a tela falhar, o item
 * continua não lido — a pessoa não chegou a ver o caso.
 */
export function useMarkNotificationRead(type: NotificationType, id: string, loaded: boolean) {
  const { markRead } = useNotifications();
  const markedRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${type}:${id}`;
    if (!loaded || markedRef.current === key) return;
    markedRef.current = key;
    void markRead(type, id);
  }, [id, loaded, markRead, type]);
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [unread, setUnread] = useState(0);
  const [openSafety, setOpenSafety] = useState(0);
  const [totalPending, setTotalPending] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [listStatus, setListStatus] = useState<ListStatus>('idle');
  const snapshotAt = useRef<string | null>(null);
  const watching = useRef(false);
  // Escritas em voo: respostas de leitura que chegam durante elas são descartadas, senão um
  // polling poderia desfazer o efeito otimista antes de o servidor confirmar.
  const pendingWrites = useRef(0);

  const refreshSummary = useCallback(async (signal?: AbortSignal) => {
    try {
      const summary = await getNotificationsSummary(signal);
      if (pendingWrites.current > 0) return;
      setUnread(summary.unread);
      setOpenSafety(summary.openSafety);
    } catch {
      // Mantém a última contagem; o próximo ciclo tenta de novo.
    }
  }, []);

  const loadItems = useCallback(async () => {
    setListStatus((current) => (current === 'ready' ? current : 'loading'));
    try {
      const response = await getNotifications();
      if (pendingWrites.current > 0) return;
      snapshotAt.current = response.snapshotAt;
      setItems(response.items);
      setTotalPending(response.totalPending);
      setUnread(response.unread);
      setOpenSafety(response.openSafety);
      setListStatus('ready');
    } catch {
      setListStatus('error');
    }
  }, []);

  const syncAfterWrites = useCallback(() => {
    if (pendingWrites.current > 0) return;
    void refreshSummary();
    if (watching.current) void loadItems();
  }, [loadItems, refreshSummary]);

  useEffect(() => {
    const controller = new AbortController();
    void refreshSummary(controller.signal);
    const events = new EventSource('/api/dashboard/queue/events');
    events.addEventListener('queue.updated', () => {
      void refreshSummary();
      if (watching.current) void loadItems();
    });
    const interval = window.setInterval(() => void refreshSummary(), REFRESH_INTERVAL_MS);
    return () => {
      controller.abort();
      events.close();
      window.clearInterval(interval);
    };
  }, [loadItems, refreshSummary]);

  const watchItems = useCallback(
    (value: boolean) => {
      watching.current = value;
      if (value) void loadItems();
    },
    [loadItems],
  );

  const markRead = useCallback(
    async (type: NotificationType, id: string) => {
      const wasUnread = items.some((item) => item.type === type && item.id === id && !item.read);
      if (wasUnread) {
        setItems((current) =>
          current.map((item) =>
            item.type === type && item.id === id ? { ...item, read: true } : item,
          ),
        );
        setUnread((current) => Math.max(0, current - 1));
      }
      pendingWrites.current += 1;
      try {
        try {
          await markNotificationRead(type, id);
        } catch {
          await new Promise((resolve) => window.setTimeout(resolve, RETRY_DELAY_MS));
          await markNotificationRead(type, id);
        }
      } catch {
        // Sem aviso: a pessoa está focada no caso. O servidor volta a valer no próximo sync.
      } finally {
        pendingWrites.current -= 1;
        syncAfterWrites();
      }
    },
    [items, syncAfterWrites],
  );

  const markAllRead = useCallback(async () => {
    const previous = { items, unread };
    setItems((current) => current.map((item) => ({ ...item, read: true })));
    setUnread(0);
    pendingWrites.current += 1;
    try {
      await markAllNotificationsRead(snapshotAt.current ?? new Date().toISOString());
      return true;
    } catch {
      setItems(previous.items);
      setUnread(previous.unread);
      return false;
    } finally {
      pendingWrites.current -= 1;
      syncAfterWrites();
    }
  }, [items, syncAfterWrites, unread]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      available: true,
      unread,
      openSafety,
      totalPending,
      items,
      listStatus,
      watchItems,
      reloadItems: loadItems,
      markRead,
      markAllRead,
    }),
    [
      items,
      listStatus,
      loadItems,
      markAllRead,
      markRead,
      openSafety,
      totalPending,
      unread,
      watchItems,
    ],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
