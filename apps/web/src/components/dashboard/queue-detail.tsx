'use client';

import { ArrowLeft, CheckCircle2, Pencil, RefreshCw, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  captureDashboardEvent,
  getQueueDetail,
  releaseParq,
  resolveHandoff,
  signProtocol,
} from '@/lib/dashboard-api';
import type {
  ProtocolDetail,
  QueueDetail as QueueDetailType,
  QueueKind,
} from '@/lib/dashboard-types';

import { ConfirmAction } from './confirm-action';
import { ConversationReplay } from './conversation-replay';
import { WEEKDAY_ITEMS } from '../onboarding/step2-anamnesis';
import { ProtocolEditor } from './protocol-editor';
import { meaningfulText } from './queue-board';

const fieldClass =
  'min-h-11 w-full rounded-lg border border-input bg-background px-3 text-label focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring';

/** Reusa os MESMOS rótulos do formulário de anamnese — não duplicar texto. */
const WEEKDAY_LABELS: Record<string, string> = Object.fromEntries(
  WEEKDAY_ITEMS.map((item) => [item.value, item.label]),
);

/** Únicos 4 valores do enum real de fase (`ProtocolStructure.phase`). */
const PHASE_LABELS: Record<string, string> = {
  ADAPTACAO: 'Adaptação',
  HIPERTROFIA: 'Hipertrofia',
  FORCA: 'Força',
  DELOAD: 'Deload',
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'horário não informado'
    : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

/**
 * `DIA DA SEMANA | NOME DO TREINO | FASE` (achado 2026-08-18, decisão do fundador).
 * `weekday` ausente (protocolo persistido antes deste campo existir) → cai pro
 * `dayLabel` cru como já era exibido, nunca quebra conteúdo antigo.
 */
function sessionTitle(
  session: { dayLabel: string; weekday?: string; focus: string },
  phase: string,
): string {
  const day = session.weekday
    ? (WEEKDAY_LABELS[session.weekday] ?? session.weekday)
    : session.dayLabel;
  const phaseLabel = PHASE_LABELS[phase] ?? phase;
  return `${day} | ${session.focus} | ${phaseLabel}`;
}

function humanizeKey(key: string): string {
  const known: Record<string, string> = {
    goal: 'Objetivo',
    level: 'Nível',
    location: 'Local',
    age: 'Idade',
    weeklyFrequency: 'Frequência semanal',
    reason: 'Motivo',
    checkinEffort: 'Percepção no check-in',
    workoutsCompleted: 'Treinos concluídos',
  };
  return known[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function ProtocolSummary({ protocol, onEdit }: { protocol: ProtocolDetail; onEdit: () => void }) {
  return (
    <section
      aria-labelledby="protocol-title"
      className="rounded-xl border border-border bg-card p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="protocol-title" className="text-h2 font-bold">
            Protocolo · versão {protocol.version}
          </h2>
          <p className="mt-1 text-label text-muted-foreground">
            {protocol.content.phase} · {protocol.content.weeklyFrequency}x por semana
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onEdit}
          aria-label="Editar Protocolo"
          title="Editar Protocolo"
        >
          <Pencil aria-hidden="true" className="size-4" />
        </Button>
      </div>

      <div className="mt-5 space-y-4">
        {protocol.content.sessions.map((session, index) => (
          <details
            // `dayLabel` sozinho não é único (fallback alterna "Treino A"/"Treino B" —
            // achado 2026-08-18); índice garante a chave mesmo com rótulos repetidos.
            key={`${index}-${session.dayLabel}`}
            className="rounded-lg border border-border bg-background p-4"
            open
          >
            <summary className="cursor-pointer text-h3 font-semibold focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
              {sessionTitle(session, protocol.content.phase)}
            </summary>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[38rem] border-collapse text-left text-label">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th scope="col" className="p-2 font-semibold">
                      Exercício
                    </th>
                    <th scope="col" className="p-2 font-semibold">
                      Séries
                    </th>
                    <th scope="col" className="p-2 font-semibold">
                      Repetições / Duração
                    </th>
                    <th scope="col" className="p-2 font-semibold">
                      Descanso
                    </th>
                    <th scope="col" className="p-2 font-semibold">
                      Estratégia
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {session.exercises.map((exercise) => (
                    <tr key={exercise.exerciseId} className="border-b border-border last:border-0">
                      <td className="p-2">
                        <span className="font-semibold">{exercise.name}</span>
                        {exercise.notes ? (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {exercise.notes}
                          </span>
                        ) : null}
                      </td>
                      <td className="p-2 font-mono">{exercise.sets}</td>
                      <td className="p-2 font-mono">
                        {exercise.durationSeconds !== undefined
                          ? `${exercise.durationSeconds}s`
                          : exercise.reps
                            ? `${exercise.reps.min}–${exercise.reps.max}`
                            : ''}
                      </td>
                      <td className="p-2 font-mono">{exercise.restSeconds}s</td>
                      <td className="p-2 text-xs">{exercise.loadStrategy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
      {protocol.content.generalNotes ? (
        <div className="mt-5 rounded-lg bg-secondary p-4">
          <h3 className="text-label font-semibold">Observações do protocolo</h3>
          <p className="mt-1 whitespace-pre-wrap text-label text-secondary-foreground">
            {protocol.content.generalNotes}
          </p>
        </div>
      ) : null}
      {protocol.signatureHash ? (
        <p className="mt-4 break-all font-mono text-xs text-muted-foreground">
          Assinatura registrada em{' '}
          {protocol.signedAt ? formatDate(protocol.signedAt) : 'data não informada'} · hash{' '}
          {protocol.signatureHash}
        </p>
      ) : null}
    </section>
  );
}

function Context({ detail }: { detail: QueueDetailType }) {
  const entries = Object.entries(detail.context);
  return (
    <section
      aria-labelledby="context-title"
      className="rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <h2 id="context-title" className="text-h3 font-semibold">
        Contexto autorizado
      </h2>
      {entries.length === 0 ? (
        <p className="mt-3 text-label text-muted-foreground">
          Nenhum contexto adicional foi disponibilizado.
        </p>
      ) : (
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {entries.map(([key, value]) => (
            <div key={key} className="rounded-lg bg-secondary p-3">
              <dt className="text-xs font-semibold text-muted-foreground">{humanizeKey(key)}</dt>
              <dd className="mt-1 text-label">
                {value === null ? 'Não informado' : String(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function QueueDetail({ kind, id }: { kind: QueueKind; id: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<QueueDetailType | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [parqDecision, setParqDecision] = useState<'' | 'RELEASED'>('');
  const [parqNotes, setParqNotes] = useState('');
  const [resolution, setResolution] = useState('Contato realizado e orientação registrada.');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [editingProtocol, setEditingProtocol] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError('');
      try {
        setDetail(await getQueueDetail(kind, id, signal));
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(caught instanceof Error ? caught.message : 'Não foi possível carregar o caso.');
      }
    },
    [id, kind],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function runAction(action: () => Promise<unknown>, event: string, message: string) {
    await action();
    captureDashboardEvent(event, { kind });
    setSuccess(message);
    await load();
  }

  async function resolveQueueItem() {
    await resolveHandoff(id, resolution.trim(), resolutionNotes.trim());
    captureDashboardEvent(kind === 'CHECKIN' ? 'cref_checkin_resolved' : 'cref_handoff_resolved', {
      kind,
    });
    router.replace('/dashboard/educacao-fisica');
  }

  if (!detail && !error) {
    return (
      <div
        role="status"
        className="h-72 animate-pulse rounded-xl border border-border bg-card"
        aria-label="Carregando caso"
      />
    );
  }
  if (!detail) {
    return (
      <section role="alert" className="rounded-xl border border-coral bg-card p-6">
        <h1 className="text-h2 font-bold">O caso não carregou</h1>
        <p className="mt-2 text-body text-muted-foreground">{error}</p>
        <Button className="mt-4" onClick={() => void load()}>
          <RefreshCw aria-hidden="true" /> Tentar novamente
        </Button>
      </section>
    );
  }

  return (
    <article>
      <Link
        href="/dashboard/educacao-fisica"
        className="inline-flex min-h-11 items-center gap-2 text-label font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" /> Voltar à fila
      </Link>

      <header className="mt-5 rounded-xl border border-border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            {detail.item.severity === 'SAFETY' ? (
              <p className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                <ShieldAlert aria-hidden="true" className="size-4 text-coral" />
                SEGURANÇA · PRIORIDADE
              </p>
            ) : null}
            <h1 className="mt-2 text-h1 font-bold">{detail.item.title}</h1>
            {meaningfulText(detail.item.summary) ? (
              <p className="mt-2 max-w-3xl text-body text-muted-foreground">
                {meaningfulText(detail.item.summary)}
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <div aria-live="polite" aria-atomic="true">
        {success ? (
          <p
            role="status"
            className="mt-4 flex items-center gap-2 rounded-lg bg-accent p-3 text-label text-accent-foreground"
          >
            <CheckCircle2 aria-hidden="true" /> {success}
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-destructive p-3 text-label text-destructive-foreground"
          >
            {error}
          </p>
        ) : null}
      </div>

      <div className="mt-5 space-y-5">
        {detail.protocol ? (
          editingProtocol ? (
            <ProtocolEditor
              protocolId={detail.protocol.id}
              content={detail.protocol.content}
              onCancel={() => setEditingProtocol(false)}
              onSaved={async () => {
                setEditingProtocol(false);
                setSuccess('Edição validada no servidor e registrada para revisão.');
                await load();
              }}
            />
          ) : (
            <ProtocolSummary protocol={detail.protocol} onEdit={() => setEditingProtocol(true)} />
          )
        ) : null}
        {detail.replay ? <ConversationReplay replay={detail.replay} /> : null}

        <Context detail={detail} />

        {kind === 'PROTOCOL' && detail.protocol && !detail.protocol.signatureHash ? (
          <section
            aria-labelledby="sign-title"
            className="rounded-xl border border-border bg-card p-5"
          >
            <h2 id="sign-title" className="text-h3 font-semibold">
              Assinatura profissional
            </h2>
            <p className="mt-2 text-label text-muted-foreground">
              Registra profissional autenticado, horário e hash do conteúdo na trilha imutável.
            </p>
            <div className="mt-4">
              <ConfirmAction
                triggerLabel="Assinar protocolo"
                title="Confirmar assinatura deste conteúdo?"
                description="Revise o protocolo completo. A confirmação registra sua conta, o horário e o hash exato desta versão."
                confirmLabel="Confirmar e assinar"
                onConfirm={() =>
                  runAction(
                    () => signProtocol(detail.protocol?.id ?? id),
                    'cref_protocol_signed',
                    'Protocolo assinado e auditoria registrada.',
                  )
                }
              />
            </div>
          </section>
        ) : null}

        {kind === 'PARQ' ? (
          <section
            aria-labelledby="parq-title"
            className="rounded-xl border border-coral bg-card p-5"
          >
            <h2 id="parq-title" className="text-h3 font-semibold">
              Liberação humana PAR-Q
            </h2>
            <p className="mt-2 text-label text-muted-foreground">
              Esta sessão nunca é liberada automaticamente. Registre a decisão após revisar as
              respostas e documentos disponíveis.
            </p>
            {detail.parq?.flags.length ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-label">
                {detail.parq.flags.map((flag) => (
                  <li key={flag}>{flag}</li>
                ))}
              </ul>
            ) : null}
            <label className="mt-4 flex flex-col gap-2 text-label font-semibold">
              Decisão
              <select
                className={fieldClass}
                value={parqDecision}
                onChange={(event) => setParqDecision(event.target.value as typeof parqDecision)}
              >
                <option value="" disabled>
                  Selecione após revisar
                </option>
                <option value="RELEASED">Liberar após revisão profissional</option>
              </select>
            </label>
            <label className="mt-4 flex flex-col gap-2 text-label font-semibold">
              Registro profissional <span className="text-xs font-normal">(obrigatório)</span>
              <textarea
                className={`${fieldClass} min-h-24 py-2`}
                value={parqNotes}
                maxLength={1000}
                required
                onChange={(event) => setParqNotes(event.target.value)}
              />
            </label>
            <div className="mt-4">
              <ConfirmAction
                triggerLabel="Registrar liberação"
                title="Confirmar a liberação desta sessão?"
                description="A decisão desbloqueia o fluxo somente por ação humana e será anexada à auditoria."
                confirmLabel="Confirmar liberação"
                destructive
                disabled={parqDecision !== 'RELEASED' || parqNotes.trim().length < 5}
                onConfirm={() =>
                  runAction(
                    () => releaseParq(id, parqNotes.trim()),
                    'cref_parq_released',
                    'Liberação PAR-Q registrada com auditoria.',
                  )
                }
              />
            </div>
          </section>
        ) : null}

        {kind === 'HANDOFF' || kind === 'CHECKIN' ? (
          <section
            aria-labelledby="handoff-title"
            className="rounded-xl border border-border bg-card p-5"
          >
            <h2 id="handoff-title" className="text-h3 font-semibold">
              {kind === 'CHECKIN' ? 'Resolver sinalização de check-in' : 'Resolver handoff'}
            </h2>
            <p className="mt-2 text-label text-muted-foreground">
              {kind === 'CHECKIN'
                ? 'Registre a revisão profissional que encerra esta sinalização.'
                : 'Registre como a intervenção profissional foi concluída. Casos de segurança exigem revisão antes do fechamento.'}
            </p>
            <label className="mt-4 flex flex-col gap-2 text-label font-semibold">
              Resolução
              <input
                className={fieldClass}
                value={resolution}
                maxLength={80}
                onChange={(event) => setResolution(event.target.value)}
              />
            </label>
            <label className="mt-4 flex flex-col gap-2 text-label font-semibold">
              Observações
              <textarea
                className={`${fieldClass} min-h-24 py-2`}
                value={resolutionNotes}
                maxLength={1000}
                required
                onChange={(event) => setResolutionNotes(event.target.value)}
              />
            </label>
            <div className="mt-4">
              <ConfirmAction
                triggerLabel={kind === 'CHECKIN' ? 'Resolver sinalização' : 'Marcar como resolvido'}
                title={
                  kind === 'CHECKIN'
                    ? 'Confirmar resolução da sinalização?'
                    : 'Confirmar resolução do handoff?'
                }
                description="O item sairá da fila aberta e a resolução ficará registrada na trilha de auditoria."
                confirmLabel="Confirmar resolução"
                destructive={detail.item.severity === 'SAFETY'}
                disabled={resolution.trim().length < 3 || resolutionNotes.trim().length < 3}
                onConfirm={resolveQueueItem}
              />
            </div>
          </section>
        ) : null}
      </div>
    </article>
  );
}
