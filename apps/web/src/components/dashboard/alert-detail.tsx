'use client';

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  ALERT_LEVEL_LABEL,
  alertCopyFor,
  alertOriginNote,
  alertSourceLabel,
  isConversationSource,
  RESOLUTION_REASONS,
} from '@/lib/alert-copy';
import {
  captureDashboardEvent,
  DashboardApiError,
  getQueueDetail,
  resolveHandoff,
} from '@/lib/dashboard-api';
import type { QueueDetail } from '@/lib/dashboard-types';
import { elapsed } from '@/lib/relative-time';
import { cn } from '@/lib/utils';

import { ConfirmAction } from './confirm-action';
import { StatusBadge } from './control-center-table';
import { ConversationReplay } from './conversation-replay';
import { useMarkNotificationRead } from './notifications-provider';

const RETURN_HREF = '/dashboard/alertas';
const OTHER_REASON = 'Outro';
const fieldClass =
  'min-h-11 w-full rounded-lg border border-input bg-background px-3 text-label focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring';

function formatDateTime(value: string | undefined): string {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'horário não informado';
  const day = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(date);
  const time = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(date);
  return `${day} às ${time}`;
}

const CONTEXT_FIELDS: Record<
  string,
  Array<[key: string, label: string, unit?: string, optional?: boolean]>
> = {
  WORKOUT: [
    ['sessionKey', 'Treino'],
    ['scheduledDate', 'Data prevista'],
    ['durationSeconds', 'Duração'],
    ['perceivedEffort', 'Esforço percebido'],
    ['painExercises', 'Exercícios com dor relatada'],
    ['painNotes', 'Relato de dor', undefined, true],
    ['feelingNotes', 'Como o aluno se sentiu', undefined, true],
  ],
  WORKOUT_INSIGHT: [
    ['observedMinutes', 'Duração observada', 'min'],
    ['expectedMinutes', 'Duração prevista', 'min'],
  ],
};

function contextValue(key: string, value: string | number | boolean | null, unit?: string) {
  if (value === null || value === '') return 'Não informado';
  if (key === 'durationSeconds' && typeof value === 'number')
    return `${Math.round(value / 60)} min`;
  if (key === 'perceivedEffort') return `${value} de 10`;
  return unit ? `${value} ${unit}` : String(value);
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 id={id} className="text-h3 font-semibold">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function OriginSection({ detail }: { detail: QueueDetail }) {
  const handoff = detail.handoff;
  const sourceType = handoff?.sourceType ?? null;
  const trigger = handoff?.trigger;
  if (isConversationSource(sourceType)) {
    return (
      <Section id="alert-origin-title" title="O que gerou este alerta">
        {trigger ? (
          <>
            <p className="text-xs font-medium text-muted-foreground">
              {trigger.direction === 'INBOUND' ? 'Mensagem do aluno' : 'Mensagem do AI Coach'}
            </p>
            <p className="mt-1 whitespace-pre-wrap rounded-lg bg-secondary p-4 text-body leading-relaxed">
              {trigger.content}
            </p>
            <time dateTime={trigger.createdAt} className="mt-2 block text-xs text-muted-foreground">
              Recebida em {formatDateTime(trigger.createdAt)}
            </time>
          </>
        ) : (
          <>
            <p className="text-label text-foreground">
              A mensagem de origem não está disponível para este alerta.
            </p>
            <p className="mt-1 text-label text-muted-foreground">
              Veja a conversa recente abaixo para entender o contexto.
            </p>
          </>
        )}
      </Section>
    );
  }
  return (
    <Section id="alert-origin-title" title="O que gerou este alerta">
      <p className="text-label text-foreground">
        {alertOriginNote(sourceType) ?? 'Gerado por um acompanhamento do AI Coach.'}
      </p>
    </Section>
  );
}

/** Campos da origem não conversacional (treino, acompanhamento de duração, check-in). */
function SourceContext({ detail, checkin }: { detail: QueueDetail; checkin: QueueDetail | null }) {
  const sourceType = detail.handoff?.sourceType ?? null;
  const fields = sourceType ? CONTEXT_FIELDS[sourceType] : undefined;
  let rows: Array<[label: string, value: string]> = [];
  if (fields) {
    rows = fields
      // Anotações livres só aparecem quando o aluno escreveu algo.
      .filter(([key, , , optional]) => !optional || Boolean(detail.context[key]))
      .map(([key, label, unit]) => [label, contextValue(key, detail.context[key] ?? null, unit)]);
  } else if (sourceType === 'CHECKIN' && checkin) {
    rows = [
      ['Semana', `Semana ${checkin.context.weekNumber ?? '—'}`],
      [
        'Enviado em',
        typeof checkin.context.completedAt === 'string'
          ? formatDateTime(checkin.context.completedAt)
          : 'Não informado',
      ],
    ];
    try {
      const responses = JSON.parse(String(checkin.context.responses ?? '{}')) as Record<
        string,
        unknown
      >;
      for (const [key, value] of Object.entries(responses)) {
        if (value === null || typeof value === 'object') continue;
        rows.push([key.replace(/([a-z])([A-Z])/g, '$1 $2'), String(value)]);
      }
    } catch {
      // Respostas ilegíveis não derrubam a tela: ficam só semana e data.
    }
  }
  if (rows.length === 0) return null;
  return (
    <Section id="alert-context-title" title="Contexto da origem">
      <dl className="grid gap-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-secondary p-3">
            <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-label">{value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function ResolutionSection({
  detail,
  id,
  onResolved,
}: {
  detail: QueueDetail;
  id: string;
  onResolved: () => void;
}) {
  const [reason, setReason] = useState('');
  const [otherReason, setOtherReason] = useState('');
  const [notes, setNotes] = useState('');
  const handoff = detail.handoff;
  const safety = handoff?.level === 'SAFETY';

  if (handoff?.status === 'RESOLVED') {
    return (
      <Section id="alert-resolution-title" title="Resolução">
        <p className="flex items-center gap-2 text-label font-medium">
          <CheckCircle2 aria-hidden="true" className="size-4 text-verde-pulso" />
          Resolvido em {formatDateTime(handoff.updatedAt)}.
        </p>
        <p className="mt-2 text-label text-muted-foreground">
          O registro da resolução está na trilha de auditoria.
        </p>
      </Section>
    );
  }

  const resolution = reason === OTHER_REASON ? otherReason.trim() : reason;
  const invalid = resolution.length < 3 || notes.trim().length < 3;

  async function resolve() {
    try {
      await resolveHandoff(id, resolution, notes.trim());
    } catch {
      // As anotações ficam no formulário; o diálogo de confirmação mostra a mensagem.
      throw new Error(
        'Não foi possível registrar a resolução. Suas anotações foram mantidas; tente novamente.',
      );
    }
    captureDashboardEvent('cref_handoff_resolved', { kind: 'HANDOFF' });
    onResolved();
  }

  return (
    <Section id="alert-resolution-title" title="Registrar resolução">
      <p className="text-label text-muted-foreground">
        Registre como o caso foi conduzido. O registro entra na trilha de auditoria.
      </p>
      <fieldset className="mt-4">
        <legend className="text-label font-semibold">Motivo</legend>
        <div className="mt-2 space-y-1">
          {[...RESOLUTION_REASONS, OTHER_REASON].map((option) => (
            <label
              key={option}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-label hover:bg-accent"
            >
              <input
                type="radio"
                name="alert-resolution-reason"
                value={option}
                checked={reason === option}
                onChange={() => setReason(option)}
                className="size-4 accent-[var(--primary)]"
              />
              {option}
            </label>
          ))}
        </div>
        {reason === OTHER_REASON ? (
          <label className="mt-2 flex flex-col gap-2 text-label font-semibold">
            Descreva o motivo
            <input
              className={fieldClass}
              value={otherReason}
              maxLength={80}
              onChange={(event) => setOtherReason(event.target.value)}
            />
          </label>
        ) : null}
      </fieldset>
      <label className="mt-4 flex flex-col gap-2 text-label font-semibold">
        Observações
        <textarea
          className={`${fieldClass} min-h-24 py-2 font-normal`}
          value={notes}
          maxLength={1000}
          aria-describedby="alert-notes-help"
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      <p id="alert-notes-help" className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>Descreva a orientação dada ou o encaminhamento.</span>
        <span>{notes.length}/1000</span>
      </p>
      <div className="mt-4">
        <ConfirmAction
          triggerLabel="Marcar como resolvido"
          title="Confirmar resolução do alerta?"
          description="O alerta sai dos pendentes para todos os profissionais e a resolução fica registrada na trilha de auditoria."
          confirmLabel="Confirmar resolução"
          destructive={safety}
          disabled={invalid}
          onConfirm={resolve}
        />
        {invalid ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {resolution.length < 3
              ? 'Escolha um motivo.'
              : 'Escreva ao menos 3 caracteres nas observações.'}
          </p>
        ) : null}
      </div>
    </Section>
  );
}

/**
 * Tela do ALERTA do AI Coach (escalonamento para supervisão do CREF). Não é o detalhe da Fila
 * do Profissional: aqui o profissional entende o que gerou o caso, conduz com o aluno e
 * registra a resolução. Abrir a tela grava a leitura; ler não resolve.
 */
export function AlertDetail({ id }: { id: string }) {
  const [detail, setDetail] = useState<QueueDetail | null>(null);
  const [checkin, setCheckin] = useState<QueueDetail | null>(null);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [resolved, setResolved] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      try {
        const loaded = await getQueueDetail('HANDOFF', id, signal);
        setDetail(loaded);
        if (loaded.handoff?.sourceType === 'CHECKIN') {
          setCheckin(await getQueueDetail('CHECKIN', id, signal).catch(() => null));
        }
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError({
          message: caught instanceof Error ? caught.message : 'Não foi possível carregar o alerta.',
          notFound: caught instanceof DashboardApiError && caught.status === 404,
        });
      }
    },
    [id],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useMarkNotificationRead('alert', id, Boolean(detail));

  const back = (
    <Link
      href={RETURN_HREF}
      className="inline-flex min-h-11 items-center gap-2 text-label font-medium underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
    >
      <ArrowLeft aria-hidden="true" className="size-4" /> Voltar para alertas
    </Link>
  );

  if (!detail && !error) {
    return (
      <div role="status" aria-label="Carregando alerta" className="space-y-4">
        <div className="h-40 animate-pulse rounded-xl border border-border bg-card" />
        <div className="h-32 animate-pulse rounded-xl border border-border bg-card" />
        <div className="h-32 animate-pulse rounded-xl border border-border bg-card" />
      </div>
    );
  }
  if (!detail && error) {
    return (
      <section role="alert" className="rounded-xl border border-coral bg-card p-6">
        <h1 className="text-h2 font-bold">
          {error.notFound ? 'Alerta não encontrado' : 'O alerta não carregou'}
        </h1>
        <p className="mt-2 text-body text-muted-foreground">
          {error.notFound
            ? 'O link pode estar incorreto ou o alerta não está disponível para sua conta.'
            : error.message}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {error.notFound ? null : (
            <Button onClick={() => void load()}>
              <RefreshCw aria-hidden="true" /> Tentar novamente
            </Button>
          )}
          {back}
        </div>
      </section>
    );
  }
  if (!detail) return null;

  const handoff = detail.handoff;
  const level = handoff?.level === 'SAFETY' ? 'SAFETY' : 'ALERT';
  const safety = level === 'SAFETY';
  const status = resolved ? 'RESOLVED' : (handoff?.status ?? 'OPEN');
  const sourceType = handoff?.sourceType ?? null;
  const copy = alertCopyFor({
    level,
    reason: handoff?.reason ?? '',
    studentName: handoff?.studentName,
  });
  const LevelIcon = safety ? ShieldAlert : AlertTriangle;
  const studentId = handoff?.studentId;
  const conversation = detail.replay;
  const effective: QueueDetail = resolved
    ? {
        ...detail,
        handoff: {
          ...(handoff as NonNullable<QueueDetail['handoff']>),
          status,
          updatedAt: new Date().toISOString(),
        },
      }
    : detail;

  return (
    <article className="space-y-5">
      {back}
      <header
        className={cn(
          'rounded-xl border bg-card p-4 sm:p-6',
          safety && 'border-l-4 border-l-coral',
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={safety ? 'attention' : 'neutral'} variant="solid">
            <LevelIcon aria-hidden="true" className="mr-1 size-3.5" />
            {ALERT_LEVEL_LABEL[level]}
          </StatusBadge>
          <StatusBadge tone={status === 'RESOLVED' ? 'quiet' : 'attention'} variant="solid">
            {status === 'RESOLVED' ? (
              <CheckCircle2 aria-hidden="true" className="mr-1 size-3.5" />
            ) : null}
            {status === 'RESOLVED' ? 'Resolvido' : 'Pendente'}
          </StatusBadge>
        </div>
        <h1 className="mt-3 text-h1 font-bold">{copy.title}</h1>
        <p className="mt-2 max-w-3xl text-body text-muted-foreground">{copy.detail}</p>
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-label">
          <div className="flex gap-1.5">
            <dt className="font-semibold">Aluno:</dt>
            <dd>{handoff?.studentName ?? 'Aluno não identificado'}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="font-semibold">Origem:</dt>
            <dd>{alertSourceLabel(sourceType) ?? 'Conversa'}</dd>
          </div>
          {handoff?.createdAt ? (
            <div className="flex gap-1.5">
              <dt className="font-semibold">Recebido:</dt>
              <dd>
                {formatDateTime(handoff.createdAt)} ({elapsed(handoff.createdAt).toLowerCase()})
              </dd>
            </div>
          ) : null}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Encaminhado pelo AI Coach para supervisão. A condução do caso é do profissional CREF.
        </p>
        {safety ? (
          <p role="note" className="mt-3 text-label font-semibold">
            Prioridade de segurança: fale com o aluno antes de qualquer nova orientação de treino.
          </p>
        ) : null}
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <div className="space-y-5">
          <OriginSection detail={effective} />
          <SourceContext detail={effective} checkin={checkin} />
          {conversation ? (
            <details
              open={isConversationSource(sourceType)}
              className="rounded-xl border border-border bg-card p-4 sm:p-5"
            >
              <summary className="cursor-pointer text-label font-semibold">
                Ver conversa recente ({conversation.messages.length} mensagens)
              </summary>
              <div className="mt-4">
                {conversation.messages.length === 0 ? (
                  <p className="text-label text-muted-foreground">
                    Nenhuma mensagem recente com este aluno.
                  </p>
                ) : (
                  <ConversationReplay replay={conversation} />
                )}
              </div>
            </details>
          ) : null}
        </div>
        <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
          <Section id="alert-student-title" title="Aluno">
            {studentId ? (
              <div className="flex flex-col gap-2">
                <Button asChild>
                  <Link href={`/dashboard/conversas?aluno=${encodeURIComponent(studentId)}`}>
                    <MessageSquare aria-hidden="true" /> Abrir conversa com o aluno
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href={`/dashboard/alunos/${encodeURIComponent(studentId)}`}>
                    <UserRound aria-hidden="true" /> Ver perfil do aluno
                  </Link>
                </Button>
              </div>
            ) : (
              <p className="text-label text-muted-foreground">
                Aluno não identificado neste alerta.
              </p>
            )}
          </Section>
          <ResolutionSection detail={effective} id={id} onResolved={() => setResolved(true)} />
          {resolved ? (
            <p role="status" className="text-label font-medium">
              Alerta resolvido e registrado na auditoria.
            </p>
          ) : null}
        </aside>
      </div>
    </article>
  );
}
