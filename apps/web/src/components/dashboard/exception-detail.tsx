'use client';

/** Um caso da fila: o que aconteceu, o que foi proposto, o estado do aluno e a decisão do profissional. */
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  approveException,
  claimException,
  getException,
  getExceptionDecisions,
  rejectException,
  resolveException,
} from '@/lib/control-center-api';
import {
  ageLabel,
  describeAction,
  DOMAIN_LABEL,
  goalLabel,
  KIND_LABEL,
  PRIORITY_LABEL,
  UNCERTAINTY_LABEL,
} from '@/lib/exception-copy';

import { ConfirmAction } from './confirm-action';
import { StatusBadge } from './control-center-table';
import { ResourceState, useControlCenterResource } from './control-center-ui';

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function NoteField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <label className="mt-3 block text-xs font-medium text-muted-foreground">
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        maxLength={1000}
        className="mt-1 w-full rounded-md border border-input bg-card p-2 text-label text-foreground"
      />
    </label>
  );
}

export function ExceptionDetail({ id }: { id: string }) {
  const load = useCallback((signal?: AbortSignal) => getException(id, signal), [id]);
  const loadDecisions = useCallback(
    (signal?: AbortSignal) => getExceptionDecisions(id, signal),
    [id],
  );
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(load);
  const decisions = useControlCenterResource(loadDecisions);
  const [note, setNote] = useState('');

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

  const { case: item, proposal, safety, student, state } = data;
  const goals = record(state.goals);
  const adherence = record(state.adherence);
  const open = item.status !== 'RESOLVED';
  const canAct = open && item.canResolve;
  const done = async (action: () => Promise<unknown>) => {
    await action();
    setNote('');
    await Promise.all([refresh(), decisions.refresh()]);
  };

  return (
    <article className="space-y-6">
      <Link
        href="/dashboard/fila"
        className="inline-flex items-center gap-1.5 text-label text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Voltar para a fila
      </Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusBadge
            tone={item.priority === 'URGENT' || item.priority === 'HIGH' ? 'attention' : 'neutral'}
          >
            {PRIORITY_LABEL[item.priority]}
          </StatusBadge>
          <h1 className="text-h2 font-semibold">{KIND_LABEL[item.kind]}</h1>
          <span className="text-xs text-muted-foreground">
            {DOMAIN_LABEL[item.domain]} · {ageLabel(item.createdAt)}
          </span>
        </div>
        <p className="text-label">
          {student?.name ?? 'Aluno sem nome'}
          {goalLabel(record(goals.declared).primary)
            ? ` · ${goalLabel(record(goals.declared).primary)}`
            : ''}
        </p>
        <p className="max-w-prose text-label text-muted-foreground">{item.summary}</p>
      </header>

      {safety ? (
        <section
          className="rounded-xl border border-border bg-card p-4 sm:p-5"
          aria-label="Sinal de segurança"
        >
          <h2 className="text-h3 font-semibold">Sinal de segurança</h2>
          <p className="mt-1 text-label">
            {safety.kind} · {safety.severity} · escopo {safety.scope}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">Trecho: “{safety.evidence}”</p>
          {!safety.canResolve && safety.status === 'ACTIVE' ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Este sinal só pode ser encerrado pelo profissional do domínio dele.
            </p>
          ) : null}
        </section>
      ) : null}

      {proposal ? (
        <section
          className="rounded-xl border border-border bg-card p-4 sm:p-5"
          aria-label="Proposta do sistema"
        >
          <h2 className="text-h3 font-semibold">O que o sistema propôs</h2>
          <p className="mt-1 text-label">{describeAction(proposal.action)}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {proposal.rationale.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {proposal.assumptions.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs font-medium">Hipóteses (não confirmadas)</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                {proposal.assumptions.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground">
            Incerteza {UNCERTAINTY_LABEL[proposal.uncertainty]} · Como saber se funcionou:{' '}
            {proposal.expectedOutcome}
          </p>
          {data.decision ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Por que veio para a fila: {data.decision.reasons.join(' ')}
            </p>
          ) : null}
        </section>
      ) : null}

      <section
        className="rounded-xl border border-border bg-card p-4 sm:p-5"
        aria-label="Estado do aluno"
      >
        <h2 className="text-h3 font-semibold">Estado do aluno</h2>
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-label sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Adesão (28 dias)</dt>
            <dd>
              {typeof adherence.rate === 'number'
                ? `${Math.round(adherence.rate * 100)}% (${String(adherence.done)} de ${String(adherence.planned)} sessões)`
                : 'sem sessões no período'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Estratégia</dt>
            <dd>{String(record(record(goals.strategy)).title ?? 'ainda não definida')}</dd>
          </div>
        </dl>
      </section>

      {item.resolution ? (
        <section
          className="rounded-xl border border-border bg-card p-4 sm:p-5"
          aria-label="Resolução"
        >
          <h2 className="text-h3 font-semibold">Como foi resolvido</h2>
          <p className="mt-1 text-label">
            {String(item.resolution.outcome)}
            {item.resolution.note ? ` — ${String(item.resolution.note)}` : ''}
          </p>
        </section>
      ) : null}

      {canAct ? (
        <section
          className="rounded-xl border border-border bg-card p-4 sm:p-5"
          aria-label="Decisão do profissional"
        >
          <h2 className="text-h3 font-semibold">Sua decisão</h2>
          <NoteField value={note} onChange={setNote} label="Nota (fica na trilha de decisões)" />
          <div className="mt-4 flex flex-wrap gap-3">
            {item.status === 'OPEN' ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void done(() => claimException(item.id))}
              >
                Assumir
              </Button>
            ) : null}
            {proposal && proposal.status === 'PENDING' ? (
              <>
                <ConfirmAction
                  triggerLabel="Aprovar proposta"
                  title="Aprovar e executar a mudança?"
                  description={describeAction(proposal.action)}
                  confirmLabel="Aprovar"
                  onConfirm={() => done(() => approveException(item.id, note.trim() || undefined))}
                />
                <ConfirmAction
                  triggerLabel="Recusar proposta"
                  triggerVariant="outline"
                  title="Recusar a proposta?"
                  description="Nada muda no plano do aluno. A nota é obrigatória."
                  confirmLabel="Recusar"
                  confirmDisabled={note.trim().length < 3}
                  onConfirm={() => done(() => rejectException(item.id, note.trim()))}
                />
              </>
            ) : (
              <ConfirmAction
                triggerLabel="Encerrar caso"
                title="Encerrar o caso?"
                description={
                  safety && safety.status === 'ACTIVE'
                    ? 'O sinal de segurança também será encerrado. A nota é obrigatória.'
                    : 'A nota é obrigatória e fica na trilha.'
                }
                confirmLabel="Encerrar"
                confirmDisabled={note.trim().length < 3}
                onConfirm={() => done(() => resolveException(item.id, note.trim()))}
              />
            )}
          </div>
        </section>
      ) : null}

      <section aria-label="Trilha de decisões" className="space-y-2">
        <h2 className="text-h3 font-semibold">Trilha de decisões do aluno</h2>
        {decisions.data && decisions.data.length > 0 ? (
          <ol className="space-y-2">
            {decisions.data.map((row) => (
              <li key={row.proposalId} className="rounded-lg border border-border p-3 text-xs">
                <span className="font-medium">{row.action}</span>
                <span className="text-muted-foreground">
                  {' · '}
                  {row.verdict ?? 'sem decisão'}
                  {row.decidedBy === 'STAFF'
                    ? ' pelo profissional'
                    : row.verdict
                      ? ' pelas políticas'
                      : ''}
                  {' · '}
                  {dateTime.format(new Date(row.createdAt))}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-muted-foreground">Sem decisões registradas.</p>
        )}
      </section>
    </article>
  );
}
