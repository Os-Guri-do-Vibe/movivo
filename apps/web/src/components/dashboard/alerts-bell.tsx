'use client';

import { Bell, CheckCheck, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { NotificationRow } from './notification-row';
import { useNotifications } from './notifications-provider';
import { SafetyStrip } from './safety-strip';

const STATUS_MESSAGE_MS = 4_000;
const LINK_CLASS =
  'block rounded-lg px-3 py-2.5 text-center text-label font-semibold text-foreground hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none';

/**
 * Sino do cabeçalho. O popover mostra só o que ainda NÃO foi lido; ao ler (abrindo o detalhe ou
 * por "Marcar todas como lidas") o item sai daqui e fica registrado na tela Notificações. Abrir o
 * popover não marca nada; a leitura é gravada pela tela de detalhe.
 */
export function AlertsBell() {
  const notifications = useNotifications();
  const { unread, openSafety, items, listStatus, watchItems, reloadItems, markAllRead } =
    notifications;
  const [panelOpen, setPanelOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelId = useId();
  const unreadItems = items.filter((item) => !item.read);

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
    const { ok } = await markAllRead();
    if (ok) {
      setStatusMessage(
        'Todas as notificações foram marcadas como lidas. Elas continuam em Notificações.',
      );
    } else {
      setActionError('Não foi possível marcar como lidas. Tente novamente.');
    }
  }

  const safetyNote =
    openSafety === 0
      ? ''
      : `, ${openSafety} alerta${openSafety === 1 ? '' : 's'} de segurança aberto${openSafety === 1 ? '' : 's'}`;
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
        // Um único scroll: o contêiner não rola; só o corpo (lista) rola, com cabeçalho e rodapé fixos.
        <section
          id={panelId}
          role="dialog"
          aria-label="Notificações"
          className="fixed inset-x-4 top-16 z-30 flex max-h-[calc(100dvh-5rem)] flex-col rounded-xl border border-border bg-card shadow-lg sm:absolute sm:inset-x-auto sm:top-[calc(100%+0.5rem)] sm:right-0 sm:w-[min(26rem,calc(100vw-2rem))]"
        >
          <div className="flex shrink-0 flex-wrap items-start justify-between gap-2 px-4 py-3">
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
            <p role="alert" className="shrink-0 px-4 pb-2 text-xs font-medium text-destructive">
              {actionError}
            </p>
          ) : null}
          {openSafety > 0 ? (
            <div className="shrink-0 px-2 pb-2">
              <SafetyStrip count={openSafety} onNavigate={close} />
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
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
              <div role="status" aria-label="Carregando notificações" className="space-y-2">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="h-14 animate-pulse rounded-lg bg-secondary" />
                ))}
              </div>
            ) : unreadItems.length === 0 ? (
              <div className="px-3 py-6 text-center">
                <CheckCheck aria-hidden="true" className="mx-auto size-7 text-muted-foreground" />
                <p className="mt-2 text-label font-semibold text-foreground">
                  Nenhuma notificação não lida
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  As que você já abriu ficam em Notificações. Pendências continuam em Alertas e na
                  Fila do Profissional.
                </p>
              </div>
            ) : (
              <ul>
                {unreadItems.map((item) => (
                  <NotificationRow key={`${item.type}:${item.id}`} item={item} onNavigate={close} />
                ))}
              </ul>
            )}
          </div>
          <div className="shrink-0 border-t border-border p-2">
            {listStatus === 'ready' && unread > unreadItems.length ? (
              <p className="px-3 pb-1 text-xs text-muted-foreground">
                Mostrando {unreadItems.length} de {unread} não lidas
              </p>
            ) : null}
            <Link href="/dashboard/notificacoes" onClick={close} className={LINK_CLASS}>
              Ver todas as notificações
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
