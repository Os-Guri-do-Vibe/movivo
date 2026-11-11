'use client';

/**
 * Dois painéis sobre os mesmos casos, só do domínio do conselho do profissional (CREF treino,
 * CRN nutrição, CRM médico):
 * - Fila do Profissional (`QUEUE`): o que a IA gerou ou mudou no protocolo do aluno, e a geração
 *   que falhou, um item por aluno — desenhada em `professional-queue.tsx`;
 * - Alertas (`ALERTS`): todo o resto que pede um profissional (segurança, pedido de revisão do
 *   aluno, exame, conversa assumida, sem política aplicável).
 */
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import type { ExceptionListItem, ExceptionScope } from '@movivo/shared';

import { getExceptions } from '@/lib/control-center-api';
import { ageLabel, DOMAIN_LABEL, KIND_LABEL, PRIORITY_LABEL } from '@/lib/exception-copy';
import { cn } from '@/lib/utils';

import { StatusBadge } from './control-center-table';
import type { StatusTone } from './control-center-table';
import { ResourceState, SectorHeader, useControlCenterResource } from './control-center-ui';
import { ProfessionalQueue } from './professional-queue';
import { ReviewUrgencyBadge } from './review-urgency';

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

const ALERTS_COPY = {
  title: 'Alertas',
  basePath: '/dashboard/alertas',
  intro:
    'Monitoramento dos casos extremos e de proteção: sinais de segurança, encaminhamentos feitos pelos agentes (dor, condição nova, queda forte de constância), pedidos de revisão do aluno, exames e conversas assumidas. Os agentes seguem acompanhando o aluno; o profissional entra quando o caso pede. Cada profissional vê o domínio do seu conselho.',
  empty: 'Nenhum alerta no seu domínio.',
} as const;

/** `QUEUE` → Fila do Profissional (um item por aluno); `ALERTS` → lista de casos com abas. */
export function ExceptionsQueue({ scope }: { scope: ExceptionScope }) {
  return scope === 'QUEUE' ? <ProfessionalQueue /> : <AlertsQueue />;
}

function AlertsQueue() {
  const copy = ALERTS_COPY;
  const [status, setStatus] = useState<Status>('OPEN');
  const load = useCallback(
    (signal?: AbortSignal) => getExceptions(status, 'ALERTS', signal),
    [status],
  );
  const { data, error, forbidden, loading, refresh, updatedAt } = useControlCenterResource(load);

  return (
    <section className="space-y-5" aria-labelledby="fila-titulo">
      <SectorHeader
        title={copy.title}
        icon={Bell}
        updatedAt={updatedAt}
        refreshing={loading}
        onRefresh={() => void refresh()}
      />
      <p id="fila-titulo" className="max-w-prose text-label text-muted-foreground">
        {copy.intro}
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
          {status === 'RESOLVED' ? 'Nenhum caso resolvido no seu domínio.' : copy.empty}
        </p>
      ) : null}
      {data && data.length > 0 ? <CaseList items={data} basePath={copy.basePath} /> : null}
    </section>
  );
}

function CaseList({ items, basePath }: { items: ExceptionListItem[]; basePath: string }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            href={`${basePath}/${item.id}`}
            className="block rounded-xl border border-border bg-card p-4 transition-colors hover:bg-secondary/60 sm:p-5"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <StatusBadge tone={TONE[item.priority]}>{PRIORITY_LABEL[item.priority]}</StatusBadge>
              <ReviewUrgencyBadge
                reviewUrgency={item.reviewUrgency}
                autoReleaseAt={item.autoReleaseAt}
              />
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
  );
}
