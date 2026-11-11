'use client';

/**
 * Respostas da anamnese do aluno, para o profissional que revisa o protocolo. Mostra o que o
 * aluno respondeu como ele leu no formulário (PT-BR, mesma ordem e mesmas etapas), com os
 * pontos de saúde no topo. A leitura é auditada pelo servidor; busca ao abrir (não ao montar a
 * tela), porque o conteúdo é dado de saúde.
 *
 * Layout: tela cheia no celular; janela central a partir do `sm`. Com espaço (container
 * `@4xl`), as etapas ficam numa coluna lateral; no estreito, viram chips roláveis acima do
 * conteúdo. O título de cada etapa fica preso no topo enquanto ela rola.
 */
import type { AnamnesisAnswersView } from '@movivo/shared';
import {
  AlertTriangle,
  ChevronRight,
  ClipboardList,
  Eye,
  FileQuestion,
  Lock,
  RefreshCw,
  X,
} from 'lucide-react';
import { useCallback, useId, useMemo, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  readAnamnesis,
  type AnamnesisReading,
  type AnswerRow,
  type AnswerSection,
  type AnswerValue,
  type AttentionItem,
} from '@/lib/anamnesis-labels';
import { ControlCenterApiError, getExceptionAnamnesis } from '@/lib/control-center-api';
import { initialsOf } from '@/lib/professional-queue';
import { cn } from '@/lib/utils';

import { FOCUS_RING, ICON_BUTTON, StatusBadge } from './control-center-table';
import { useControlCenterResource } from './control-center-ui';
import { IconAction } from './icon-action';

/** Tela cheia no celular; janela central e alta a partir do `sm`, com largura máxima. */
const MODAL_CLASS = cn(
  'flex flex-col gap-0 overflow-hidden p-0',
  'top-0 left-0 h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 rounded-none border-0',
  'sm:top-1/2 sm:left-1/2 sm:h-[min(92dvh,64rem)] sm:w-[calc(100vw-3rem)] sm:max-w-6xl',
  'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border',
);

/** Mesma margem lateral para cabeçalho, conteúdo e títulos presos (que sangram até a borda). */
const GUTTER = 'px-4 sm:px-8';
const BLEED = '-mx-4 px-4 sm:-mx-8 sm:px-8';

const pad = (step: number) => String(step).padStart(2, '0');

// --- Valores ----------------------------------------------------------------------------------

function Value({ value }: { value: AnswerValue }) {
  switch (value.kind) {
    case 'text':
      if (value.tone === 'risk') {
        return (
          <span className="font-medium">
            <StatusBadge tone="attention">{value.text}</StatusBadge>
          </span>
        );
      }
      return (
        <span className={value.tone === 'muted' ? 'text-muted-foreground' : undefined}>
          {value.text}
        </span>
      );
    case 'paragraph':
      return (
        <p className="max-w-prose border-l-2 border-border pl-3 whitespace-pre-line">
          {value.text}
        </p>
      );
    case 'chips':
      return (
        <ul className="flex flex-wrap gap-1.5">
          {value.items.map((item, index) => (
            <li
              key={`${index}-${item}`}
              className="inline-flex min-h-7 items-center rounded-md border border-border bg-secondary/40 px-2 text-xs font-medium text-secondary-foreground"
            >
              {item}
            </li>
          ))}
        </ul>
      );
    case 'pairs':
      return (
        <dl className="grid max-w-md grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1.5">
          {value.items.map((item, index) => (
            <div key={`${index}-${item.label}`} className="contents">
              <dt className="min-w-0">{item.label}</dt>
              <dd className="text-right font-medium tabular-nums">
                {item.tone === 'risk' ? (
                  <StatusBadge tone="attention">{item.value}</StatusBadge>
                ) : (
                  item.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      );
    case 'groups':
      return (
        <div className="grid gap-3">
          {value.items.map((group, index) => (
            <div key={`${index}-${group.title}`} className="rounded-lg border border-border">
              <p className="border-b border-border px-3 py-2 text-label font-medium">
                {group.title}
              </p>
              <dl className="divide-y divide-border px-3">
                {group.rows.map((row) => (
                  <div
                    key={row.id}
                    className="grid gap-0.5 py-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] sm:gap-4"
                  >
                    <dt className="text-xs text-muted-foreground sm:text-label">{row.label}</dt>
                    <dd className="min-w-0">
                      {row.value ? <Value value={row.value} /> : null}
                      <RowNotes row={row} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      );
  }
}

function RowNotes({ row }: { row: AnswerRow }) {
  return (
    <>
      {row.note ? <p className="mt-1 text-xs text-muted-foreground">{row.note}</p> : null}
      {row.detail ? (
        <p className="mt-2 max-w-prose border-l-2 border-border pl-3 whitespace-pre-line">
          {row.detail}
        </p>
      ) : null}
    </>
  );
}

/** Pergunta à esquerda e resposta à direita, com a mesma coluna de rótulo em toda a leitura. */
function Row({ row }: { row: AnswerRow }) {
  return (
    <div className="grid gap-1 py-3 @xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] @xl:gap-6">
      <dt className="text-label text-muted-foreground">{row.label}</dt>
      <dd className="min-w-0 text-label">
        {row.value ? <Value value={row.value} /> : <span className="text-muted-foreground">—</span>}
        <RowNotes row={row} />
      </dd>
    </div>
  );
}

// --- Seções -----------------------------------------------------------------------------------

function Section({ section }: { section: AnswerSection }) {
  const headingId = useId();
  const listId = useId();
  const [showBlank, setShowBlank] = useState(false);
  const blank = section.unanswered.length;
  return (
    <section
      id={section.anchor}
      data-anamnesis-section={section.step}
      aria-labelledby={headingId}
      className="pt-8"
    >
      <header
        className={cn(
          'sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card py-3',
          BLEED,
        )}
      >
        <span aria-hidden="true" className="font-mono text-xs text-muted-foreground tabular-nums">
          {pad(section.step)}
        </span>
        <h3 id={headingId} tabIndex={-1} className="text-body font-semibold outline-none">
          {section.title}
        </h3>
        {section.sensitive ? (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock aria-hidden="true" className="size-3.5" />
            Dado de saúde
          </span>
        ) : null}
      </header>
      {section.skippedNote ? (
        <p className="py-4 text-label text-muted-foreground">{section.skippedNote}</p>
      ) : (
        <dl className="divide-y divide-border">
          {section.rows.map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </dl>
      )}
      {blank > 0 ? (
        <div className="border-t border-border">
          <button
            type="button"
            aria-expanded={showBlank}
            aria-controls={listId}
            onClick={() => setShowBlank((open) => !open)}
            className={cn(
              'mt-1 inline-flex min-h-11 items-center rounded-md text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline lg:min-h-9',
              FOCUS_RING,
            )}
          >
            {showBlank
              ? 'Ocultar perguntas sem resposta'
              : `Mostrar ${blank} ${blank === 1 ? 'pergunta sem resposta' : 'perguntas sem resposta'}`}
          </button>
          {showBlank ? (
            <dl id={listId} className="divide-y divide-border">
              {section.unanswered.map((row) => (
                <Row key={row.id} row={row} />
              ))}
            </dl>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function AttentionPanel({
  reading,
  onJump,
}: {
  reading: AnamnesisReading;
  onJump: (step: number) => void;
}) {
  const headingId = useId();
  const titleOf = (step: number) => reading.sections.find((s) => s.step === step)?.title ?? '';
  const yes = reading.attention.filter((item) => item.id.startsWith('parq.')).length;
  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-border">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-3">
        <h3 id={headingId} className="text-label font-semibold">
          Pontos de atenção
        </h3>
        {reading.parqClear === null ? null : (
          <span className="text-xs">
            {reading.parqClear ? (
              <StatusBadge tone="positive">PAR-Q sem nenhum “Sim”</StatusBadge>
            ) : (
              <StatusBadge tone="attention">
                PAR-Q com {yes} {yes === 1 ? 'resposta' : 'respostas'} “Sim”
              </StatusBadge>
            )}
          </span>
        )}
      </header>
      {reading.attention.length === 0 ? (
        <p className="px-4 py-3 text-label text-muted-foreground">
          Sem dor, condição de saúde, medicamento ou alergia informados.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {reading.attention.map((item) => (
            <AttentionLine
              key={item.id}
              item={item}
              sectionTitle={titleOf(item.step)}
              onJump={onJump}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function AttentionLine({
  item,
  sectionTitle,
  onJump,
}: {
  item: AttentionItem;
  sectionTitle: string;
  onJump: (step: number) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onJump(item.step)}
        className={cn(
          'grid min-h-11 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50',
          FOCUS_RING,
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'mt-1.5 size-2 rounded-full',
            item.tone === 'attention' ? 'bg-coral' : 'bg-muted-foreground',
          )}
        />
        <span className="min-w-0">
          <span className="block text-label font-medium">{item.title}</span>
          {item.detail ? (
            <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
              {item.detail}
            </span>
          ) : null}
        </span>
        <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
          <span className="sr-only">Ver em </span>
          <span className="hidden sm:inline">{sectionTitle}</span>
          <span className="sr-only sm:hidden">{sectionTitle}</span>
          <ChevronRight aria-hidden="true" className="size-3.5" />
        </span>
      </button>
    </li>
  );
}

function StepNav({
  sections,
  active,
  onJump,
}: {
  sections: readonly AnswerSection[];
  active: number | null;
  onJump: (step: number) => void;
}) {
  return (
    <nav
      aria-label="Etapas da anamnese"
      className="shrink-0 border-b border-border @4xl:overflow-y-auto @4xl:border-r @4xl:border-b-0"
    >
      <ol className="flex gap-2 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] sm:px-8 @4xl:flex-col @4xl:gap-0.5 @4xl:overflow-visible @4xl:px-3 @4xl:py-5">
        {sections.map((section) => {
          const current = section.step === active;
          return (
            <li key={section.step} className="shrink-0">
              <button
                type="button"
                aria-current={current ? 'true' : undefined}
                onClick={() => onJump(section.step)}
                className={cn(
                  'inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-label whitespace-nowrap transition-colors lg:min-h-9',
                  '@4xl:w-full @4xl:rounded-md @4xl:border-transparent @4xl:px-2.5 @4xl:whitespace-normal',
                  current
                    ? 'border-foreground/20 bg-secondary font-medium text-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                  FOCUS_RING,
                )}
              >
                <span aria-hidden="true" className="font-mono text-xs tabular-nums">
                  {pad(section.step)}
                </span>
                <span className="text-left">{section.title}</span>
                {section.skippedNote ? <span className="sr-only">(sem respostas)</span> : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// --- Conteúdo ---------------------------------------------------------------------------------

/** Conteúdo da leitura (etapas, atalhos e pontos de atenção), sem o cabeçalho da janela. */
export function AnamnesisAnswersContent({ view }: { view: AnamnesisAnswersView }) {
  const reading = useMemo(() => readAnamnesis(view), [view]);
  return <ReadingBody reading={reading} />;
}

function ReadingBody({ reading }: { reading: AnamnesisReading }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(reading.sections[0]?.step ?? null);

  const jump = useCallback((step: number) => {
    const root = scrollRef.current;
    const target = root?.querySelector<HTMLElement>(`[data-anamnesis-section="${step}"]`);
    if (!target) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    target.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    target.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
    setActive(step);
  }, []);

  /** Etapa ativa no atalho: a última cujo topo já passou do topo da área de rolagem. */
  const onScroll = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    let current: number | null = null;
    for (const el of root.querySelectorAll<HTMLElement>('[data-anamnesis-section]')) {
      if (el.offsetTop - root.scrollTop <= 48) current = Number(el.dataset.anamnesisSection);
    }
    if (current !== null) setActive((prev) => (prev === current ? prev : current));
  }, []);

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col @4xl:grid @4xl:grid-cols-[15rem_minmax(0,1fr)]">
        <StepNav sections={reading.sections} active={active} onJump={jump} />
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <div
            className={cn(
              '@container mx-auto w-full max-w-3xl pt-5 pb-[max(2.5rem,env(safe-area-inset-bottom))]',
              GUTTER,
            )}
          >
            <AttentionPanel reading={reading} onJump={jump} />
            {reading.sections.map((section) => (
              <Section key={section.step} section={section} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Janela -----------------------------------------------------------------------------------

function Header({
  reading,
  loading,
  onClose,
}: {
  reading: AnamnesisReading | null;
  loading: boolean;
  onClose: () => void;
}) {
  const name = reading?.studentName ?? null;
  const meta = reading
    ? [reading.flowLabel, reading.submittedLabel].filter(Boolean).join(' · ')
    : '';
  return (
    <header
      className={cn('flex shrink-0 items-center gap-3 border-b border-border py-3 sm:py-4', GUTTER)}
    >
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-label font-semibold text-secondary-foreground"
      >
        {name ? initialsOf(name) : <ClipboardList className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <DialogTitle className="truncate text-body font-semibold sm:text-h3">
          {name ?? 'Respostas da anamnese'}
          {name ? <span className="sr-only">: respostas da anamnese</span> : null}
        </DialogTitle>
        {loading && !reading ? (
          <span
            aria-hidden="true"
            className="mt-1 block h-3 w-48 rounded bg-muted motion-safe:animate-pulse"
          />
        ) : meta ? (
          <p className="truncate text-xs text-muted-foreground">{meta}</p>
        ) : null}
        <DialogDescription className="mt-0.5 flex items-center gap-1.5 text-xs">
          <Lock aria-hidden="true" className="size-3 shrink-0" />
          Dado de saúde: esta leitura fica registrada na auditoria.
        </DialogDescription>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(ICON_BUTTON, 'shrink-0 self-start')}
        onClick={onClose}
        aria-label="Fechar"
      >
        <X aria-hidden="true" />
      </Button>
    </header>
  );
}

function Skeleton() {
  return (
    <div
      role="status"
      aria-label="Carregando a anamnese"
      className={cn('min-h-0 flex-1 space-y-8 overflow-hidden py-6', GUTTER)}
    >
      <div className="mx-auto max-w-3xl space-y-8">
        <div className="h-28 rounded-xl bg-muted motion-safe:animate-pulse" />
        {[0, 1, 2].map((block) => (
          <div key={block} className="space-y-4">
            <div className="h-4 w-44 rounded bg-muted motion-safe:animate-pulse" />
            {[0, 1, 2].map((line) => (
              <div key={line} className="grid gap-2 sm:grid-cols-[15rem_1fr] sm:gap-6">
                <div className="h-3.5 w-3/4 rounded bg-muted motion-safe:animate-pulse" />
                <div className="h-3.5 w-1/2 rounded bg-muted motion-safe:animate-pulse" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function StateMessage({
  icon,
  title,
  description,
  role,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  role?: 'alert';
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-12">
      <div role={role} className="max-w-sm text-center">
        <span className="mx-auto flex size-10 items-center justify-center rounded-full border border-border text-muted-foreground">
          {icon}
        </span>
        <h3 className="mt-4 text-body font-semibold">{title}</h3>
        <p className="mt-1 text-label text-muted-foreground">{description}</p>
        {action}
      </div>
    </div>
  );
}

/** Busca as respostas; "sem anamnese enviada" (404) é um estado vazio, não um erro. */
function Loaded({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        return await getExceptionAnamnesis(caseId, signal);
      } catch (caught) {
        if (caught instanceof ControlCenterApiError && caught.status === 404) return null;
        throw caught;
      }
    },
    [caseId],
  );
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(load);
  const reading = useMemo(() => (data ? readAnamnesis(data) : null), [data]);

  let body: ReactNode;
  if (reading) body = <ReadingBody reading={reading} />;
  else if (error) {
    body = (
      <StateMessage
        role="alert"
        icon={<AlertTriangle aria-hidden="true" className="size-5" />}
        title={
          forbidden
            ? 'A anamnese não faz parte do seu acesso'
            : 'Não foi possível carregar a anamnese'
        }
        description={
          forbidden ? 'Ler dado de saúde exige uma permissão que o seu papel não tem.' : error
        }
        action={
          forbidden ? null : (
            <Button className="mt-5" variant="outline" onClick={() => void refresh()}>
              <RefreshCw aria-hidden="true" /> Tentar novamente
            </Button>
          )
        }
      />
    );
  } else if (loading) body = <Skeleton />;
  else {
    body = (
      <StateMessage
        icon={<FileQuestion aria-hidden="true" className="size-5" />}
        title="Sem anamnese enviada"
        description="Quando o aluno enviar a anamnese, as respostas aparecem aqui."
      />
    );
  }

  return (
    <>
      <Header reading={reading} loading={loading} onClose={onClose} />
      {body}
    </>
  );
}

/** Botão que abre as respostas da anamnese do aluno do caso. */
export function AnamnesisAnswersButton({
  caseId,
  variant = 'button',
}: {
  caseId: string;
  /** `icon`: olho com dica, para a linha da Fila; `button`: botão com texto, na tela do caso. */
  variant?: 'button' | 'icon';
}) {
  const [open, setOpen] = useState(false);
  // Sem `DialogTrigger`, o Radix não sabe para onde devolver o foco ao fechar: devolve aqui.
  const triggerRef = useRef<HTMLSpanElement>(null);
  return (
    <>
      <span ref={triggerRef} className="contents">
        {variant === 'icon' ? (
          <IconAction
            label="Ver anamnese"
            hint="Respostas do aluno. Dado de saúde: a leitura fica registrada na auditoria."
            icon={Eye}
            onClick={() => setOpen(true)}
          />
        ) : (
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            <ClipboardList aria-hidden="true" />
            Ver anamnese
          </Button>
        )}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className={MODAL_CLASS}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.querySelector<HTMLElement>('button, a')?.focus();
          }}
        >
          {open ? <Loaded caseId={caseId} onClose={() => setOpen(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
