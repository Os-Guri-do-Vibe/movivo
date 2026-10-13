'use client';

import { CheckCheck, Inbox, RefreshCw } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { getNotificationHistory } from '@/lib/dashboard-api';
import type { NotificationHistoryItem, NotificationHistoryQuery } from '@/lib/dashboard-types';
import { dayKey, dayLabel } from '@/lib/notification-copy';
import { cn } from '@/lib/utils';

import { SectorHeader } from './control-center-ui';
import { NotificationRow } from './notification-row';
import { useNotifications } from './notifications-provider';
import { SafetyStrip } from './safety-strip';

const STATUS_MESSAGE_MS = 4_000;
const STATE_PARAM = { all: undefined, unread: 'nao-lidas' } as const;
const TYPE_PARAM = { all: undefined, alert: 'alertas', queue: 'fila' } as const;

type Phase = 'loading' | 'ready' | 'error';

function groupByDay(items: NotificationHistoryItem[]) {
  const groups: Array<{ key: string; label: string; items: NotificationHistoryItem[] }> = [];
  for (const item of items) {
    const key = dayKey(item.createdAt);
    const last = groups.at(-1);
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, label: dayLabel(item.createdAt), items: [item] });
  }
  return groups;
}

function FilterGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  const labelId = `filter-${label}`;
  return (
    <div className="flex items-center gap-2">
      <span id={labelId} className="text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <div role="group" aria-labelledby={labelId} className="flex gap-1 overflow-x-auto">
        {options.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={value === option.value ? 'secondary' : 'ghost'}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * Registro completo das notificações do profissional: alertas do AI Coach e itens da Fila,
 * lidos ou não, pendentes ou já decididos (últimos 30 dias). O sino mostra só as não lidas;
 * aqui fica tudo. Ler não resolve: a pendência continua em Alertas e na Fila.
 */
export function NotificationsBoard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { markAllRead } = useNotifications();
  const state: NotificationHistoryQuery['state'] =
    searchParams.get('estado') === STATE_PARAM.unread ? 'unread' : 'all';
  const type: NotificationHistoryQuery['type'] =
    searchParams.get('tipo') === TYPE_PARAM.alert
      ? 'alert'
      : searchParams.get('tipo') === TYPE_PARAM.queue
        ? 'queue'
        : 'all';

  const [items, setItems] = useState<NotificationHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [openSafety, setOpenSafety] = useState(0);
  const [phase, setPhase] = useState<Phase>('loading');
  const [moreState, setMoreState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [hasNew, setHasNew] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const current = ++requestId.current;
    setHasNew(false);
    try {
      const page = await getNotificationHistory({ state, type });
      if (current !== requestId.current) return;
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setSnapshotAt(page.snapshotAt);
      setUnread(page.unread);
      setOpenSafety(page.openSafety);
      setPhase('ready');
      setMoreState('idle');
    } catch {
      if (current === requestId.current) setPhase('error');
    }
  }, [state, type]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const events = new EventSource('/api/dashboard/queue/events');
    // A lista não é empurrada sob os olhos da pessoa: só avisa que há novidade.
    events.addEventListener('queue.updated', () => setHasNew(true));
    return () => events.close();
  }, []);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(''), STATUS_MESSAGE_MS);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  function setFilter(next: { state?: typeof state; type?: typeof type }) {
    const params = new URLSearchParams(searchParams.toString());
    const nextState = next.state ?? state;
    const nextType = next.type ?? type;
    for (const [key, value] of [
      ['estado', STATE_PARAM[nextState]],
      ['tipo', TYPE_PARAM[nextType]],
    ] as const) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  async function loadMore() {
    if (!nextCursor) return;
    setMoreState('loading');
    try {
      const page = await getNotificationHistory({ state, type, cursor: nextCursor });
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
      setMoreState('idle');
      setStatusMessage(`Mais ${page.items.length} notificações carregadas.`);
    } catch {
      setMoreState('error');
    }
  }

  async function markEverythingRead() {
    if (unread === 0) return;
    setActionError('');
    const { ok, count } = await markAllRead(snapshotAt ?? undefined);
    if (!ok) {
      setActionError('Não foi possível marcar como lidas. Tente novamente.');
      return;
    }
    setUnread(0);
    // No filtro "Não lidas" tudo o que estava na lista deixa de pertencer a ela.
    setItems((current) =>
      state === 'unread' ? [] : current.map((item) => ({ ...item, read: true })),
    );
    setStatusMessage(
      count === 1
        ? '1 notificação marcada como lida.'
        : `${count} notificações marcadas como lidas.`,
    );
  }

  const groups = useMemo(() => groupByDay(items), [items]);
  const filtered = state !== 'all' || type !== 'all';

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectorHeader
        title="Notificações"
        icon={Inbox}
        meta={
          snapshotAt
            ? { generatedAt: snapshotAt, timezone: 'America/Sao_Paulo', dataQuality: [] }
            : undefined
        }
        refreshing={phase === 'loading'}
        onRefresh={() => void load()}
      />
      <p className="-mt-2 text-body text-muted-foreground">
        Alertas do AI Coach e itens da Fila do Profissional dos últimos 30 dias. Ler não resolve:
        pendências continuam em Alertas e na Fila.
      </p>
      <SafetyStrip count={openSafety} />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <FilterGroup
          label="Mostrar"
          value={state}
          onChange={(value) => setFilter({ state: value })}
          options={[
            { value: 'all', label: 'Todas' },
            { value: 'unread', label: `Não lidas (${unread})` },
          ]}
        />
        <FilterGroup
          label="Tipo"
          value={type}
          onChange={(value) => setFilter({ type: value })}
          options={[
            { value: 'all', label: 'Todos' },
            { value: 'alert', label: 'Alertas' },
            { value: 'queue', label: 'Fila' },
          ]}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-disabled={unread === 0}
          title={unread === 0 ? 'Não há notificações não lidas.' : undefined}
          className={cn('sm:ml-auto', unread === 0 && 'cursor-not-allowed opacity-50')}
          onClick={() => void markEverythingRead()}
        >
          <CheckCheck aria-hidden="true" className="size-4" />
          Marcar todas como lidas
        </Button>
      </div>
      <div role="status" className="text-xs text-muted-foreground">
        {statusMessage}
      </div>
      {actionError ? (
        <p role="alert" className="text-label font-medium text-destructive">
          {actionError}
        </p>
      ) : null}
      {hasNew ? (
        <Button type="button" variant="secondary" size="sm" onClick={() => void load()}>
          Novas notificações · Mostrar
        </Button>
      ) : null}

      {phase === 'loading' && items.length === 0 ? (
        <div role="status" aria-label="Carregando notificações" className="space-y-2">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="h-14 animate-pulse rounded-lg bg-secondary" />
          ))}
        </div>
      ) : phase === 'error' ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-body text-muted-foreground">
            Não foi possível carregar as notificações.
          </p>
          <Button className="mt-3" variant="outline" onClick={() => void load()}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Tentar novamente
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <Inbox aria-hidden="true" className="mx-auto size-8 text-muted-foreground" />
          {state === 'unread' ? (
            <>
              <h2 className="mt-3 text-h3 font-bold">Nenhuma notificação não lida</h2>
              <p className="mt-2 text-body text-muted-foreground">
                As que você já abriu continuam listadas em Todas.
              </p>
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => setFilter({ state: 'all' })}
              >
                Ver todas
              </Button>
            </>
          ) : filtered ? (
            <>
              <h2 className="mt-3 text-h3 font-bold">
                {type === 'alert'
                  ? 'Nenhum alerta nos últimos 30 dias'
                  : 'Nenhum item da Fila nos últimos 30 dias'}
              </h2>
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => setFilter({ state: 'all', type: 'all' })}
              >
                Limpar filtros
              </Button>
            </>
          ) : (
            <>
              <h2 className="mt-3 text-h3 font-bold">Nenhuma notificação nos últimos 30 dias</h2>
              <p className="mt-2 text-body text-muted-foreground">
                Alertas do AI Coach e itens da Fila do Profissional aparecem aqui assim que chegam.
              </p>
            </>
          )}
        </div>
      ) : (
        <div aria-busy={phase === 'loading'} className="space-y-6">
          {groups.map((group) => (
            <section key={group.key} aria-labelledby={`dia-${group.key}`}>
              <h2
                id={`dia-${group.key}`}
                className="sticky top-[7.5rem] z-10 bg-background py-1 text-label font-semibold text-muted-foreground md:top-16"
              >
                {group.label}
              </h2>
              <ul className="mt-2 space-y-2">
                {group.items.map((item) => (
                  <NotificationRow key={`${item.type}:${item.id}`} item={item} variant="full" />
                ))}
              </ul>
            </section>
          ))}
          <div className="text-center">
            {moreState === 'error' ? (
              <div>
                <p className="text-label text-muted-foreground">
                  Não foi possível carregar mais notificações.
                </p>
                <Button
                  className="mt-2"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadMore()}
                >
                  Tentar novamente
                </Button>
              </div>
            ) : nextCursor ? (
              <Button
                variant="outline"
                disabled={moreState === 'loading'}
                onClick={() => void loadMore()}
              >
                {moreState === 'loading' ? 'Carregando…' : 'Carregar mais'}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                Fim das notificações dos últimos 30 dias.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
