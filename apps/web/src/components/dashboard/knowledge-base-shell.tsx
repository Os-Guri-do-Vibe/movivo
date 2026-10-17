'use client';

import {
  AlertTriangle,
  BookOpenText,
  Brain,
  Files,
  HelpCircle,
  History,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  getKnowledgeDocuments,
  getMethodology,
  type KnowledgeDocumentsViewResponse,
  type MethodologyResponse,
} from '@/lib/control-center-api';
import { cn } from '@/lib/utils';

const BASE = '/dashboard/ia/base-conhecimento';

/** Disparado pelas seções após mudar a base, para o resumo do topo não ficar defasado. */
export const KNOWLEDGE_CHANGED_EVENT = 'movivo:knowledge-changed';
const SECTIONS = [
  { href: BASE, label: 'Metodologia', icon: BookOpenText },
  { href: `${BASE}/documentos`, label: 'Documentos', icon: Files },
  { href: `${BASE}/faq`, label: 'FAQ', icon: HelpCircle },
  { href: `${BASE}/seguranca`, label: 'Segurança', icon: ShieldCheck },
  { href: `${BASE}/historico`, label: 'Histórico', icon: History },
] as const;

function SummaryStrip() {
  const [documents, setDocuments] = useState<KnowledgeDocumentsViewResponse | null>(null);
  const [methodology, setMethodology] = useState<MethodologyResponse | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let controller = new AbortController();
    const load = () => {
      controller.abort();
      controller = new AbortController();
      const { signal } = controller;
      void Promise.allSettled([
        getKnowledgeDocuments(signal).then(setDocuments),
        getMethodology(signal).then(setMethodology),
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
  }, []);

  const corpus = documents?.data.documents ?? [];
  const versions = methodology?.data.versions ?? [];
  const current =
    versions.find((version) => version.current) ??
    versions.find((version) => version.status === 'PUBLISHED');
  const count = (predicate: (status: string) => boolean) =>
    documents ? corpus.filter((item) => predicate(item.status)).length : null;
  const waiting = count((status) => status === 'READY_FOR_REVIEW' || status === 'PENDING');
  const failed = count((status) => status === 'FAILED');
  const cards: Array<{
    label: string;
    value: string;
    icon: LucideIcon;
    /** Coral só quando há algo a resolver; zero é um estado calmo. */
    alert?: boolean;
  }> = [
    {
      label: 'Metodologia vigente',
      value: current ? `v${current.version}` : '—',
      icon: BookOpenText,
    },
    {
      label: 'Fontes ativas',
      value: String(count((status) => status === 'PUBLISHED') ?? '—'),
      icon: Files,
    },
    {
      label: 'Aguardando revisão',
      value: String(waiting ?? '—'),
      icon: History,
      alert: (waiting ?? 0) > 0,
    },
    {
      label: 'Falhas no processamento',
      value: String(failed ?? '—'),
      icon: AlertTriangle,
      alert: (failed ?? 0) > 0,
    },
  ];

  return (
    <div className="mt-6">
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className={cn(
              'flex items-center gap-4 rounded-xl border bg-card p-4',
              card.alert ? 'border-coral/60' : 'border-border',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-lg',
                card.alert ? 'bg-coral/20' : 'bg-accent text-accent-foreground',
              )}
            >
              <card.icon className="size-5" />
            </span>
            <div className="min-w-0">
              <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {card.label}
              </dt>
              <dd className="mt-0.5 font-mono text-h2 font-bold">{card.value}</dd>
            </div>
          </div>
        ))}
      </dl>
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

  return (
    <div>
      <header>
        <h1 className="flex items-center gap-3 text-h1 font-bold text-foreground">
          <Brain aria-hidden="true" className="size-7 text-verde-pulso" />
          Base de Conhecimento
        </h1>
        <p className="mt-2 max-w-3xl text-label text-muted-foreground">
          Tudo o que a IA sabe e segue: a metodologia do profissional CREF, as evidências, as
          respostas prontas e as regras de segurança.
        </p>
      </header>

      <SummaryStrip />

      <nav
        aria-label="Seções da Base de Conhecimento"
        className="mt-6 overflow-x-auto border-b border-border"
      >
        <ul className="flex min-w-max gap-1">
          {SECTIONS.map(({ href, label, icon: Icon }) => {
            const current = href === BASE ? pathname === BASE : pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'flex min-h-11 items-center gap-2 rounded-t-lg border-b-2 px-4 py-2 text-label font-semibold transition-colors focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none',
                    current
                      ? 'border-verde-pulso bg-accent/60 text-foreground'
                      : 'border-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                  )}
                >
                  <Icon aria-hidden="true" className="size-4" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-8">{children}</div>
    </div>
  );
}
