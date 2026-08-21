'use client';

import { AlertTriangle, BookOpenText, Files, History, ShieldCheck } from 'lucide-react';
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
const SECTIONS = [
  { href: BASE, label: 'Metodologia', icon: BookOpenText },
  { href: `${BASE}/documentos`, label: 'Documentos', icon: Files },
  { href: `${BASE}/seguranca`, label: 'Segurança', icon: ShieldCheck },
  { href: `${BASE}/historico`, label: 'Histórico', icon: History },
] as const;

function SummaryStrip() {
  const [documents, setDocuments] = useState<KnowledgeDocumentsViewResponse | null>(null);
  const [methodology, setMethodology] = useState<MethodologyResponse | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.allSettled([
      getKnowledgeDocuments(controller.signal).then(setDocuments),
      getMethodology(controller.signal).then(setMethodology),
    ]).then((results) => {
      if (!controller.signal.aborted)
        setUnavailable(results.some((result) => result.status === 'rejected'));
    });
    return () => controller.abort();
  }, []);

  const corpus = documents?.data.documents ?? [];
  const versions = methodology?.data.versions ?? [];
  const current =
    versions.find((version) => version.current) ??
    versions.find((version) => version.status === 'PUBLISHED');
  const cards = [
    { label: 'Metodologia vigente', value: current ? `v${current.version}` : '—' },
    {
      label: 'Fontes ativas',
      value: documents ? String(corpus.filter((item) => item.status === 'PUBLISHED').length) : '—',
    },
    {
      label: 'Aguardando revisão',
      value: documents
        ? String(
            corpus.filter((item) => item.status === 'READY_FOR_REVIEW' || item.status === 'PENDING')
              .length,
          )
        : '—',
    },
    {
      label: 'Falhas no processamento',
      value: documents ? String(corpus.filter((item) => item.status === 'FAILED').length) : '—',
    },
  ];

  return (
    <div className="mt-6">
      <dl className="grid overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="border-b border-border p-4 last:border-b-0 sm:border-r sm:[&:nth-child(2)]:border-r-0 sm:[&:nth-child(n+3)]:border-b-0 xl:border-b-0 xl:[&:nth-child(2)]:border-r xl:last:border-r-0"
          >
            <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {card.label}
            </dt>
            <dd className="mt-2 font-mono text-h2 font-bold">{card.value}</dd>
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
        <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Governança da IA
        </p>
        <h1 className="mt-2 text-h1 font-bold text-foreground">Base de Conhecimento</h1>
        <p className="mt-2 max-w-3xl text-body text-muted-foreground">
          Controle a metodologia oficial, as evidências e as barreiras usadas pela IA. A publicação
          depende de revisão humana e deixa trilha de auditoria.
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
                    'flex min-h-11 items-center gap-2 border-b-2 px-4 py-2 text-label font-semibold transition-colors focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none',
                    current
                      ? 'border-verde-pulso text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
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
