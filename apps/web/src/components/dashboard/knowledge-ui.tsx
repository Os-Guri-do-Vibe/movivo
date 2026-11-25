/**
 * Peças compartilhadas pelas seções da Base de Conhecimento (artigos, TACO, FAQ, segurança e
 * histórico), para que todas falem a mesma língua visual das telas de agentes: cartão de borda fina,
 * números em fonte mono e nada de cor onde não há o que resolver.
 *
 * Tudo aqui responde à largura do PRÓPRIO painel (container query, o `@container` do shell) e não
 * à da janela: com a barra lateral aberta, um MacBook 14" tem ~1160px de painel, bem menos que os
 * 1512px que o breakpoint de janela enxerga.
 */
import type { ReactNode } from 'react';

import type { KnowledgeDocumentStatus, KnowledgeDocumentView } from '@/lib/control-center-api';
import { cn } from '@/lib/utils';

import type { StatusTone } from './control-center-table';

/** Título de uma seção, com a frase que explica para que ela serve e as ações à direita. */
export function PanelHeader({
  id,
  title,
  description,
  actions,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h2 id={id} className="text-h3 font-semibold">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 max-w-prose text-label text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export interface Stat {
  label: string;
  value: string;
  /** Ponto coral ao lado do rótulo: só quando há algo a resolver. Zero é um estado calmo. */
  alert?: boolean;
  /** Valor em texto (uma data, por exemplo), que não cabe no corpo grande dos contadores. */
  text?: boolean;
}

/** Até quatro números lado a lado num único cartão, separados por filetes. */
export function StatStrip({ stats, className }: { stats: readonly Stat[]; className?: string }) {
  return (
    <dl
      className={cn(
        'grid divide-x divide-border overflow-hidden rounded-xl border border-border bg-card',
        stats.length === 2
          ? 'grid-cols-2'
          : stats.length === 4
            ? 'grid-cols-2 @3xl:grid-cols-4'
            : 'grid-cols-3',
        className,
      )}
    >
      {stats.map((stat) => (
        <div key={stat.label} className="min-w-0 px-3 py-3 @md:px-5 @md:py-4">
          <dt className="flex items-start gap-1.5 text-xs leading-snug font-medium text-balance text-muted-foreground">
            {stat.alert ? (
              <span aria-hidden="true" className="mt-1 size-1.5 shrink-0 rounded-full bg-coral" />
            ) : null}
            {stat.label}
          </dt>
          <dd
            className={cn(
              'mt-1 leading-tight font-semibold tabular-nums break-words',
              stat.text ? 'text-label @md:text-body' : 'font-mono text-h3 @md:text-h2',
            )}
          >
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function dateLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

export function formatBytes(bytes: number): string {
  const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  if (bytes < 1024 * 1024) return `${number.format(bytes / 1024)} KB`;
  return `${number.format(bytes / (1024 * 1024))} MB`;
}

/** O que ainda está sendo extraído/indexado: a lista se atualiza sozinha enquanto houver. */
export const IN_PROGRESS: readonly KnowledgeDocumentStatus[] = [
  'QUARANTINED',
  'QUEUED',
  'PROCESSING',
  'APPROVED',
  'INDEXING',
];

/** Situação de um artigo em palavras de gente, com o tom do selo que a acompanha. */
export function documentStatus(document: Pick<KnowledgeDocumentView, 'status'>): {
  tone: StatusTone;
  label: string;
  busy: boolean;
} {
  if (document.status === 'PUBLISHED') return { tone: 'positive', label: 'Ativo', busy: false };
  if (document.status === 'FAILED') return { tone: 'attention', label: 'Falhou', busy: false };
  if (document.status === 'ARCHIVED') return { tone: 'quiet', label: 'Arquivado', busy: false };
  if (document.status === 'REJECTED') return { tone: 'quiet', label: 'Rejeitado', busy: false };
  if (IN_PROGRESS.includes(document.status))
    return { tone: 'neutral', label: 'Processando', busy: true };
  return { tone: 'neutral', label: 'Aguardando publicação', busy: false };
}
