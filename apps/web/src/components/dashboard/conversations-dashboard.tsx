'use client';

import type {
  ControlCenterConversationMessage,
  ControlCenterConversationSummary,
} from '@movivo/shared';
import { ArrowLeft, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { getConversationMessages, getConversations } from '@/lib/control-center-api';
import { cn } from '@/lib/utils';

import { EmptyState, ResourceState, useControlCenterResource } from './control-center-ui';
import { formatPhone } from './protocol-anamnesis-answers';

const TIMEZONE = 'America/Sao_Paulo';

const dayKeyFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE });
const timeFormat = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
});
const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const longDateFormat = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIMEZONE,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const dayKey = (iso: string) => dayKeyFormat.format(new Date(iso));

/** "Hoje" / "Ontem" / null — o resto cada chamador formata do seu jeito. */
function relativeDay(iso: string, now = new Date()): 'today' | 'yesterday' | null {
  const key = dayKey(iso);
  if (key === dayKeyFormat.format(now)) return 'today';
  if (key === dayKeyFormat.format(new Date(now.getTime() - 86_400_000))) return 'yesterday';
  return null;
}

/** "14:32" hoje, "Ontem", ou a data — como na lista do WhatsApp Web. */
function listTimestamp(iso: string): string {
  const relative = relativeDay(iso);
  if (relative === 'today') return timeFormat.format(new Date(iso));
  if (relative === 'yesterday') return 'Ontem';
  return dateFormat.format(new Date(iso));
}

function daySeparator(iso: string): string {
  const relative = relativeDay(iso);
  if (relative === 'today') return 'Hoje';
  if (relative === 'yesterday') return 'Ontem';
  return longDateFormat.format(new Date(iso));
}

function displayName(name: string | null, phoneNumber: string): string {
  return name?.trim() || formatPhone(phoneNumber);
}

function initials(label: string): string {
  const parts = label
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

const MESSAGE_TYPE_LABEL: Partial<Record<ControlCenterConversationMessage['messageType'], string>> =
  {
    IMAGE: 'Imagem',
    AUDIO: 'Áudio',
    TEMPLATE: 'Modelo',
    SYSTEM: 'Sistema',
  };

/** Foto do WhatsApp (via BFF same-origin); se não houver ou falhar, iniciais. */
function Avatar({ studentId, label }: { studentId: string; label: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [studentId]);
  return (
    <span className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-label font-semibold text-muted-foreground">
      <span aria-hidden="true">{initials(label)}</span>
      {failed ? null : (
        // eslint-disable-next-line @next/next/no-img-element -- rota BFF same-origin com bytes de foto; sem otimização de imagem.
        <img
          src={`/api/dashboard/conversations/${studentId}/photo`}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </span>
  );
}

function ConversationList({
  conversations,
  selectedId,
  onSelect,
}: {
  conversations: readonly ControlCenterConversationSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return conversations;
    const digits = term.replace(/\D/g, '');
    return conversations.filter(
      (item) =>
        (item.name ?? '').toLowerCase().includes(term) ||
        (digits.length > 0 && item.phoneNumber.replace(/\D/g, '').includes(digits)),
    );
  }, [conversations, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border p-3">
        <label className="relative block">
          <span className="sr-only">Buscar conversa por nome ou número</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nome ou número"
            className="h-10 w-full rounded-lg border border-border bg-background pr-3 pl-9 text-body placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
          />
        </label>
      </div>
      {visible.length === 0 ? (
        <p className="p-6 text-center text-body text-muted-foreground">
          {conversations.length === 0
            ? 'Nenhuma conversa registrada ainda.'
            : 'Nenhuma conversa corresponde à busca.'}
        </p>
      ) : (
        <ul aria-label="Conversas" className="min-h-0 flex-1 overflow-y-auto">
          {visible.map((item) => {
            const label = displayName(item.name, item.phoneNumber);
            const selected = item.studentId === selectedId;
            return (
              <li key={item.studentId}>
                <button
                  type="button"
                  onClick={() => onSelect(item.studentId)}
                  aria-current={selected ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-center gap-3 border-b border-border/60 px-3 py-3 text-left transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
                    selected && 'bg-muted',
                  )}
                >
                  <Avatar studentId={item.studentId} label={label} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-semibold text-foreground">
                      {label}
                    </span>
                    <span className="block truncate text-label text-muted-foreground">
                      {formatPhone(item.phoneNumber)}
                    </span>
                  </span>
                  <time
                    dateTime={item.lastMessageAt}
                    className="shrink-0 self-start pt-0.5 text-[0.6875rem] text-muted-foreground"
                  >
                    {listTimestamp(item.lastMessageAt)}
                  </time>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  studentLabel,
}: {
  message: ControlCenterConversationMessage;
  studentLabel: string;
}) {
  const outbound = message.direction === 'OUTBOUND';
  const typeLabel = MESSAGE_TYPE_LABEL[message.messageType];
  return (
    <div className={cn('flex flex-col', outbound ? 'items-end' : 'items-start')}>
      <span className="mb-0.5 max-w-[80%] truncate px-1 text-[0.6875rem] text-muted-foreground">
        {outbound ? 'MOVIVO' : studentLabel}
      </span>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl border px-3 py-2 text-body sm:max-w-[75%]',
          outbound
            ? 'rounded-tr-sm border-verde-pulso/30 bg-verde-pulso/15'
            : 'rounded-tl-sm border-border bg-card',
        )}
      >
        {typeLabel ? (
          <span className="mb-1 block text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">
            {typeLabel}
          </span>
        ) : null}
        <p className="break-words whitespace-pre-wrap text-foreground">{message.content}</p>
        <time
          dateTime={message.createdAt}
          className="mt-1 block text-right text-[0.625rem] text-muted-foreground"
        >
          {timeFormat.format(new Date(message.createdAt))}
        </time>
      </div>
    </div>
  );
}

type ScrollIntent = { kind: 'bottom' } | { kind: 'keep'; height: number };

function ChatPanel({
  student,
  onBack,
}: {
  student: ControlCenterConversationSummary;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<ControlCenterConversationMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  // O que o `useLayoutEffect` faz após renderizar: descer ao fim (abrir/atualizar) ou
  // manter a posição de leitura (ao inserir mensagens antigas no topo).
  const scrollIntent = useRef<ScrollIntent | null>(null);
  const label = displayName(student.name, student.phoneNumber);

  const loadLatest = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError('');
      try {
        const res = await getConversationMessages(student.studentId, undefined, signal);
        scrollIntent.current = { kind: 'bottom' };
        setMessages(res.data.messages);
        setOlderCursor(res.data.olderCursor);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setMessages([]);
        setOlderCursor(null);
        setError(
          caught instanceof Error ? caught.message : 'Não foi possível carregar a conversa.',
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [student.studentId],
  );

  useEffect(() => {
    setMessages([]);
    setOlderCursor(null);
    const controller = new AbortController();
    void loadLatest(controller.signal);
    return () => controller.abort();
  }, [loadLatest]);

  useLayoutEffect(() => {
    const el = scroller.current;
    const intent = scrollIntent.current;
    if (!el || !intent) return;
    el.scrollTop = intent.kind === 'bottom' ? el.scrollHeight : el.scrollHeight - intent.height;
    scrollIntent.current = null;
  }, [messages]);

  async function loadOlder() {
    if (!olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    setError('');
    try {
      const res = await getConversationMessages(student.studentId, olderCursor);
      scrollIntent.current = { kind: 'keep', height: scroller.current?.scrollHeight ?? 0 };
      setMessages((current) => [...res.data.messages, ...current]);
      setOlderCursor(res.data.olderCursor);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Não foi possível carregar mais mensagens.',
      );
    } finally {
      setLoadingOlder(false);
    }
  }

  return (
    <section aria-label={`Conversa com ${label}`} className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-card px-3 py-2.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="Voltar para a lista de conversas"
          className="md:hidden"
        >
          <ArrowLeft aria-hidden="true" />
        </Button>
        <Avatar studentId={student.studentId} label={label} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-body font-semibold text-foreground">{label}</h2>
          <p className="truncate text-label text-muted-foreground">
            {formatPhone(student.phoneNumber)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void loadLatest()}
          disabled={loading}
          aria-label="Atualizar conversa"
        >
          <RefreshCw aria-hidden="true" className={cn(loading && 'animate-spin')} />
        </Button>
      </header>

      <div
        ref={scroller}
        role="log"
        aria-label="Mensagens"
        className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/40 px-3 py-4 sm:px-6"
      >
        {olderCursor ? (
          <div className="flex justify-center pb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadOlder()}
              disabled={loadingOlder}
            >
              {loadingOlder ? 'Carregando…' : 'Carregar mensagens anteriores'}
            </Button>
          </div>
        ) : null}
        {loading && messages.length === 0 ? (
          <p role="status" className="py-10 text-center text-body text-muted-foreground">
            Carregando conversa…
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-lg border border-coral bg-card p-3 text-body">
            {error}
          </p>
        ) : null}
        {!loading && !error && messages.length === 0 ? (
          <p className="py-10 text-center text-body text-muted-foreground">
            Nenhuma mensagem nesta conversa.
          </p>
        ) : null}
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const newDay = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt);
          return (
            <div key={message.id} className="space-y-2">
              {newDay ? (
                <div className="flex justify-center py-1">
                  <span className="rounded-full bg-card px-3 py-1 text-[0.6875rem] font-medium text-muted-foreground shadow-sm">
                    {daySeparator(message.createdAt)}
                  </span>
                </div>
              ) : null}
              <MessageBubble message={message} studentLabel={label} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Aba "Conversas": lista de alunos à esquerda e histórico do WhatsApp à direita, no molde
 * do WhatsApp Web. Em telas estreitas mostra uma coluna por vez (lista → conversa).
 * Somente leitura — a MOVIVO responde pelo fluxo do AI Coach, nunca por esta tela.
 */
export function ConversationsDashboard() {
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(getConversations);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const conversations = useMemo(() => data?.data.conversations ?? [], [data]);
  const selected = conversations.find((item) => item.studentId === selectedId) ?? null;

  if (!data) {
    return (
      <ResourceState loading={loading} error={error} forbidden={forbidden} onRetry={refresh} />
    );
  }

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[28rem] overflow-hidden rounded-xl border border-border bg-card md:h-[calc(100dvh-8.5rem)]">
      <aside
        aria-label="Lista de conversas"
        className={cn(
          'min-h-0 w-full flex-col border-border md:flex md:w-80 md:shrink-0 md:border-r lg:w-96',
          selected ? 'hidden' : 'flex',
        )}
      >
        <ConversationList
          conversations={conversations}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </aside>
      <div className={cn('min-w-0 flex-1 flex-col md:flex', selected ? 'flex' : 'hidden')}>
        {selected ? (
          <ChatPanel
            key={selected.studentId}
            student={selected}
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState
              title="Selecione uma conversa"
              description="Escolha um aluno na lista para ver o histórico do WhatsApp com a MOVIVO."
            />
          </div>
        )}
      </div>
    </div>
  );
}
