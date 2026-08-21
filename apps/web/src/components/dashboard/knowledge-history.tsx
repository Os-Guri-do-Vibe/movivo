'use client';

import { ExternalLink, History } from 'lucide-react';
import Link from 'next/link';
import { useCallback } from 'react';

import { getKnowledgeDocuments, getMethodology } from '@/lib/control-center-api';

import { ResourceState, useControlCenterResource } from './control-center-ui';

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

export function KnowledgeHistoryPanel({ canReadAudit = false }: { canReadAudit?: boolean }) {
  const load = useCallback(async (signal?: AbortSignal) => {
    const [knowledge, methodology] = await Promise.all([
      getKnowledgeDocuments(signal),
      getMethodology(signal),
    ]);
    return { knowledge, methodology };
  }, []);
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

  const events = [
    ...data.methodology.data.versions.map((version) => ({
      id: `methodology-${version.id}`,
      date:
        version.statusChangedAt ?? version.publishedAt ?? version.reviewedAt ?? version.createdAt,
      type: 'Metodologia',
      title: `Versão ${version.version} · ${version.status}`,
      actor: version.reviewedBy ?? version.createdBy ?? 'Responsável não informado',
      note: version.changeNote ?? 'Sem nota registrada',
      technicalId: version.id,
    })),
    ...data.knowledge.data.documents.map((document) => ({
      id: `document-${document.id}`,
      date: document.statusUpdatedAt ?? document.reviewedAt ?? document.createdAt,
      type: 'Documento',
      title: `${document.title} · ${document.status}`,
      actor: document.reviewer ?? document.uploadedBy ?? 'Responsável não informado',
      note: document.reviewNote ?? `Arquivo ${document.originalFilename}`,
      technicalId: document.id,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <section aria-labelledby="knowledge-history-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="knowledge-history-title" className="flex items-center gap-2 text-h2 font-bold">
            <History aria-hidden="true" className="size-5" />
            Versões e auditoria
          </h2>
          <p className="mt-2 max-w-3xl text-label text-muted-foreground">
            Linha do tempo consolidada de metodologia e documentos. IDs e hashes permanecem
            disponíveis para investigação técnica.
          </p>
        </div>
        {canReadAudit ? (
          <Link
            href="/dashboard/sistema/auditoria"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 py-2 text-label font-semibold hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none"
          >
            Abrir auditoria completa
            <ExternalLink aria-hidden="true" className="size-4" />
          </Link>
        ) : null}
      </div>

      <ol className="mt-6 grid gap-3">
        {events.map((event) => (
          <li
            key={event.id}
            className="grid gap-3 rounded-xl border border-border bg-card p-5 md:grid-cols-[10rem_minmax(0,1fr)]"
          >
            <div>
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {event.type}
              </p>
              <time className="mt-1 block font-mono text-xs" dateTime={event.date}>
                {dateLabel(event.date)}
              </time>
            </div>
            <div>
              <h3 className="font-semibold">{event.title}</h3>
              <p className="mt-1 text-label text-muted-foreground">{event.note}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {event.actor} ·{' '}
                <span className="font-mono">ID {event.technicalId.slice(0, 8)}…</span>
              </p>
            </div>
          </li>
        ))}
      </ol>
      {events.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-border p-6 text-center text-label text-muted-foreground">
          Ainda não há alterações registradas.
        </p>
      ) : null}
    </section>
  );
}
