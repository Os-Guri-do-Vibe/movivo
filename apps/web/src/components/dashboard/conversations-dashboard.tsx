'use client';

import {
  CONTROL_CENTER_MANUAL_MESSAGE_MAX_LENGTH,
  controlCenterConversationAttendanceEventSchema,
  controlCenterConversationMessageEventSchema,
  controlCenterConversationReadEventSchema,
  splitWhatsappBubbles,
  type ControlCenterConversationMessage,
  type ControlCenterConversationSummary,
} from '@movivo/shared';
import { ArrowDown, ArrowLeft, Pause, Play, RefreshCw, Search, SendHorizontal } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

import { Button } from '@/components/ui/button';
import {
  getConversationMessages,
  getConversations,
  getNewerConversationMessages,
  markConversationRead,
  sendConversationMessage,
  setConversationAiPaused,
} from '@/lib/control-center-api';
import { cn } from '@/lib/utils';

import { EmptyState, ResourceState, useControlCenterResource } from './control-center-ui';
import { formatPhone } from './protocol-anamnesis-answers';

const TIMEZONE = 'America/Sao_Paulo';

const EVENTS_URL = '/api/dashboard/conversations/events';
/** Sem o stream (navegador sem SSE ou conexão caída), o chat aberto é consultado neste ritmo. */
const FALLBACK_POLL_MS = 15_000;
/** A lista só é recarregada por aluno novo no máximo uma vez por esta janela. */
const LIST_REFRESH_MIN_GAP_MS = 5_000;
/** Distância do fim a partir da qual o leitor "saiu do rodapé" e não é puxado para baixo. */
const STICK_TO_BOTTOM_PX = 120;
/** Tamanho máximo de uma página de mensagens novas — se vier cheia, ainda pode haver mais. */
const NEWER_PAGE_SIZE = 100;

type LiveStatus = 'CONNECTED' | 'DEGRADED';

/** Como no WhatsApp Web: o selo para de contar em 99. */
const unreadLabel = (count: number) => (count > 99 ? '99+' : String(count));

/** `data` do evento SSE como JSON, ou `undefined` se vier malformado (nunca derruba a tela). */
function eventData(raw: Event): unknown {
  try {
    return JSON.parse((raw as MessageEvent<string>).data) as unknown;
  } catch {
    return undefined;
  }
}

/** Aviso de mensagem nova para o chat aberto. `seq` distingue avisos repetidos do mesmo aluno. */
interface LiveMessageEvent {
  seq: number;
  studentId: string;
  messageId?: string;
}

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

/** Áudio e imagem aparecem como mídia no próprio balão; os demais tipos levam um rótulo. */
const MESSAGE_TYPE_LABEL: Partial<Record<ControlCenterConversationMessage['messageType'], string>> =
  {
    TEMPLATE: 'Modelo',
    SYSTEM: 'Sistema',
  };

/** Quem escreveu, para o profissional distinguir o Coach, o aviso automático e uma pessoa. */
function senderLabel(message: ControlCenterConversationMessage, studentLabel: string): string {
  switch (message.origin) {
    case 'STUDENT':
      return studentLabel;
    case 'COACH':
      return 'AI Coach';
    case 'SYSTEM':
      return 'MOVIVO · aviso automático';
    case 'PROFESSIONAL':
      return 'Profissional CREF';
    default:
      return message.direction === 'OUTBOUND' ? 'MOVIVO' : studentLabel;
  }
}

const mediaUrl = (studentId: string, messageId: string) =>
  `/api/dashboard/conversations/${studentId}/messages/${messageId}/media`;

/** "0:07" / "1:05" — a duração que o WhatsApp informa do áudio. */
function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

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
              <li key={item.studentId} className="p-1.5">
                <button
                  type="button"
                  onClick={() => onSelect(item.studentId)}
                  aria-current={selected ? 'true' : undefined}
                  // Borda = estado do atendimento automático do AI Coach: vermelha pausado,
                  // verde ativo. O texto para leitor de tela está logo abaixo (a cor sozinha
                  // não carrega a informação).
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg border-2 px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none',
                    item.aiPaused ? 'border-red-600' : 'border-emerald-600',
                    selected && 'bg-muted',
                  )}
                >
                  <span className="sr-only">
                    {item.aiPaused
                      ? 'Atendimento automático pausado.'
                      : 'Atendimento automático ativo.'}
                    {item.unreadCount > 0
                      ? ` ${item.unreadCount} ${item.unreadCount === 1 ? 'mensagem não lida' : 'mensagens não lidas'}.`
                      : ''}
                  </span>
                  <Avatar studentId={item.studentId} label={label} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-semibold text-foreground">
                      {label}
                    </span>
                    <span className="block truncate text-label text-muted-foreground">
                      {formatPhone(item.phoneNumber)}
                    </span>
                  </span>
                  {/* Horário no topo; selo de não lidas no fim do retângulo, como no WhatsApp Web
                      (o horário também fica verde enquanto há mensagem não lida). */}
                  <span className="flex shrink-0 flex-col items-end justify-between gap-1.5 self-stretch">
                    <time
                      dateTime={item.lastMessageAt}
                      className={cn(
                        'pt-0.5 text-[0.6875rem]',
                        item.unreadCount > 0
                          ? 'font-semibold text-emerald-700'
                          : 'text-muted-foreground',
                      )}
                    >
                      {listTimestamp(item.lastMessageAt)}
                    </time>
                    {item.unreadCount > 0 ? (
                      <span
                        aria-hidden="true"
                        className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-700 px-1.5 text-[0.6875rem] font-semibold text-white"
                      >
                        {unreadLabel(item.unreadCount)}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Áudio ou imagem do balão. O arquivo vem da rota autorizada e auditada, nunca embutido na lista. */
function MessageMedia({
  media,
  message,
  studentId,
  studentLabel,
}: {
  media: NonNullable<ControlCenterConversationMessage['media']>;
  message: ControlCenterConversationMessage;
  studentId: string;
  studentLabel: string;
}) {
  const [failed, setFailed] = useState(false);
  const isAudio = media.kind === 'AUDIO';
  const noun = isAudio ? 'Áudio' : 'Imagem';
  if (media.status === 'PENDING') {
    return (
      <p role="status" className="text-label text-muted-foreground">
        {noun === 'Áudio' ? 'Carregando áudio…' : 'Carregando imagem…'}
      </p>
    );
  }
  if (media.status === 'FAILED' || failed) {
    return (
      <p className="text-label text-muted-foreground">
        {isAudio ? 'Áudio indisponível' : 'Imagem indisponível'} — não foi possível baixá-lo do
        WhatsApp.
      </p>
    );
  }
  const src = mediaUrl(studentId, message.id);
  if (isAudio) {
    return (
      <div className="space-y-1">
        {/* `preload="none"`: cada abertura do arquivo é um acesso auditado a dado de saúde —
            só acontece quando o profissional dá play. */}
        <audio
          controls
          preload="none"
          src={src}
          onError={() => setFailed(true)}
          aria-label={`Áudio de ${senderLabel(message, studentLabel)}${
            media.seconds ? `, ${clock(media.seconds)}` : ''
          }`}
          className="h-10 w-64 max-w-full"
        />
        {media.seconds ? (
          <span className="block text-[0.6875rem] text-muted-foreground">
            Duração {clock(media.seconds)}
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element -- rota BFF same-origin com bytes decifrados; sem otimização de imagem. */}
      <img
        src={src}
        alt={`Imagem enviada por ${senderLabel(message, studentLabel)}${
          message.content ? `: ${message.content}` : ''
        }`}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="max-h-80 w-auto max-w-full rounded-lg object-contain"
      />
    </a>
  );
}

function MessageBubble({
  message,
  studentId,
  studentLabel,
}: {
  message: ControlCenterConversationMessage;
  studentId: string;
  studentLabel: string;
}) {
  const outbound = message.direction === 'OUTBOUND';
  const typeLabel = MESSAGE_TYPE_LABEL[message.messageType];
  // Texto, legenda da imagem ou transcrição do áudio.
  const text = message.content.trim();
  // Uma resposta com `---` sai no WhatsApp como vários balões, gravada como uma linha só:
  // o painel mostra um balão por trecho. Legenda e transcrição são de UMA mensagem.
  const parts = message.media ? (text ? [text] : []) : splitWhatsappBubbles(text);
  // Mídia sem texto ainda precisa de um balão (e do horário).
  const bubbles = parts.length > 0 ? parts : [''];
  const time = timeFormat.format(new Date(message.createdAt));
  return (
    <div className={cn('flex flex-col gap-1', outbound ? 'items-end' : 'items-start')}>
      <span className="mb-0.5 max-w-[80%] truncate px-1 text-[0.6875rem] text-muted-foreground">
        {senderLabel(message, studentLabel)}
      </span>
      {bubbles.map((part, index) => (
        <div
          key={index}
          className={cn(
            'max-w-[85%] rounded-2xl border px-3 py-2 text-body sm:max-w-[75%]',
            outbound ? 'border-verde-pulso/30 bg-verde-pulso/15' : 'border-border bg-card',
            // Só o primeiro balão tem a "ponta" do remetente, como no WhatsApp.
            index === 0 && (outbound ? 'rounded-tr-sm' : 'rounded-tl-sm'),
          )}
        >
          {index === 0 && typeLabel ? (
            <span className="mb-1 block text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">
              {typeLabel}
            </span>
          ) : null}
          {index === 0 && message.media ? (
            <div className="mb-1">
              <MessageMedia
                media={message.media}
                message={message}
                studentId={studentId}
                studentLabel={studentLabel}
              />
            </div>
          ) : null}
          {part ? (
            <p className="break-words whitespace-pre-wrap text-foreground">
              {message.media?.kind === 'AUDIO' ? (
                <span className="mb-0.5 block text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">
                  Transcrição
                </span>
              ) : null}
              {part}
            </p>
          ) : null}
          <time
            dateTime={message.createdAt}
            className="mt-1 block text-right text-[0.625rem] text-muted-foreground"
          >
            {time}
          </time>
        </div>
      ))}
    </div>
  );
}

type ScrollIntent = { kind: 'bottom' } | { kind: 'keep'; height: number };

function ChatPanel({
  student,
  onBack,
  onAiPausedChange,
  onMessageSent,
  liveEvent,
  catchUpTick,
  liveStatus,
  onMarkRead,
  onUnreadGrow,
}: {
  student: ControlCenterConversationSummary;
  onBack: () => void;
  onAiPausedChange: (paused: boolean) => void;
  onMessageSent: (createdAt: string) => void;
  liveEvent: LiveMessageEvent | null;
  catchUpTick: number;
  liveStatus: LiveStatus;
  /** Zera o selo deste aluno (marca como lido até `upTo`, a última mensagem vista). */
  onMarkRead: (upTo?: string) => void;
  /** Chegou mensagem do aluno que o leitor ainda não viu (rolou para cima ou aba em segundo plano). */
  onUnreadGrow: (count: number) => void;
}) {
  const [messages, setMessages] = useState<ControlCenterConversationMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [actionError, setActionError] = useState('');
  const [unseen, setUnseen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  // Espelhos para o tempo real ler o estado atual sem recriar o efeito a cada mensagem.
  const messagesRef = useRef<ControlCenterConversationMessage[]>([]);
  const loadingRef = useRef(true);
  const stickToBottom = useRef(true);
  const syncing = useRef(false);
  const resync = useRef(false);
  // Última marca de leitura enviada: não repete o mesmo `upTo` (evita laço se o servidor ainda
  // devolver não lidas por causa de uma mensagem que esta tela ainda não buscou).
  const markedUpTo = useRef<string | null>(null);
  const paused = student.aiPaused;
  // O que o `useLayoutEffect` faz após renderizar: descer ao fim (abrir/atualizar) ou
  // manter a posição de leitura (ao inserir mensagens antigas no topo).
  const scrollIntent = useRef<ScrollIntent | null>(null);
  const label = displayName(student.name, student.phoneNumber);

  const loadLatest = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      loadingRef.current = true;
      setError('');
      try {
        const res = await getConversationMessages(student.studentId, undefined, signal);
        scrollIntent.current = { kind: 'bottom' };
        stickToBottom.current = true;
        markedUpTo.current = null;
        setUnseen(false);
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
        if (!signal?.aborted) {
          setLoading(false);
          loadingRef.current = false;
        }
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

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /** O leitor está de fato vendo o fim da conversa: carregada, aba visível e rolada até o rodapé. */
  const canMarkRead = useCallback(
    () => !loadingRef.current && document.visibilityState === 'visible' && stickToBottom.current,
    [],
  );

  const markReadNow = useCallback(() => {
    const upTo = messagesRef.current.at(-1)?.createdAt;
    const previous = markedUpTo.current;
    // Sem mensagem carregada só marca uma vez ("agora"); com mensagem, só se avançou.
    if (
      upTo === undefined
        ? previous !== null
        : previous !== null && previous !== 'now' && upTo <= previous
    ) {
      return;
    }
    markedUpTo.current = upTo ?? 'now';
    onMarkRead(upTo);
  }, [onMarkRead]);

  // Abrir a conversa, voltar para a aba ou descer até o fim lê o que estava pendente.
  useEffect(() => {
    if (student.unreadCount > 0 && canMarkRead()) markReadNow();
  }, [student.unreadCount, loading, unseen, catchUpTick, canMarkRead, markReadNow]);

  /**
   * Relê UMA mensagem já exibida e troca a linha pela nova. É como o áudio/imagem que estava
   * "carregando" vira player/foto: o servidor avisa de novo (mesmo id) quando o arquivo chega.
   */
  const refreshMessage = useCallback(
    async (id: string) => {
      const target = messagesRef.current.find((message) => message.id === id);
      if (!target) return;
      try {
        const res = await getNewerConversationMessages(student.studentId, target.createdAt);
        const updated = res.data.messages.find((message) => message.id === id);
        if (!updated) return;
        messagesRef.current = messagesRef.current.map((message) =>
          message.id === id ? updated : message,
        );
        setMessages(messagesRef.current);
      } catch {
        /* silencioso: o próximo aviso, a sondagem ou "Atualizar conversa" tenta de novo */
      }
    },
    [student.studentId],
  );

  /**
   * Traz só o que chegou depois da última mensagem conhecida e acrescenta ao fim. Falha em
   * silêncio (o chat já carregado continua intacto) — o próximo aviso ou o botão
   * "Atualizar conversa" tenta de novo. Chamadas simultâneas viram uma segunda rodada.
   */
  const fetchNewer = useCallback(async () => {
    if (loadingRef.current) return;
    if (syncing.current) {
      resync.current = true;
      return;
    }
    syncing.current = true;
    try {
      do {
        resync.current = false;
        const last = messagesRef.current.at(-1);
        const res = last
          ? await getNewerConversationMessages(student.studentId, last.createdAt)
          : await getConversationMessages(student.studentId);
        const known = new Set(messagesRef.current.map((message) => message.id));
        const fresh = res.data.messages.filter((message) => !known.has(message.id));
        if (fresh.length > 0) {
          if (stickToBottom.current) scrollIntent.current = { kind: 'bottom' };
          else setUnseen(true);
          if (!last) setOlderCursor(res.data.olderCursor);
          messagesRef.current = [...messagesRef.current, ...fresh];
          setMessages(messagesRef.current);
          // Só mensagem do aluno conta (a minha e o 👍/👎 do sistema, não). Se o leitor está
          // vendo o fim, já leu; senão fica como não lida.
          const fromStudent = fresh.filter(
            (message) => message.direction === 'INBOUND' && message.messageType !== 'SYSTEM',
          ).length;
          if (fromStudent > 0) {
            if (canMarkRead()) markReadNow();
            else onUnreadGrow(fromStudent);
          }
        }
        // Página cheia = pode haver mais; segue até esvaziar.
        if (last && res.data.messages.length >= NEWER_PAGE_SIZE) resync.current = true;
      } while (resync.current);
      // Mídia que ainda aparecia como "carregando" (aviso perdido): relê.
      for (const pending of messagesRef.current.filter((m) => m.media?.status === 'PENDING')) {
        void refreshMessage(pending.id);
      }
    } catch {
      /* silencioso de propósito — ver o comentário acima */
    } finally {
      syncing.current = false;
    }
  }, [student.studentId, canMarkRead, markReadNow, onUnreadGrow, refreshMessage]);

  const lastLiveSeq = useRef(0);
  useEffect(() => {
    if (!liveEvent || liveEvent.studentId !== student.studentId) return;
    if (liveEvent.seq === lastLiveSeq.current) return;
    lastLiveSeq.current = liveEvent.seq;
    const known = liveEvent.messageId
      ? messagesRef.current.find((m) => m.id === liveEvent.messageId)
      : undefined;
    if (known) {
      // O envio manual desta própria tela já tem a linha (veio na resposta do POST); mídia
      // que estava baixando precisa ser relida agora que chegou.
      if (known.media?.status === 'PENDING') void refreshMessage(known.id);
      return;
    }
    void fetchNewer();
  }, [liveEvent, student.studentId, fetchNewer, refreshMessage]);

  const initialCatchUpTick = useRef(catchUpTick);
  useEffect(() => {
    if (catchUpTick === initialCatchUpTick.current) return;
    void fetchNewer();
  }, [catchUpTick, fetchNewer]);

  function onLogScroll() {
    const el = scroller.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX;
    if (stickToBottom.current) setUnseen(false);
  }

  function jumpToBottom() {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    stickToBottom.current = true;
    setUnseen(false);
  }

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

  async function togglePaused() {
    if (toggling) return;
    setToggling(true);
    setActionError('');
    try {
      const res = await setConversationAiPaused(student.studentId, !paused);
      onAiPausedChange(res.data.aiPaused);
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : 'Não foi possível alterar o atendimento.',
      );
    } finally {
      setToggling(false);
    }
  }

  async function submitMessage(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!paused || !text || sending) return;
    setSending(true);
    setActionError('');
    try {
      const res = await sendConversationMessage(student.studentId, text);
      scrollIntent.current = { kind: 'bottom' };
      stickToBottom.current = true;
      setUnseen(false);
      messagesRef.current = [...messagesRef.current, res.data.message];
      setMessages(messagesRef.current);
      setDraft('');
      onMessageSent(res.data.message.createdAt);
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : 'Não foi possível enviar a mensagem.',
      );
    } finally {
      setSending(false);
    }
  }

  // Como no WhatsApp Web: Enter envia, Shift+Enter quebra a linha.
  function onDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submitMessage();
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
        <span
          className="hidden items-center gap-1.5 text-[0.6875rem] text-muted-foreground sm:flex"
          title={
            liveStatus === 'CONNECTED'
              ? 'Mensagens novas aparecem sozinhas.'
              : 'Sem conexão em tempo real: a conversa é verificada a cada 15 segundos.'
          }
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-2 rounded-full',
              liveStatus === 'CONNECTED' ? 'bg-emerald-600' : 'bg-amber-500',
            )}
          />
          {liveStatus === 'CONNECTED' ? 'Ao vivo' : 'Reconectando…'}
        </span>
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

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scroller}
          role="log"
          aria-label="Mensagens"
          onScroll={onLogScroll}
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
                <MessageBubble
                  message={message}
                  studentId={student.studentId}
                  studentLabel={label}
                />
              </div>
            );
          })}
        </div>
        {unseen ? (
          <Button
            type="button"
            size="sm"
            onClick={jumpToBottom}
            className="absolute right-4 bottom-3 rounded-full shadow-md"
          >
            <ArrowDown aria-hidden="true" />
            Novas mensagens
          </Button>
        ) : null}
      </div>

      <form
        onSubmit={(event) => void submitMessage(event)}
        aria-label="Enviar mensagem ao aluno"
        className="border-t border-border bg-card p-3"
      >
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Mensagem para {label}</span>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onDraftKeyDown}
              disabled={!paused || sending}
              rows={1}
              maxLength={CONTROL_CENTER_MANUAL_MESSAGE_MAX_LENGTH}
              placeholder={
                paused ? 'Digite uma mensagem' : 'Pause o atendimento automático para escrever'
              }
              className="block max-h-32 min-h-11 w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-body placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70"
            />
          </label>
          <Button
            type="submit"
            size="icon"
            disabled={!paused || sending || draft.trim().length === 0}
            aria-label="Enviar mensagem"
          >
            <SendHorizontal aria-hidden="true" />
          </Button>
          {/* Botão único que alterna: mostra a AÇÃO possível — "Pausar" com o AI Coach ativo,
              "Ativar" com ele pausado. */}
          <Button
            type="button"
            onClick={() => void togglePaused()}
            disabled={toggling}
            aria-label={
              paused
                ? 'Ativar o atendimento automático do AI Coach'
                : 'Pausar o atendimento automático do AI Coach'
            }
            className={cn(
              'text-white',
              paused ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-red-600 hover:bg-red-700',
            )}
          >
            {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            {paused ? 'Ativar' : 'Pausar'}
          </Button>
        </div>
        <p className="mt-2 text-label text-muted-foreground">
          {paused
            ? 'Atendimento automático pausado: o AI Coach não responde a este aluno. Suas mensagens saem pelo WhatsApp da MOVIVO.'
            : 'Atendimento automático ativo: o AI Coach responde ao aluno. Pause para escrever manualmente.'}
        </p>
        {actionError ? (
          <p role="alert" className="mt-2 rounded-lg border border-coral bg-card p-2 text-body">
            {actionError}
          </p>
        ) : null}
      </form>
    </section>
  );
}

/**
 * Aba "Conversas": lista de alunos à esquerda e histórico do WhatsApp à direita, no molde
 * do WhatsApp Web. Em telas estreitas mostra uma coluna por vez (lista → conversa).
 * A moldura de cada aluno mostra o estado do atendimento automático do AI Coach (vermelha
 * pausado, verde ativo). Com ele pausado o profissional escreve ao aluno por aqui; com ele
 * ativo o campo de mensagem fica travado, para a IA e um humano nunca responderem juntos.
 */
export function ConversationsDashboard({ preferredStudentId }: { preferredStudentId?: string }) {
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(getConversations);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Alterações feitas nesta tela (pausar/ativar, mensagem enviada) valem de imediato, sem
  // recarregar a lista; um novo carregamento do servidor passa a ser a fonte de verdade.
  const [overrides, setOverrides] = useState<
    Record<string, { aiPaused?: boolean; lastMessageAt?: string; unreadCount?: number }>
  >({});
  useEffect(() => setOverrides({}), [data]);
  const conversations = useMemo(
    () =>
      (data?.data.conversations ?? [])
        .map((item) => ({ ...item, ...overrides[item.studentId] }))
        // Mensagem nova leva o aluno ao topo, como no WhatsApp.
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)),
    [data, overrides],
  );
  useEffect(() => {
    if (preferredStudentId && conversations.some((item) => item.studentId === preferredStudentId)) {
      setSelectedId(preferredStudentId);
    }
  }, [conversations, preferredStudentId]);
  const patch = useCallback(
    (id: string, change: { aiPaused?: boolean; lastMessageAt?: string; unreadCount?: number }) =>
      setOverrides((current) => ({ ...current, [id]: { ...current[id], ...change } })),
    [],
  );

  // --- tempo real -----------------------------------------------------------------------
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('DEGRADED');
  const [liveEvent, setLiveEvent] = useState<LiveMessageEvent | null>(null);
  const [catchUpTick, setCatchUpTick] = useState(0);
  const liveSeq = useRef(0);
  const knownIds = useRef<ReadonlySet<string>>(new Set());
  const serverUnread = useRef<ReadonlyMap<string, number>>(new Map());
  const selectedRef = useRef<string | null>(null);
  const refreshRef = useRef(refresh);
  const lastListRefresh = useRef(0);
  const ready = data !== null;
  useEffect(() => {
    knownIds.current = new Set(conversations.map((item) => item.studentId));
    refreshRef.current = refresh;
  }, [conversations, refresh]);
  useEffect(() => {
    serverUnread.current = new Map(
      (data?.data.conversations ?? []).map((item) => [item.studentId, item.unreadCount]),
    );
  }, [data]);
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  /** Soma `count` ao selo do aluno (parte do valor atual, já com o que mudou nesta tela). */
  const bumpUnread = useCallback((id: string, count: number) => {
    setOverrides((current) => ({
      ...current,
      [id]: {
        ...current[id],
        unreadCount: (current[id]?.unreadCount ?? serverUnread.current.get(id) ?? 0) + count,
      },
    }));
  }, []);

  /** Lê a conversa: zera o selo na hora e confirma com o servidor (que devolve o que sobrou). */
  const markRead = useCallback(
    (id: string, upTo?: string) => {
      patch(id, { unreadCount: 0 });
      markConversationRead(id, upTo)
        .then((res) => patch(id, { unreadCount: res.data.unreadCount }))
        .catch(() => undefined); // melhor esforço: o selo se corrige no próximo carregamento
    },
    [patch],
  );

  useEffect(() => {
    if (!ready) return;
    let poll: number | undefined;
    let everOpened = false;
    // Pede ao chat aberto que busque o que perdeu (reconexão, aba que voltou, polling).
    const catchUp = () => {
      if (document.visibilityState === 'visible') setCatchUpTick((tick) => tick + 1);
    };
    const startPoll = () => {
      setLiveStatus('DEGRADED');
      poll ??= window.setInterval(catchUp, FALLBACK_POLL_MS);
    };
    const stopPoll = () => {
      if (poll !== undefined) window.clearInterval(poll);
      poll = undefined;
    };
    document.addEventListener('visibilitychange', catchUp);

    if (typeof EventSource === 'undefined') {
      startPoll();
      return () => {
        stopPoll();
        document.removeEventListener('visibilitychange', catchUp);
      };
    }

    const source = new EventSource(EVENTS_URL);
    source.onopen = () => {
      stopPoll();
      setLiveStatus('CONNECTED');
      // Reconectou: o que chegou no intervalo não gerou aviso — busca por garantia.
      if (everOpened) catchUp();
      everOpened = true;
    };
    source.onerror = startPoll;
    source.addEventListener('conversation.message', (raw) => {
      const parsed = controlCenterConversationMessageEventSchema.safeParse(eventData(raw));
      if (!parsed.success) return;
      const { studentId, at, messageId, direction } = parsed.data;
      liveSeq.current += 1;
      setLiveEvent({ seq: liveSeq.current, studentId, messageId });
      if (knownIds.current.has(studentId)) {
        patch(studentId, { lastMessageAt: at });
        // Conversa aberta: a própria tela conta o que é não lido (sabe se o leitor está no fim).
        if (direction === 'INBOUND' && studentId !== selectedRef.current) bumpUnread(studentId, 1);
      } else if (Date.now() - lastListRefresh.current > LIST_REFRESH_MIN_GAP_MS) {
        // Aluno que ainda não estava na lista (primeira mensagem): recarrega a lista.
        lastListRefresh.current = Date.now();
        void refreshRef.current();
      }
    });
    source.addEventListener('conversation.read', (raw) => {
      const parsed = controlCenterConversationReadEventSchema.safeParse(eventData(raw));
      if (parsed.success) patch(parsed.data.studentId, { unreadCount: parsed.data.unreadCount });
    });
    source.addEventListener('conversation.attendance', (raw) => {
      const parsed = controlCenterConversationAttendanceEventSchema.safeParse(eventData(raw));
      if (parsed.success) patch(parsed.data.studentId, { aiPaused: parsed.data.aiPaused });
    });

    return () => {
      source.close();
      stopPoll();
      document.removeEventListener('visibilitychange', catchUp);
    };
  }, [ready, patch, bumpUnread]);
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
            onAiPausedChange={(aiPaused) => patch(selected.studentId, { aiPaused })}
            onMessageSent={(lastMessageAt) => patch(selected.studentId, { lastMessageAt })}
            liveEvent={liveEvent}
            catchUpTick={catchUpTick}
            liveStatus={liveStatus}
            onMarkRead={(upTo) => markRead(selected.studentId, upTo)}
            onUnreadGrow={(count) => bumpUnread(selected.studentId, count)}
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
