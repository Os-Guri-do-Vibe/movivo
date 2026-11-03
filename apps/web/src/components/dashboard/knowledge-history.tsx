'use client';

import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useCallback } from 'react';

import { getKnowledgeDocuments } from '@/lib/control-center-api';
import { cn } from '@/lib/utils';

import { CONTROL_H, FOCUS_RING, StatusBadge } from './control-center-table';
import { ResourceState, useControlCenterResource } from './control-center-ui';
import { PanelHeader, documentStatus } from './knowledge-ui';

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

export function KnowledgeHistoryPanel({ canReadAudit = false }: { canReadAudit?: boolean }) {
  const load = useCallback((signal?: AbortSignal) => getKnowledgeDocuments(signal), []);
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(load);

  if (!data) {
    return (
      <ResourceState
        loading={loading}
        error={error}
        forbidden={forbidden}
        onRetry={() => void refresh()}
      />
    );
  }

  const events = data.data.documents
    .map((document) => ({
      id: `document-${document.id}`,
      date: document.statusUpdatedAt ?? document.reviewedAt ?? document.createdAt,
      title: document.title,
      status: documentStatus(document),
      actor: document.reviewer ?? document.uploadedBy ?? 'Responsável não informado',
      note: document.reviewNote ?? `Arquivo ${document.originalFilename}`,
      technicalId: document.id,
    }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <section aria-labelledby="knowledge-history-title" className="space-y-5">
      <PanelHeader
        id="knowledge-history-title"
        title="Versões e auditoria"
        description="Linha do tempo dos documentos, do mais recente ao mais antigo. IDs e hashes seguem disponíveis para investigação técnica."
        actions={
          canReadAudit ? (
            <Link
              href="/dashboard/sistema/auditoria"
              className={cn(
                'inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 text-label font-medium transition-colors hover:bg-secondary',
                CONTROL_H,
                FOCUS_RING,
              )}
            >
              Abrir auditoria completa
              <ExternalLink aria-hidden="true" className="size-4" />
            </Link>
          ) : null
        }
      />

      {events.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-label text-muted-foreground">
          Ainda não há alterações registradas.
        </p>
      ) : (
        <ol className="divide-y divide-border rounded-xl border border-border bg-card">
          {events.map((event) => (
            <li
              key={event.id}
              className="grid items-start gap-x-6 gap-y-1.5 px-4 py-3 @2xl:grid-cols-[10.5rem_minmax(0,1fr)_auto] @2xl:px-5"
            >
              <time
                className="font-mono text-xs leading-6 text-muted-foreground"
                dateTime={event.date}
              >
                {dateLabel(event.date)}
              </time>
              <div className="min-w-0">
                <p className="text-label font-medium break-words">{event.title}</p>
                <p className="mt-0.5 text-label text-muted-foreground">{event.note}</p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {event.actor} ·{' '}
                  <span className="font-mono">ID {event.technicalId.slice(0, 8)}…</span>
                </p>
              </div>
              <div className="text-xs @2xl:justify-self-end @2xl:leading-6">
                <StatusBadge tone={event.status.tone}>{event.status.label}</StatusBadge>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
