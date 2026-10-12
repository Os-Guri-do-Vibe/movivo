'use client';

/**
 * Painel "Sistema → Scripts" — mapa de tudo que roda sozinho (crons e rotinas) e dos scripts
 * de terminal do repositório, com execução manual forçada dos que podem rodar pelo painel.
 *
 * Executar um cron aqui NÃO muda o agendamento padrão: o backend enfileira um job extra na
 * mesma fila, com `force`, que só ignora a janela de horário — a idempotência de cada envio
 * continua valendo, então ninguém recebe a mesma mensagem duas vezes.
 *
 * Execução de cron é assíncrona (fila): o painel faz polling enquanto houver uma execução
 * manual em andamento, para mostrar o resultado sem o operador recarregar a página.
 */
import { CalendarClock, ChevronDown, Play, Terminal } from 'lucide-react';
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import type { ControlCenterScript, ControlCenterScriptRunState } from '@movivo/shared';

import { Button } from '@/components/ui/button';
import { getSystemScripts, runSystemScript } from '@/lib/control-center-api';
import { cn } from '@/lib/utils';

import { ConfirmAction } from './confirm-action';
import { StatusBadge } from './control-center-table';
import type { StatusTone } from './control-center-table';
import { ResourceState, SectorHeader, useControlCenterResource } from './control-center-ui';

const POLL_INTERVAL_MS = 3_000;

const SECTIONS: ReadonlyArray<{
  kind: ControlCenterScript['kind'];
  title: string;
  hint: string;
  /** A lista de terminal é longa e só de consulta: nasce recolhida. */
  defaultOpen: boolean;
}> = [
  {
    kind: 'CRON',
    defaultOpen: true,
    title: 'Crons agendados',
    hint: 'Varreduras que rodam sozinhas. Executar aqui roda uma vez agora, sem alterar o horário padrão.',
  },
  {
    kind: 'ROUTINE',
    defaultOpen: true,
    title: 'Rotinas internas',
    hint: 'Rotinas da API que rodam em timer ou sob demanda. Executar aqui roda na hora.',
  },
  {
    kind: 'TERMINAL',
    defaultOpen: false,
    title: 'Scripts de terminal',
    hint: 'Precisam de argumento, acesso à VPS ou são pontuais. Ficam listados para consulta e rodam só pelo terminal.',
  },
];

const RUN_STATE: Record<ControlCenterScriptRunState, { label: string; tone: StatusTone }> = {
  QUEUED: { label: 'Na fila', tone: 'neutral' },
  RUNNING: { label: 'Executando', tone: 'neutral' },
  COMPLETED: { label: 'Concluído', tone: 'positive' },
  FAILED: { label: 'Falhou', tone: 'attention' },
};

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

function isInFlight(script: ControlCenterScript): boolean {
  const state = script.lastRun?.state;
  return state === 'QUEUED' || state === 'RUNNING';
}

function LastRun({ run }: { run: NonNullable<ControlCenterScript['lastRun']> }) {
  const { label, tone } = RUN_STATE[run.state];
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>Última execução manual:</span>
      <StatusBadge tone={tone}>{label}</StatusBadge>
      {run.at ? <time dateTime={run.at}>{dateTime.format(new Date(run.at))}</time> : null}
      {run.summary ? <span>{run.summary}</span> : null}
    </p>
  );
}

function ScriptRow({
  script,
  notice,
  onRun,
}: {
  script: ControlCenterScript;
  notice: string | undefined;
  onRun: (script: ControlCenterScript) => Promise<void>;
}) {
  const inFlight = isInFlight(script);
  return (
    <li className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-h3 font-semibold">{script.name}</h3>
          <p className="mt-1 text-label text-muted-foreground">{script.description}</p>
          {script.schedule ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarClock aria-hidden="true" className="size-3.5" />
              {script.schedule}
            </p>
          ) : null}
          {script.command ? (
            <code className="mt-2 block overflow-x-auto rounded-md bg-secondary px-2.5 py-1.5 font-mono text-xs">
              {script.command}
            </code>
          ) : null}
          {script.lastRun ? <LastRun run={script.lastRun} /> : null}
          {notice ? (
            <p role="status" className="mt-2 text-xs font-medium">
              {notice}
            </p>
          ) : null}
        </div>
        {script.runnable ? (
          <ConfirmAction
            triggerLabel={`Executar ${script.name}`}
            triggerIcon={Play}
            triggerVariant="default"
            triggerSize="icon"
            title={`Executar "${script.name}" agora?`}
            description={
              (script.runEffect ?? '') +
              (script.schedule && script.kind === 'CRON'
                ? ' O agendamento padrão não é alterado.'
                : '')
            }
            confirmLabel="Executar agora"
            disabled={inFlight}
            onConfirm={() => onRun(script)}
          />
        ) : (
          <Button
            type="button"
            variant="default"
            size="icon"
            disabled
            aria-label={`Executar ${script.name}`}
            title={script.notRunnableReason ?? 'Não executável pelo painel.'}
          >
            <Play aria-hidden="true" />
          </Button>
        )}
      </div>
      {!script.runnable && script.notRunnableReason ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Terminal aria-hidden="true" className="size-3.5" />
          {script.notRunnableReason}
        </p>
      ) : null}
    </li>
  );
}

function ScriptSection({
  title,
  hint,
  defaultOpen,
  count,
  children,
}: {
  title: string;
  hint: string;
  defaultOpen: boolean;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <section aria-label={title}>
      <h2 className="text-h2 font-bold">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((current) => !current)}
          className="flex w-full items-center gap-2 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-5 shrink-0 text-verde-pulso transition-transform',
              !open && '-rotate-90',
            )}
          />
          {title}
          <span className="text-label font-medium text-muted-foreground">({count})</span>
        </button>
      </h2>
      <div id={panelId} hidden={!open}>
        <p className="mt-1 text-label text-muted-foreground">{hint}</p>
        <ul className="mt-4 space-y-3">{children}</ul>
      </div>
    </section>
  );
}

export function ScriptsDashboard() {
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(getSystemScripts);
  const [notices, setNotices] = useState<Record<string, string>>({});

  const scripts = data?.data.scripts;
  const anyInFlight = scripts?.some(isInFlight) ?? false;

  // Polling só enquanto há execução manual em andamento; some quando todas terminam.
  useEffect(() => {
    if (!anyInFlight) return;
    const id = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [anyInFlight, refresh]);

  const handleRun = useCallback(
    async (script: ControlCenterScript) => {
      const response = await runSystemScript(script.id);
      setNotices((current) => ({ ...current, [script.id]: response.data.message }));
      await refresh();
    },
    [refresh],
  );

  return (
    <section aria-label="Scripts do sistema">
      <SectorHeader
        title="Scripts"
        icon={Terminal}
        meta={data?.meta}
        refreshing={loading}
        onRefresh={() => void refresh()}
      />
      {!scripts ? (
        <ResourceState
          loading={loading}
          error={error}
          forbidden={forbidden}
          onRetry={() => void refresh()}
        />
      ) : (
        <div className="mt-6 space-y-8">
          {SECTIONS.map((section) => {
            const items = scripts.filter((script) => script.kind === section.kind);
            if (!items.length) return null;
            return (
              <ScriptSection
                key={section.kind}
                title={section.title}
                hint={section.hint}
                defaultOpen={section.defaultOpen}
                count={items.length}
              >
                {items.map((script) => (
                  <ScriptRow
                    key={script.id}
                    script={script}
                    notice={notices[script.id]}
                    onRun={handleRun}
                  />
                ))}
              </ScriptSection>
            );
          })}
        </div>
      )}
    </section>
  );
}
