'use client';

import {
  AlertTriangle,
  ArrowLeftRight,
  Bell,
  CheckCheck,
  CheckCircle2,
  ClipboardCheck,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { alertCopyFor, alertSourceLabel, ALERT_LEVEL_LABEL } from '@/lib/alert-copy';
import type { NotificationItem } from '@/lib/dashboard-types';
import { elapsed } from '@/lib/relative-time';
import { cn } from '@/lib/utils';

import { useNotifications } from './notifications-provider';
import { UnreadIndicator } from './unread-indicator';

const STATUS_MESSAGE_MS = 4_000;
const ORIGIN_LABEL = {
  PARQ: 'Origem: PAR-Q bloqueante',
  FALLBACK: 'Origem: template conservador',
  EDIT: 'Origem: edição do profissional',
  AI_SUBSTITUTION: 'Origem: substituição confirmada pelo aluno',
  CATALOG_GAP: 'Origem: exercício fora do catálogo',
} as const;

function hrefFor(item: NotificationItem): string {
  const id = encodeURIComponent(item.id);
  if (item.type === 'alert') return `/dashboard/alertas/${id}`;
  return `/dashboard/fila/${item.type}/${id}`;
}

/** Nome do aluno: alertas de treino chegam da fila só com o título "Acompanhamento de treino: Nome". */
function studentOf(item: NotificationItem): string {
  return (
    item.studentName ?? item.title?.split(': ').slice(1).join(': ') ?? 'Aluno não identificado'
  );
}

function describe(item: NotificationItem) {
  if (item.type === 'alert') {
    const copy = alertCopyFor({ level: item.level ?? 'ALERT', reason: item.reason ?? '' });
    const source = alertSourceLabel(item.sourceType) ?? 'Conversa';
    const level = ALERT_LEVEL_LABEL[item.level ?? 'ALERT'];
    return {
      eyebrow: `Alerta · ${level}`,
      title: copy.title,
      detail: `${studentOf(item)} · ${source}`,
    };
  }
  const urgency = item.section === 'MANDATORY' ? 'Revisão obrigatória' : 'Revisão opcional';
  const tail = item.origin
    ? ORIGIN_LABEL[item.origin]
    : item.autoReleaseAt
      ? `Envio automático às ${new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(new Date(item.autoReleaseAt))}`
      : null;
  return {
    eyebrow:
      item.type === 'protocol'
        ? 'Fila · Protocolo para revisão'
        : 'Fila · Substituição de exercício',
    title: item.title ?? 'Item da fila',
    detail: [urgency, tail].filter(Boolean).join(' · '),
  };
}

function RowIcon({ item }: { item: NotificationItem }) {
  if (item.type === 'alert') {
    const safety = item.level === 'SAFETY';
    const Icon = safety ? ShieldAlert : AlertTriangle;
    return (
      <span
        aria-hidden="true"
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full',
          safety
            ? 'bg-destructive text-destructive-foreground'
            : 'bg-secondary text-secondary-foreground',
        )}
      >
        <Icon className="size-4" />
      </span>
    );
  }
  const Icon = item.type === 'protocol' ? ClipboardCheck : ArrowLeftRight;
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground"
    >
      <Icon className="size-4" />
    </span>
  );
}

function NotificationRow({ item, onNavigate }: { item: NotificationItem; onNavigate: () => void }) {
  const { eyebrow, title, detail } = describe(item);
  return (
    <li>
      <Link
        href={hrefFor(item)}
        onClick={onNavigate}
        className="flex min-h-14 items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="mt-3 flex w-2 shrink-0 justify-center">
          <UnreadIndicator read={item.read} />
        </span>
        <RowIcon item={item} />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-muted-foreground">{eyebrow}</span>
          <span
            className={cn(
              'block text-label text-foreground',
              item.read ? 'font-medium' : 'font-semibold',
            )}
          >
            {title}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{detail}</span>
        </span>
        <time dateTime={item.createdAt} className="shrink-0 text-xs text-muted-foreground">
          {elapsed(item.createdAt)}
        </time>
      </Link>
    </li>
  );
}

/**
 * Sino do cabeçalho: alertas do AI Coach + itens da Fila do Profissional, com estado de leitura
 * por profissional. Abrir o popover não marca nada; a leitura é gravada pela tela de detalhe.
 */
export function AlertsBell() {
  const notifications = useNotifications();
  const { unread, openSafety, totalPending, items, listStatus } = notifications;
  const { watchItems, reloadItems, markAllRead } = notifications;
  const [panelOpen, setPanelOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelId = useId();

  useEffect(() => {
    watchItems(panelOpen);
    if (panelOpen) headingRef.current?.focus();
    return () => watchItems(false);
  }, [panelOpen, watchItems]);

  useEffect(() => {
    if (!panelOpen) return;
    function closeWhenOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setPanelOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setPanelOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener('pointerdown', closeWhenOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeWhenOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [panelOpen]);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(''), STATUS_MESSAGE_MS);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  async function markEverythingRead() {
    if (unread === 0) return;
    setActionError('');
    const ok = await markAllRead();
    if (ok) setStatusMessage('Todas as notificações foram marcadas como lidas.');
    else setActionError('Não foi possível marcar como lidas. Tente novamente.');
  }

  const safetyNote =
    openSafety === 0
      ? ''
      : `, ${openSafety} alerta${openSafety === 1 ? '' : 's'} de segurança pendente${openSafety === 1 ? '' : 's'}`;
  const label =
    (unread === 0
      ? 'Notificações: nenhuma não lida'
      : `Notificações: ${unread} não lida${unread === 1 ? '' : 's'}`) + safetyNote;
  const close = () => setPanelOpen(false);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={panelOpen}
        aria-controls={panelId}
        aria-label={label}
        title={label}
        onClick={() => setPanelOpen((value) => !value)}
        className="relative flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
      >
        <Bell aria-hidden="true" className="size-5" />
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className={cn(
              'absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[0.625rem] font-bold text-destructive-foreground',
              unread > 99 && 'min-w-6',
            )}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>
      {panelOpen ? (
        <section
          id={panelId}
          role="dialog"
          aria-label="Notificações"
          className="fixed inset-x-4 top-16 z-30 max-h-[calc(100dvh-5rem)] overflow-y-auto rounded-xl border border-border bg-card p-2 shadow-lg sm:absolute sm:inset-x-auto sm:top-[calc(100%+0.5rem)] sm:right-0 sm:w-[min(26rem,calc(100vw-2rem))]"
        >
          <div className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
            <div>
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="text-label font-semibold text-foreground focus-visible:outline-none"
              >
                Notificações
              </h2>
              <p className="text-xs text-muted-foreground">
                {unread === 0 ? 'Nenhuma não lida' : `${unread} não lida${unread === 1 ? '' : 's'}`}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-disabled={unread === 0}
              title={unread === 0 ? 'Não há notificações não lidas.' : undefined}
              className={cn(unread === 0 && 'cursor-not-allowed opacity-50')}
              onClick={() => void markEverythingRead()}
            >
              <CheckCheck aria-hidden="true" className="size-4" />
              Marcar todas como lidas
            </Button>
          </div>
          <div role="status" className="sr-only">
            {statusMessage}
          </div>
          {actionError ? (
            <p role="alert" className="px-3 pb-2 text-xs font-medium text-destructive">
              {actionError}
            </p>
          ) : null}
          {openSafety > 0 ? (
            <div className="mx-1 mb-2 flex items-center justify-between gap-2 rounded-lg border border-l-4 border-l-coral bg-card px-3 py-2">
              <p className="flex items-center gap-2 text-label font-semibold text-foreground">
                <ShieldAlert aria-hidden="true" className="size-4 shrink-0" />
                {openSafety === 1
                  ? '1 alerta de segurança pendente'
                  : `${openSafety} alertas de segurança pendentes`}
              </p>
              <Link
                href="/dashboard/alertas"
                onClick={close}
                className="shrink-0 text-label font-medium underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
              >
                Ver alertas
              </Link>
            </div>
          ) : null}
          {listStatus === 'error' ? (
            <div className="px-3 py-5 text-center">
              <p className="text-label text-muted-foreground">
                Não foi possível carregar as notificações.
              </p>
              <Button
                className="mt-3"
                variant="outline"
                size="sm"
                onClick={() => void reloadItems()}
              >
                <RefreshCw aria-hidden="true" className="size-4" />
                Tentar novamente
              </Button>
            </div>
          ) : listStatus !== 'ready' ? (
            <div role="status" aria-label="Carregando notificações" className="space-y-2 p-1">
              {[0, 1, 2].map((row) => (
                <div key={row} className="h-14 animate-pulse rounded-lg bg-secondary" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <CheckCircle2 aria-hidden="true" className="mx-auto size-7 text-verde-pulso" />
              <p className="mt-2 text-label font-semibold text-foreground">Tudo em dia</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Novos alertas do AI Coach e itens da Fila do Profissional aparecem aqui.
              </p>
            </div>
          ) : (
            <ul className="max-h-[28rem] overflow-y-auto">
              {items.map((item) => (
                <NotificationRow key={`${item.type}:${item.id}`} item={item} onNavigate={close} />
              ))}
            </ul>
          )}
          {listStatus === 'ready' && totalPending > items.length ? (
            <p className="px-3 pt-2 text-xs text-muted-foreground">
              Mostrando {items.length} de {totalPending} pendências.
            </p>
          ) : null}
          <div className="mt-1 flex flex-col gap-1 border-t border-border pt-1 sm:flex-row">
            <Link
              href="/dashboard/alertas"
              onClick={close}
              className="block flex-1 rounded-lg px-3 py-2.5 text-center text-label font-semibold text-foreground hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
            >
              Ver todos os alertas
            </Link>
            <Link
              href="/dashboard/educacao-fisica"
              onClick={close}
              aria-label="Ver todas as notificações na Fila do Profissional"
              className="block flex-1 rounded-lg px-3 py-2.5 text-center text-label font-semibold text-foreground hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
            >
              Ver todas as notificações
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
