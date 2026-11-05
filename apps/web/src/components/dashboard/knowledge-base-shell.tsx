'use client';

import { AlertTriangle, Brain, Files, HelpCircle, History, Salad, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getKnowledgeDocuments,
  type KnowledgeDocumentsViewResponse,
} from '@/lib/control-center-api';
import { cn } from '@/lib/utils';

import { CONTROL_H, FOCUS_RING } from './control-center-table';
import { SectorHeader } from './control-center-ui';
import { StatStrip } from './knowledge-ui';

const BASE = '/dashboard/ia/base-conhecimento';

/** Disparado pelas seções após mudar a base, para o resumo do topo não ficar defasado. */
export const KNOWLEDGE_CHANGED_EVENT = 'movivo:knowledge-changed';
const SECTIONS = [
  { href: `${BASE}/documentos`, label: 'Artigos', icon: Files },
  { href: `${BASE}/taco`, label: 'TACO', icon: Salad },
  { href: `${BASE}/faq`, label: 'FAQ', icon: HelpCircle },
  { href: `${BASE}/seguranca`, label: 'Segurança', icon: ShieldCheck },
  { href: `${BASE}/historico`, label: 'Histórico', icon: History },
] as const;

function SummaryStrip({ onLoaded }: { onLoaded: () => void }) {
  const [documents, setDocuments] = useState<KnowledgeDocumentsViewResponse | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let controller = new AbortController();
    const load = () => {
      controller.abort();
      controller = new AbortController();
      const { signal } = controller;
      void Promise.allSettled([
        getKnowledgeDocuments(signal).then((loaded) => {
          setDocuments(loaded);
          onLoaded();
        }),
      ]).then((results) => {
        if (!signal.aborted) setUnavailable(results.some((result) => result.status === 'rejected'));
      });
    };
    load();
    window.addEventListener(KNOWLEDGE_CHANGED_EVENT, load);
    return () => {
      window.removeEventListener(KNOWLEDGE_CHANGED_EVENT, load);
      controller.abort();
    };
  }, [onLoaded]);

  const corpus = documents?.data.documents ?? [];
  const count = (predicate: (status: string) => boolean) =>
    documents ? corpus.filter((item) => predicate(item.status)).length : null;
  const waiting = count((status) => status === 'READY_FOR_REVIEW' || status === 'PENDING');
  const failed = count((status) => status === 'FAILED');

  return (
    <div>
      <StatStrip
        stats={[
          {
            label: 'Fontes ativas',
            value: String(count((status) => status === 'PUBLISHED') ?? '—'),
          },
          { label: 'Aguardando revisão', value: String(waiting ?? '—'), alert: (waiting ?? 0) > 0 },
          {
            label: 'Falhas no processamento',
            value: String(failed ?? '—'),
            alert: (failed ?? 0) > 0,
          },
        ]}
      />
      {unavailable ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <AlertTriangle aria-hidden="true" className="size-3.5" />
          Parte do resumo ainda não está disponível. As seções continuam operacionais.
        </p>
      ) : null}
    </div>
  );
}

export function KnowledgeBaseShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const markUpdated = useCallback(() => setUpdatedAt(new Date()), []);
  const nav = useRef<HTMLElement>(null);

  // No celular as abas rolam: a seção atual precisa estar à vista quando a página abre.
  useEffect(() => {
    const current = nav.current?.querySelector('[aria-current="page"]');
    current?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [pathname]);

  return (
    <div className="@container mx-auto w-full max-w-6xl space-y-6">
      <SectorHeader title="Base de Conhecimento" icon={Brain} updatedAt={updatedAt} />

      <SummaryStrip onLoaded={markUpdated} />

      <nav
        ref={nav}
        aria-label="Seções da Base de Conhecimento"
        className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <ul className="flex min-w-max border-b border-border">
          {SECTIONS.map(({ href, label, icon: Icon }) => {
            const current = pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 px-3 text-label font-medium transition-colors @md:px-4',
                    CONTROL_H,
                    FOCUS_RING,
                    current
                      ? 'text-foreground shadow-[inset_0_-2px_0_0_var(--foreground)]'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div>{children}</div>
    </div>
  );
}
