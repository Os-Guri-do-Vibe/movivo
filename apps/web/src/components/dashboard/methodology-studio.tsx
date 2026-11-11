'use client';

import { ChevronRight, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { listDomains, type MethodologyDomainSummary } from '@/lib/methodology-studio-api';

import { UpdatedAt } from './control-center-ui';
import {
  DOMAIN_GROUPS,
  DOMAIN_ICONS,
  OWNER_LABEL,
  PAGE_CONTAINER,
  StatusBadge,
  formatDate,
} from './methodology-ui';

const STEPS = [
  { title: 'Edite', text: 'Abra um rascunho e ajuste os valores.' },
  { title: 'Teste', text: 'Os agentes conferem se continuam bem.' },
  { title: 'Publique', text: 'A nova versão passa a valer.' },
] as const;

type Summary = MethodologyDomainSummary;

/** O que o profissional precisa fazer a seguir neste domínio, em uma frase curta. */
function nextAction(domain: Summary): string {
  if (domain.openDraft?.status === 'TESTING') return 'Publicar a nova versão';
  if (domain.openDraft) return 'Continuar o rascunho';
  if (!domain.publishedVersion) return 'Começar';
  return 'Abrir';
}

function DomainStatus({ domain }: { domain: Summary }) {
  if (domain.openDraft?.status === 'TESTING') {
    return <StatusBadge tone="ready">Pronta para publicar</StatusBadge>;
  }
  if (domain.openDraft) return <StatusBadge tone="draft">Rascunho em edição</StatusBadge>;
  if (!domain.publishedVersion) {
    return <StatusBadge tone="attention">Sem versão publicada</StatusBadge>;
  }
  return <StatusBadge tone="live">Em vigor</StatusBadge>;
}

function DomainCard({ domain }: { domain: Summary }) {
  const Icon = DOMAIN_ICONS[domain.domain];
  const published = domain.publishedVersion
    ? `Versão ${domain.publishedVersion}${domain.publishedAt ? `, publicada em ${formatDate(domain.publishedAt)}` : ''}`
    : 'Os agentes ainda usam apenas o texto inicial do sistema.';
  return (
    <Link
      href={`/dashboard/ia/metodologia/${domain.domain.toLowerCase()}`}
      className="group flex h-full flex-col rounded-lg border border-border bg-card p-5 outline-none motion-safe:transition-colors hover:border-foreground/30 hover:bg-secondary/40 focus-visible:ring-[3px] focus-visible:ring-ring"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-40 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-foreground"
          >
            {Icon ? <Icon className="size-[1.125rem]" /> : null}
          </span>
          <h3 className="min-w-0 text-body font-semibold tracking-tight">{domain.title}</h3>
        </div>
        <DomainStatus domain={domain} />
      </div>

      <p className="mt-3 line-clamp-2 flex-1 text-label text-muted-foreground">
        {domain.description}
      </p>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-t border-border pt-4">
        <div className="min-w-0 space-y-0.5 text-xs text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Responsável:</span>{' '}
            <span>{OWNER_LABEL[domain.owner]}</span>
          </p>
          <p>{published}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-0.5 text-label font-medium text-foreground">
          {nextAction(domain)}
          <ChevronRight
            aria-hidden="true"
            className="size-4 text-muted-foreground motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
          />
        </span>
      </div>
    </Link>
  );
}

function CardGrid({ items }: { items: Summary[] }) {
  return (
    <ul className="mt-4 grid gap-4 @2xl:grid-cols-2">
      {items.map((domain) => (
        <li key={domain.domain}>
          <DomainCard domain={domain} />
        </li>
      ))}
    </ul>
  );
}

function Skeleton() {
  return (
    <div aria-hidden="true" className="mt-10 grid gap-4 @2xl:grid-cols-2">
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          className="h-44 rounded-lg border border-border bg-card motion-safe:animate-pulse"
        />
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-4 @lg:px-6">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-h3 font-semibold tracking-tight tabular-nums">{value}</dd>
    </div>
  );
}

/** Lista dos domínios de metodologia, por área, com o próximo passo de cada um. */
export function MethodologyStudio() {
  const [domains, setDomains] = useState<Summary[] | null>(null);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(() => {
    setError('');
    listDomains()
      .then((list) => {
        setDomains(list);
        setUpdatedAt(new Date());
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Não foi possível carregar. Tente de novo.'),
      );
  }, []);

  useEffect(load, [load]);

  const byKey = new Map((domains ?? []).map((d) => [d.domain, d]));
  const grouped = new Set<string>(DOMAIN_GROUPS.flatMap((group) => group.domains));
  const others = (domains ?? []).filter((d) => !grouped.has(d.domain));
  const total = domains?.length ?? 0;
  const inForce = (domains ?? []).filter((d) => d.publishedVersion).length;
  const editing = (domains ?? []).filter((d) => d.openDraft).length;
  const missing = total - inForce;

  return (
    <section aria-labelledby="studio-list-title" className={PAGE_CONTAINER}>
      <header className="border-b border-border pb-6">
        <h1 id="studio-list-title" className="text-h2 font-semibold tracking-tight @lg:text-h1">
          Metodologia
        </h1>
        <UpdatedAt at={updatedAt} />
        <p className="mt-2 max-w-2xl text-label text-muted-foreground @lg:text-body">
          Aqui você define as regras que os agentes de IA da MOVIVO seguem ao montar treinos e
          planos alimentares.{' '}
          <strong className="font-medium text-foreground">
            Nada muda para os alunos até você publicar.
          </strong>
        </p>
      </header>

      <div className="mt-6 overflow-hidden rounded-lg border border-border bg-card">
        {domains ? (
          <dl className="grid grid-cols-3 divide-x divide-border border-b border-border">
            <Stat label="Em vigor" value={`${inForce} de ${total}`} />
            <Stat label="Rascunhos abertos" value={String(editing)} />
            <Stat label="Sem versão publicada" value={String(missing)} />
          </dl>
        ) : null}
        <ol
          aria-label="Como funciona"
          className="grid divide-y divide-border @xl:grid-cols-3 @xl:divide-x @xl:divide-y-0"
        >
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex items-start gap-3 px-4 py-4 @lg:px-6">
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border font-mono text-xs font-medium text-muted-foreground"
              >
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-label font-medium">{step.title}</span>
                <span className="block text-xs text-muted-foreground">{step.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-coral/60 bg-coral/10 p-4 text-label font-medium"
        >
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw /> Tentar de novo
          </Button>
        </div>
      ) : null}

      {!domains && !error ? <Skeleton /> : null}

      {domains ? (
        <>
          {DOMAIN_GROUPS.map((group) => {
            const items = group.domains.flatMap((key) => byKey.get(key) ?? []);
            if (items.length === 0) return null;
            return (
              <section key={group.key} aria-labelledby={`group-${group.key}`} className="mt-10">
                <h2 id={`group-${group.key}`} className="text-h3 font-semibold tracking-tight">
                  {group.title}
                </h2>
                <CardGrid items={items} />
              </section>
            );
          })}

          {others.length > 0 ? (
            <section aria-labelledby="group-others" className="mt-10">
              <h2 id="group-others" className="text-h3 font-semibold tracking-tight">
                Outras
              </h2>
              <CardGrid items={others} />
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
