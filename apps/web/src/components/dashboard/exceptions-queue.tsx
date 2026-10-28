'use client';

/**
 * Fila de exceções: o que o motor de políticas não resolveu sozinho, só do domínio do conselho
 * do profissional (CREF treino, CRN nutrição, CRM médico). A equipe opera por exceção.
 */
import { ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import type { ExceptionListItem } from '@movivo/shared';

import { getExceptions } from '@/lib/control-center-api';
import { ageLabel, DOMAIN_LABEL, KIND_LABEL, PRIORITY_LABEL } from '@/lib/exception-copy';
import { cn } from '@/lib/utils';

import { StatusBadge } from './control-center-table';
import type { StatusTone } from './control-center-table';
import { ResourceState, SectorHeader, useControlCenterResource } from './control-center-ui';

type Status = 'OPEN' | 'IN_REVIEW' | 'RESOLVED';

const TABS: ReadonlyArray<{ status: Status; label: string }> = [
  { status: 'OPEN', label: 'Abertos' },
  { status: 'IN_REVIEW', label: 'Em análise' },
  { status: 'RESOLVED', label: 'Resolvidos' },
];

const TONE: Record<ExceptionListItem['priority'], StatusTone> = {
  URGENT: 'attention',
  HIGH: 'attention',
  NORMAL: 'neutral',
  LOW: 'quiet',
};

export function ExceptionsQueue() {
  const [status, setStatus] = useState<Status>('OPEN');
  const load = useCallback((signal?: AbortSignal) => getExceptions(status, signal), [status]);
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(load);

  return (
    <section className="space-y-5" aria-labelledby="fila-titulo">
      <SectorHeader
        title="Fila de exceções"
        icon={ClipboardCheck}
        refreshing={loading}
        onRefresh={() => void refresh()}
      />
      <p id="fila-titulo" className="max-w-prose text-label text-muted-foreground">
        Só chegam aqui os casos que o sistema não pôde resolver sozinho dentro das políticas
        publicadas. Cada profissional vê o domínio do seu conselho.
      </p>
      <div role="tablist" aria-label="Situação do caso" className="flex gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.status}
            role="tab"
            type="button"
            aria-selected={status === tab.status}
            onClick={() => setStatus(tab.status)}
            className={cn(
              'rounded-full border px-4 py-1.5 text-label',
              status === tab.status
                ? 'border-transparent bg-accent text-accent-foreground'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <ResourceState
        loading={loading && !data}
        error={error}
        forbidden={forbidden}
        onRetry={() => void refresh()}
      />
      {data && data.length === 0 ? (
        <p
          role="status"
          className="rounded-xl border border-border bg-card p-6 text-label text-muted-foreground"
        >
          Nenhum caso {status === 'RESOLVED' ? 'resolvido' : 'em aberto'} no seu domínio.
        </p>
      ) : null}
      {data && data.length > 0 ? (
        <ul className="space-y-3">
          {data.map((item) => (
            <li key={item.id}>
              <Link
                href={`/dashboard/fila/${item.id}`}
                className="block rounded-xl border border-border bg-card p-4 transition-colors hover:bg-secondary/60 sm:p-5"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <StatusBadge tone={TONE[item.priority]}>
                    {PRIORITY_LABEL[item.priority]}
                  </StatusBadge>
                  <span className="text-label font-medium">{KIND_LABEL[item.kind]}</span>
                  <span className="text-xs text-muted-foreground">{DOMAIN_LABEL[item.domain]}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {ageLabel(item.createdAt)}
                  </span>
                </div>
                <p className="mt-2 text-label">{item.studentName ?? 'Aluno sem nome'}</p>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.summary}</p>
                {!item.canResolve ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Somente leitura para o seu papel.
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
