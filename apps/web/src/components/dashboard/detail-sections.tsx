'use client';

/**
 * Peças de leitura do texto longo da IA, compartilhadas pela Fila do Profissional ("Detalhes e
 * auditoria" da linha) e pela tela de revisão do protocolo: seção com rótulo, lista de tópicos,
 * leitura postural região a região, motivos da fila com o código técnico à parte e um disclosure
 * (painel que abre sob demanda). Nunca um parágrafo corrido.
 */
import { ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import type { LabeledLine, ReasonLine } from '@/lib/professional-queue';
import { cn } from '@/lib/utils';

import { FOCUS_RING } from './control-center-table';

/** Rótulo à esquerda e conteúdo à direita quando há espaço; empilhado no estreito. */
export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1.5 py-3 @3xl:grid-cols-[11rem_minmax(0,1fr)] @3xl:gap-6">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      <div className="min-w-0 max-w-prose text-label">{children}</div>
    </section>
  );
}

export function BulletList({ lines }: { lines: readonly string[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-4 marker:text-muted-foreground">
      {lines.map((text, index) => (
        <li key={`${index}-${text.slice(0, 24)}`}>{text}</li>
      ))}
    </ul>
  );
}

/** Avaliação postural por foto, uma região por linha. */
export function PostureList({ entries }: { entries: readonly LabeledLine[] }) {
  return (
    <dl className="grid gap-x-4 gap-y-2 @xl:grid-cols-[9rem_minmax(0,1fr)]">
      {entries.map((entry, index) => (
        <div key={`${index}-${entry.label}`} className="contents">
          <dt className="font-medium">{entry.label}</dt>
          <dd className="text-muted-foreground">{entry.text}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Motivos da decisão em frase; o código técnico, se houver, fica pequeno e separado. */
export function ReasonList({ reasons }: { reasons: readonly ReasonLine[] }) {
  return (
    <ul className="space-y-1.5">
      {reasons.map((reason, index) => (
        <li key={`${index}-${reason.text.slice(0, 24)}`}>
          {reason.text}
          {reason.code ? (
            <code className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              {reason.code}
            </code>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Painel que abre sob demanda: botão com `aria-expanded` e região rotulada. O conteúdo só é
 * montado aberto (o leitor de tela não percorre o que está fechado).
 */
export function Disclosure({
  title,
  summary,
  defaultOpen = false,
  children,
  className,
}: {
  title: string;
  /** Uma frase curta ao lado do título, visível com o painel fechado (ex.: "4 regiões"). */
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const regionId = useId();
  const buttonId = useId();
  return (
    <section className={cn('border-b border-border last:border-b-0', className)}>
      <h3>
        <button
          id={buttonId}
          type="button"
          aria-expanded={open}
          aria-controls={open ? regionId : undefined}
          onClick={() => setOpen((value) => !value)}
          className={cn(
            FOCUS_RING,
            'flex min-h-11 w-full items-center gap-3 rounded-md py-2 text-left lg:min-h-10',
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-label font-medium text-foreground">{title}</span>
            {summary ? (
              <span className="block truncate text-xs text-muted-foreground">{summary}</span>
            ) : null}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
              open && 'rotate-180',
            )}
          />
        </button>
      </h3>
      {open ? (
        <div
          id={regionId}
          role="region"
          aria-labelledby={buttonId}
          className="pb-4 text-label @container"
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** Texto que pode ser longo: mostra as primeiras linhas e um "Ver mais" que expande. */
export function ClampedList({
  lines,
  visible = 3,
}: {
  lines: readonly string[];
  visible?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? lines : lines.slice(0, visible);
  const hidden = lines.length - shown.length;
  return (
    <div className="space-y-2">
      <BulletList lines={shown} />
      {lines.length > visible ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className={cn(
            FOCUS_RING,
            'inline-flex min-h-11 items-center rounded-md text-xs font-medium text-foreground underline-offset-4 hover:underline lg:min-h-8',
          )}
        >
          {expanded ? 'Ver menos' : `Ver mais (${hidden})`}
        </button>
      ) : null}
    </div>
  );
}
