'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ClipboardCheck,
  Eye,
  type LucideIcon,
  Pencil,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AnamnesisAnswersModal } from '@/components/dashboard/protocol-anamnesis-answers';
import { Button, buttonVariants } from '@/components/ui/button';
import { captureDashboardEvent, getQueue } from '@/lib/dashboard-api';
import type { QueueItem, QueueResponse } from '@/lib/dashboard-types';
import { cn } from '@/lib/utils';

import {
  CONTROL_H,
  FieldDivider,
  ICON_BUTTON,
  StatusBadge,
  type StatusTone,
} from './control-center-table';
import { SectorHeader } from './control-center-ui';

const FALLBACK_INTERVAL_MS = 30_000;

/**
 * Rótulo de severidade. `detail` é só o COMPLEMENTO da frase, nunca a frase inteira
 * duplicada: o pill renderiza `label` (curto, cabe ao lado do título em 1280px) e
 * compõe a forma longa — `title` no hover, `sr-only` no leitor de tela — a partir do
 * par. Só `SAFETY` tem complemento; `ALERT` e `ROUTINE` já são rótulos completos.
 *
 * Anotação explícita, e não `satisfies` como no resto do arquivo: `satisfies` só
 * VALIDA o literal, preservando o tipo inferido de cada entrada — e aí
 * `LABELS[item.severity].detail` não compila, porque as entradas sem `detail` não
 * têm a propriedade nem como opcional. A anotação é o que dá `detail?: string` às
 * três chaves de uma vez, mantendo a exaustividade do `Record` sobre a severidade.
 */
const LABELS: Record<QueueItem['severity'], { label: string; detail?: string; icon: LucideIcon }> =
  {
    SAFETY: { label: 'Segurança', detail: 'ação prioritária', icon: ShieldAlert },
    ALERT: { label: 'Atenção', icon: AlertTriangle },
    ROUTINE: { label: 'Revisão de rotina', icon: ClipboardCheck },
  };

/**
 * Severidade → tom do selo compartilhado (`control-center-table`). Só `ALERT` chega a
 * renderizar hoje: `ROUTINE` é a severidade de todo protocolo (não diferencia nada) e
 * `SAFETY` já é sinalizado pela faixa coral + ícone preenchido + título. As três
 * entradas ficam pra que a exaustividade do `Record` seja checada pelo compilador.
 */
const SEVERITY_TONE = {
  SAFETY: 'attention',
  ALERT: 'neutral',
  ROUTINE: 'quiet',
} satisfies Record<QueueItem['severity'], StatusTone>;

/**
 * Status do item → tom do selo. Só `BLOCKED` (PAR-Q travado) é alerta real; qualquer
 * outro valor que chegue aqui é estado neutro da fila, e cai no contorno discreto.
 */
const STATUS_TONE: Record<string, StatusTone> = { BLOCKED: 'attention' };

/** Cada categoria da fila do profissional ordena só por idade — mais antigo primeiro. */
export function sortQueue(items: QueueItem[]): QueueItem[] {
  return [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * `PENDING_SIGNATURE` é o status de praticamente todo protocolo desta fila (é o
 * motivo dele estar aqui) — exibi-lo é ruído, não informação.
 *
 * Exportada (achado 2026-08-18): `DashboardService.item()` no backend grava
 * `summary = status` para PROTOCOL/CHECKIN/HANDOFF — `queue-detail.tsx` reusa o mesmo
 * filtro pro cabeçalho da tela de revisão. Desde 2026-08-24 protocolo é o único kind que
 * chega nesta fila (PAR-Q bloqueante virou `origin: 'PARQ'` de um protocolo), então na
 * prática o filtro só age sobre protocolo.
 */
export function meaningfulText(value: string): string {
  return value === 'PENDING_SIGNATURE' ? '' : value;
}

function iconLinkClass(): string {
  return cn(buttonVariants({ variant: 'ghost', size: 'icon' }), ICON_BUTTON);
}

/**
 * Protocolo gerado pela IA e ainda não assinado dispara sozinho 1h após criado
 * (`PROTOCOL_OPTIONAL_REVIEW_WINDOW_MS`, `protocol-generation.worker.ts`) — aprovado
 * e enviado ao WhatsApp automaticamente se o CREF não agir antes. Só existe pra
 * protocolos `OPTIONAL` (é o único caso com job de auto-liberação agendado).
 */
function formatAutoRelease(autoReleaseAt: string): string {
  const minutesLeft = Math.round((new Date(autoReleaseAt).getTime() - Date.now()) / 60_000);
  if (minutesLeft <= 0) return 'Disparando automaticamente para o WhatsApp…';
  const when = minutesLeft < 60 ? `${minutesLeft} min` : `${Math.round(minutesLeft / 60)} h`;
  return `Dispara automaticamente pro WhatsApp em ${when} se ninguém agir antes`;
}

function QueueCard({ item, section }: { item: QueueItem; section: 'mandatory' | 'optional' }) {
  const { label, detail, icon: Icon } = LABELS[item.severity];
  const detailHref = `/dashboard/fila/${item.kind.toLowerCase()}/${encodeURIComponent(item.id)}`;
  const status = meaningfulText(item.status);
  const summary = meaningfulText(item.summary);
  const [anamnesisOpen, setAnamnesisOpen] = useState(false);
  // Olho aparece nas duas caixas da fila (achado 2026-08-18) — só não existe pra
  // handoff/check-in, que nem aparecem nesta tela (ver docstring de `queue()` no backend).
  // Desde 2026-08-24 protocolo é o único kind que chega aqui, PAR-Q bloqueante incluso.
  const showEye = item.kind === 'PROTOCOL';

  function track(view?: 'anamnesis') {
    captureDashboardEvent('cref_queue_item_opened', {
      kind: item.kind,
      severity: item.severity,
      ...(view ? { view } : {}),
    });
  }

  return (
    <li
      /*
       * A faixa de acento é SEMPRE `border-l-4` — inclusive no card sem acento, onde
       * ela fica na cor da borda normal. Antes só os acentuados engrossavam a borda, e
       * como `border-coral border-l-4` tinge os quatro lados, o conteúdo do card
       * acentuado nascia 3px deslocado em relação ao dos vizinhos.
       */
      className={cn(
        'rounded-xl border border-l-4 border-border bg-card p-4 text-card-foreground',
        item.severity === 'SAFETY'
          ? 'border-l-coral'
          : section === 'optional'
            ? 'border-l-verde-pulso'
            : null,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-full',
              item.severity === 'SAFETY'
                ? 'bg-destructive text-destructive-foreground'
                : item.severity === 'ALERT'
                  ? 'bg-secondary text-secondary-foreground'
                  : section === 'optional'
                    ? // Mesma lógica da faixa lateral (`border-l-verde-pulso`): a seção
                      // "Revisão Humana Opcional" é identificada por `section`, não por
                      // severidade. `text-petroleo` é o par de contraste da marca sobre
                      // verde-pulso (= `--primary` / `--primary-foreground` em
                      // `globals.css`) — branco aqui não passaria no 3:1 de WCAG 1.4.11.
                      'bg-verde-pulso text-petroleo'
                    : // Fora da seção opcional o item de rotina segue com contorno, não
                      // preenchimento: não há nada a sinalizar.
                      'border border-border text-muted-foreground',
            )}
          >
            <Icon aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-body font-semibold">{item.title}</h3>
              {item.severity !== 'ROUTINE' && item.severity !== 'SAFETY' ? (
                /*
                 * Pill curto + frase completa nos dois canais de leitura: `title` para
                 * mouse, `sr-only` para leitor de tela. O `·` é separador VISUAL e fica
                 * fora do texto falado — a vírgula entra no lugar dele para dar a pausa
                 * prosódica certa. O `sr-only` é `position:absolute`, então não
                 * interfere na altura de 24px do pill.
                 *
                 * `SAFETY` está fora desde 2026-08-20: o card de PAR-Q bloqueado já
                 * carrega a faixa `border-l-coral`, o ícone `ShieldAlert` em
                 * `bg-destructive` e (desde 2026-08-24) a legenda "Origem: PAR-Q
                 * bloqueante" logo abaixo. O pill "Segurança" era o quarto sinal
                 * redundante da mesma coisa. `LABELS` e
                 * `SEVERITY_TONE` mantêm as entradas de SAFETY — o par label/detail
                 * segue existindo, só não é mais renderizado aqui.
                 */
                <StatusBadge
                  tone={SEVERITY_TONE[item.severity]}
                  variant="solid"
                  title={detail ? `${label} · ${detail}` : undefined}
                >
                  {label}
                  {detail ? <span className="sr-only">, {detail}</span> : null}
                </StatusBadge>
              ) : null}
              {item.origin === 'PARQ' ? (
                /*
                 * Único sinal LEGÍVEL de que este protocolo obrigatório veio de um PAR-Q
                 * bloqueante (2026-08-24). A faixa coral e o ícone `bg-destructive` já
                 * marcam a severidade, mas os dois são puramente visuais — a faixa é CSS
                 * e o ícone é `aria-hidden` —, e o título ("Protocolo para Revisão:
                 * <aluno>") é idêntico ao de um protocolo opcional. Sem esta linha, um
                 * RT em leitor de tela não teria como distinguir os dois, e nem o RT
                 * vidente saberia se o card é PAR-Q ou `EDIT` (que só se diferencia pelo
                 * pill "Atenção"). Texto discreto de propósito: é a legenda do sinal que
                 * já existe, não um quarto sinal — e a tela de detalhe segue idêntica
                 * entre obrigatório e opcional, como pedido pelo fundador.
                 */
                <span className="text-xs font-medium text-muted-foreground">
                  Origem: PAR-Q bloqueante
                </span>
              ) : null}
            </div>
            {summary ? (
              <p className="mt-1.5 max-w-3xl text-label text-muted-foreground">{summary}</p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status && section !== 'mandatory' ? (
            <StatusBadge tone={STATUS_TONE[status] ?? 'quiet'} variant="solid">
              {status}
            </StatusBadge>
          ) : null}
          {showEye ? (
            <button
              type="button"
              onClick={() => {
                track('anamnesis');
                setAnamnesisOpen(true);
              }}
              className={iconLinkClass()}
              aria-label="Ver respostas da anamnese"
              title="Ver respostas da anamnese"
            >
              <Eye aria-hidden="true" />
            </button>
          ) : null}
          <Link
            href={detailHref}
            onClick={() => track()}
            className={iconLinkClass()}
            aria-label={item.kind === 'PROTOCOL' ? 'Abrir protocolo' : 'Abrir caso'}
            title={item.kind === 'PROTOCOL' ? 'Abrir protocolo' : 'Abrir caso'}
          >
            <Pencil aria-hidden="true" />
          </Link>
          {item.autoReleaseAt ? (
            <>
              {/* O relógio não é uma terceira ação: é informação. A hairline separa ele
                  do par olho/lápis, e o cinza o demove do peso de um botão de ação. */}
              <FieldDivider />
              <span className="group relative inline-flex">
                <button
                  type="button"
                  className={cn(
                    iconLinkClass(),
                    'cursor-default text-muted-foreground hover:bg-transparent',
                  )}
                  aria-label={formatAutoRelease(item.autoReleaseAt)}
                >
                  <Clock aria-hidden="true" />
                </button>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute right-0 bottom-full z-10 mb-2 w-max max-w-64 rounded-md border border-border bg-popover px-3 py-1.5 text-xs text-popover-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
                >
                  {formatAutoRelease(item.autoReleaseAt)}
                </span>
              </span>
            </>
          ) : null}
        </div>
      </div>
      {showEye ? (
        <AnamnesisAnswersModal
          kind="PROTOCOL"
          id={item.id}
          open={anamnesisOpen}
          onOpenChange={setAnamnesisOpen}
        />
      ) : null}
    </li>
  );
}

export function QueueBoard() {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [liveStatus, setLiveStatus] = useState<'CONNECTING' | 'CONNECTED' | 'DEGRADED'>(
    'CONNECTING',
  );
  const knownIds = useRef(new Set<string>());

  const load = useCallback(async (initial = false, signal?: AbortSignal) => {
    if (!initial) setRefreshing(true);
    setError('');
    try {
      const next = await getQueue(signal);
      const allItems = [...next.mandatory, ...next.optional];
      const newItems = allItems.filter((item) => !knownIds.current.has(item.id));
      if (knownIds.current.size > 0 && newItems.length > 0) {
        const safety = newItems.filter((item) => item.severity === 'SAFETY').length;
        setAnnouncement(
          safety > 0
            ? `${newItems.length} novo(s) item(ns), ${safety} de segurança prioritária.`
            : `${newItems.length} novo(s) item(ns) na fila.`,
        );
      }
      knownIds.current = new Set(allItems.map((item) => item.id));
      setData(next);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar a fila.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let fallbackInterval: number | undefined;
    let events: EventSource | undefined;
    let disposed = false;

    const pollWhenVisible = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    const startFallback = () => {
      if (disposed) return;
      setLiveStatus('DEGRADED');
      fallbackInterval ??= window.setInterval(pollWhenVisible, FALLBACK_INTERVAL_MS);
    };
    const stopFallback = () => {
      if (fallbackInterval !== undefined) window.clearInterval(fallbackInterval);
      fallbackInterval = undefined;
    };

    void load(true, controller.signal);

    if (typeof EventSource === 'undefined') {
      startFallback();
    } else {
      events = new EventSource('/api/dashboard/queue/events');
      events.onopen = () => {
        if (disposed) return;
        stopFallback();
        setLiveStatus('CONNECTED');
      };
      events.addEventListener('queue.updated', pollWhenVisible);
      events.onerror = startFallback;
    }

    document.addEventListener('visibilitychange', pollWhenVisible);
    return () => {
      disposed = true;
      controller.abort();
      events?.close();
      stopFallback();
      document.removeEventListener('visibilitychange', pollWhenVisible);
    };
  }, [load]);

  const mandatory = data ? sortQueue(data.mandatory) : [];
  const optional = data ? sortQueue(data.optional) : [];
  const total = mandatory.length + optional.length;

  if (!data && !error) {
    return (
      <div role="status" aria-label="Carregando fila" className="space-y-3">
        {/* A barra do topo reserva o lugar do título da seção — sem ela o conteúdo
            real chega e empurra a lista pra baixo. */}
        <div className="h-6 w-52 animate-pulse rounded-md bg-muted" />
        {[0, 1, 2].map((key) => (
          <div key={key} className="h-24 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }

  if (!data && error) {
    return (
      <section role="alert" className="rounded-xl border border-coral bg-card p-6">
        <AlertTriangle aria-hidden="true" className="size-6" />
        <h2 className="mt-3 text-h2 font-bold">A fila não carregou</h2>
        <p className="mt-2 text-body text-muted-foreground">{error}</p>
        <Button
          className={cn('mt-4', CONTROL_H)}
          variant="outline"
          type="button"
          onClick={() => void load(true)}
        >
          <RefreshCw aria-hidden="true" /> Tentar novamente
        </Button>
      </section>
    );
  }

  return (
    <section aria-label="Fila de supervisão">
      <div className="mb-6">
        <SectorHeader
          title="Fila de supervisão"
          refreshLabel="Atualizar fila"
          refreshing={refreshing}
          onRefresh={() => void load()}
        />
      </div>

      {/* Status de conexão em tempo real: só para leitor de tela — a pedido do usuário,
          não aparece mais como texto visível no painel. */}
      <p className="sr-only" role="status" aria-live="polite">
        {liveStatus === 'CONNECTED'
          ? 'Atualização em tempo real ativa.'
          : liveStatus === 'CONNECTING'
            ? 'Conectando à atualização em tempo real.'
            : 'Tempo real em reconexão. Contingência a cada 30 segundos enquanto esta aba está visível.'}
      </p>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      {error ? (
        <p role="alert" className="mb-4 rounded-lg border border-coral bg-card p-3 text-label">
          A última atualização falhou: {error}
        </p>
      ) : null}

      {total === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <CheckCircle2 aria-hidden="true" className="mx-auto size-10 text-muted-foreground" />
          <h2 className="mt-4 text-h3 font-semibold">Fila em dia</h2>
          <p className="mt-2 text-label text-muted-foreground">
            Não há protocolos pendentes de revisão agora.
          </p>
        </div>
      ) : (
        <div className="space-y-10">
          <QueueSection id="mandatory" title="Revisão Humana Obrigatória" items={mandatory} />
          <QueueSection id="optional" title="Revisão Humana Opcional" items={optional} />
        </div>
      )}
    </section>
  );
}

function QueueSection({
  id,
  title,
  items,
}: {
  id: 'mandatory' | 'optional';
  title: string;
  items: QueueItem[];
}) {
  const headingId = `queue-section-${id}`;
  return (
    /*
     * Sem caixa: a seção é um agrupamento TIPOGRÁFICO (título + espaço), não um
     * cartão. A caixa daqui embrulhava cards que já são caixas — caixa dentro de
     * caixa. A estrutura de acessibilidade (`aria-labelledby` + `h2`) é a mesma.
     */
    <section aria-labelledby={headingId}>
      <div className="mb-3 flex items-center gap-2">
        <h2 id={headingId} className="text-h3 font-semibold">
          {title}
        </h2>
        <span className="inline-flex h-6 items-center rounded-full border border-border px-2 font-mono text-xs text-muted-foreground tabular-nums">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card px-4 py-8 text-center text-label text-muted-foreground">
          Nada aqui agora.
        </p>
      ) : (
        <ol className="space-y-3" aria-label={title}>
          {items.map((item) => (
            <QueueCard key={`${item.kind}:${item.id}`} item={item} section={id} />
          ))}
        </ol>
      )}
    </section>
  );
}
