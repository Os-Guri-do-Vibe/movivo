'use client';

import type { ControlCenterTimelineEvent } from '@movivo/shared';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bot,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Dumbbell,
  History,
  ShieldAlert,
  TrendingDown,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';

import { getStudent } from '@/lib/control-center-api';
import { cn } from '@/lib/utils';

import { FOCUS_RING, StatusBadge } from './control-center-table';
import {
  DataQuality,
  ResourceState,
  SectorHeader,
  useControlCenterResource,
} from './control-center-ui';
import { formatPhone } from './protocol-anamnesis-answers';
import {
  anamnesisStatus,
  durationFitLabel,
  durationLabel,
  experienceLabel,
  goalLabel,
  locationLabel,
  moodLabel,
  parqStatus,
  periodLabel,
  planLabel,
  protocolStatus,
  registrationStatus,
  sleepLabel,
  subscriptionStatus,
  trainingStatusLabel,
  weekdaysLabel,
} from './student-labels';
import type { Labelled } from './student-labels';
import { describeTimelineEvent } from './student-timeline';

/**
 * Ficha do aluno — padrão de UX/UI (spec de Sofia, 2026-10-11).
 *
 *  1. Uma coluna, um container por assunto, na ordem em que a equipe decide: quem é →
 *     plano → treino → rotina → saúde → adesão → IA → risco → histórico.
 *  2. Cada container: ícone discreto + título + uma frase de apoio; corpo em lista
 *     rótulo/valor com divisória fina (nada de bloco cinza dentro de card).
 *  3. Nunca o código do banco: status vira palavra em PT-BR (`student-labels.ts`) e a
 *     COR só reforça o texto (WCAG 1.4.1). Coral só em alerta real: PAR-Q bloqueado e
 *     cobrança em atraso.
 *  4. Dado ausente é sempre "Não informado" — a linha não some, para a equipe saber
 *     que o campo existe e está vazio.
 *  5. Números em destaque com rótulo pequeno; datas em pt-BR, fuso de São Paulo.
 *  6. Mobile: rótulo acima do valor; alvos de toque de 44px; um `h2` por container.
 */

/** Rótulo obrigatório da US-7.4 (TASK-7.4.3): adesão é declaração, não execução. */
const DECLARED_LABEL =
  'Declarado via check-in: mede a resposta do aluno ao check-in, não a execução do treino. Treino concluído verificado é medido à parte, na North Star (workout_completions).';

const TIMELINE_LABELS: Record<string, string> = {
  ANAMNESIS: 'Anamnese',
  PROTOCOL: 'Protocolo',
  CHECKIN: 'Check-in',
  CONVERSATION: 'Conversa',
  SUBSCRIPTION: 'Assinatura',
  HANDOFF: 'Atendimento humano',
};

/** Acima disso a linha do tempo recolhe: 90 dias de conversa diária empurrariam a página. */
const TIMELINE_PREVIEW = 8;

const NOT_INFORMED = 'Não informado';

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

function day(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

function percent(value: number | null): string {
  if (value === null) return 'Sem amostra';
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)}%`;
}

function Empty({ children = NOT_INFORMED }: { children?: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

/** Texto simples; vazio vira "Não informado". */
function plain(value: string | number | null | undefined): ReactNode {
  if (value === null || value === undefined) return <Empty />;
  const text = String(value).trim();
  return text ? text : <Empty />;
}

function Status({ status }: { status: Labelled | null }): ReactNode {
  if (!status) return <Empty />;
  return <StatusBadge tone={status.tone}>{status.label}</StatusBadge>;
}

/**
 * Container de categoria. O título é o `h2` da região; a frase de apoio fica fora do
 * corpo para que a lista de dados comece sempre na mesma altura entre containers.
 */
function Category({
  id,
  icon: Icon,
  title,
  description,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <header className="flex items-start gap-3 px-5 pt-5 pb-4 sm:px-6">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground"
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 id={id} className="text-h3 leading-tight font-semibold">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-label text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </header>
      <div className="border-t border-border px-5 py-1 sm:px-6">{children}</div>
    </section>
  );
}

/** Lista rótulo/valor: `dl` semântico, divisória fina, rótulo acima do valor no mobile. */
function Rows({ items }: { items: ReadonlyArray<readonly [string, ReactNode]> }) {
  return (
    <dl className="divide-y divide-border">
      {items.map(([label, value]) => (
        <div
          key={label}
          className="grid gap-0.5 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-center sm:gap-4"
        >
          <dt className="text-label text-muted-foreground">{label}</dt>
          <dd className="min-w-0 text-label font-medium break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Stats({ items }: { items: ReadonlyArray<readonly [string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-3 gap-4 py-4">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dd className="text-h2 leading-none font-semibold tabular-nums">{value}</dd>
          <dt className="mt-1.5 text-xs text-muted-foreground">{label}</dt>
        </div>
      ))}
    </dl>
  );
}

/** Bloco secundário dentro de um container (evolução, relatos, ocorrências). */
function SubSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-border py-4">
      <h3 className="text-label font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="pb-4 text-xs text-muted-foreground">{children}</p>;
}

function Timeline({ events }: { events: ReadonlyArray<ControlCenterTimelineEvent> }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? events : events.slice(0, TIMELINE_PREVIEW);
  const hidden = events.length - visible.length;

  if (events.length === 0) {
    return <p className="py-4 text-label text-muted-foreground">Nenhum evento neste período.</p>;
  }
  return (
    <>
      <ol className="divide-y divide-border">
        {visible.map((event, index) => {
          const { title, detail } = describeTimelineEvent(event);
          return (
            <li
              key={`${event.at}-${index}`}
              className="grid gap-1 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4"
            >
              <div>
                <p className="text-xs font-semibold text-muted-foreground">
                  {TIMELINE_LABELS[event.kind] ?? event.kind}
                </p>
                <time dateTime={event.at} className="font-mono text-xs text-muted-foreground">
                  {dateTime(event.at)}
                </time>
              </div>
              <div className="min-w-0">
                <p className="text-label font-medium">{title}</p>
                {detail ? (
                  <p className="mt-0.5 text-label text-muted-foreground">{detail}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {events.length > TIMELINE_PREVIEW ? (
        <div className="border-t border-border py-2">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
            className={cn(
              'inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-label font-semibold hover:bg-secondary',
              FOCUS_RING,
            )}
          >
            {expanded ? (
              <ChevronUp aria-hidden="true" className="size-4" />
            ) : (
              <ChevronDown aria-hidden="true" className="size-4" />
            )}
            {expanded ? 'Mostrar menos' : `Mostrar mais ${hidden}`}
          </button>
        </div>
      ) : null}
    </>
  );
}

export function StudentDetail({ id }: { id: string }) {
  const load = useCallback((signal?: AbortSignal) => getStudent(id, signal), [id]);
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

  const { student } = data.data;
  const subscription = subscriptionStatus(student.subscriptionStatus);
  const protocol = protocolStatus(student.protocolStatus);
  const registration = registrationStatus(student.status);

  return (
    <article className="mx-auto max-w-4xl">
      <Link
        href="/dashboard/alunos"
        className={cn(
          'mb-5 inline-flex min-h-11 items-center gap-2 rounded-md text-label font-semibold underline underline-offset-4',
          FOCUS_RING,
        )}
      >
        <ArrowLeft aria-hidden="true" className="size-4" /> Voltar aos alunos
      </Link>
      <SectorHeader
        title={student.name?.trim() || 'Nome não informado'}
        meta={data.meta}
        refreshing={loading}
        onRefresh={() => void refresh()}
      />

      <ul aria-label="Situação do aluno" className="mt-4 flex flex-wrap gap-2">
        {(
          [
            ['Cadastro', registration],
            ['Assinatura', subscription],
            ['Protocolo', protocol],
          ] as const
        ).map(([label, status]) => (
          <li
            key={label}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs"
          >
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium">
              {status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : <Empty />}
            </span>
          </li>
        ))}
      </ul>

      {error ? (
        <p role="alert" className="mt-4 rounded-lg border border-coral bg-card p-3 text-label">
          {error} Os dados abaixo são da última atualização concluída.
        </p>
      ) : null}
      {student.requiresProfessionalReview ? (
        <p className="mt-5 flex items-start gap-2 rounded-lg border border-coral bg-card p-4 text-label">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          Este aluno requer revisão de um profissional CREF antes da continuidade do fluxo.
        </p>
      ) : null}

      <div className="mt-6 space-y-5">
        <Category
          id="student-registration"
          icon={UserRound}
          title="Cadastro e plano"
          description="Contato e dados da inscrição."
        >
          <Rows
            items={[
              ['WhatsApp', formatPhone(student.phoneNumber)],
              ['E-mail', plain(student.email)],
              ['Inscrito em', plain(day(student.enrolledAt))],
              [
                'Plano',
                student.subscriptionStatus === 'TRIALING'
                  ? 'Em teste'
                  : plain(planLabel(student.subscriptionPlan)),
              ],
            ]}
          />
        </Category>

        <Category
          id="student-protocol"
          icon={Dumbbell}
          title="Treino vigente"
          description="Protocolo em uso e assinatura do profissional CREF."
        >
          {student.currentProtocol ? (
            <Rows
              items={[
                ['Situação', <Status status={protocol} />],
                ['Versão', `v${student.currentProtocol.version}`],
                [
                  'Vigência',
                  `Semana ${student.currentProtocol.currentWeek} de ${student.currentProtocol.totalWeeks}`,
                ],
                [
                  'Assinatura CREF',
                  student.currentProtocol.signedAt ? (
                    dateTime(student.currentProtocol.signedAt)
                  ) : (
                    <Empty>Não assinado</Empty>
                  ),
                ],
              ]}
            />
          ) : (
            <p className="py-4 text-label text-muted-foreground">Nenhum protocolo vigente.</p>
          )}
        </Category>

        <Category
          id="student-routine"
          icon={Activity}
          title="Rotina informada"
          description="O que o aluno declarou na anamnese."
        >
          {student.routine ? (
            <Rows
              items={[
                ['Objetivo', plain(goalLabel(student.routine.primaryGoal))],
                ['Situação atual', plain(trainingStatusLabel(student.routine.trainingStatus))],
                ['Experiência', plain(experienceLabel(student.routine.experience))],
                [
                  'Frequência',
                  student.routine.daysPerWeek === null
                    ? plain(null)
                    : `${student.routine.daysPerWeek} ${student.routine.daysPerWeek === 1 ? 'dia' : 'dias'} por semana`,
                ],
                ['Dias preferidos', plain(weekdaysLabel(student.routine.preferredDays))],
                ['Duração', plain(durationLabel(student.routine.sessionDuration))],
                ['Local', plain(locationLabel(student.routine.location))],
                ['Período', plain(periodLabel(student.routine.preferredPeriod))],
              ]}
            />
          ) : (
            <p className="py-4 text-label text-muted-foreground">Rotina ainda não preenchida.</p>
          )}
        </Category>

        <Category
          id="student-health-flow"
          icon={ClipboardCheck}
          title="Formulários e segurança"
          description={
            student.health
              ? 'Informações de saúde decifradas para este acesso e registradas na trilha de auditoria.'
              : 'Seu acesso não inclui informações de saúde: o servidor não envia PAR-Q, relato de dor nem evolução declarada nesta ficha.'
          }
        >
          <Rows
            items={[
              ['Anamnese', <Status status={anamnesisStatus(student.anamnesisStatus)} />],
              ...(student.health
                ? ([['PAR-Q', <Status status={parqStatus(student.health.parqState)} />]] as const)
                : []),
              [
                'Revisão CREF',
                <StatusBadge tone={student.requiresProfessionalReview ? 'attention' : 'positive'}>
                  {student.requiresProfessionalReview ? 'Necessária' : 'Sem pendência'}
                </StatusBadge>,
              ],
            ]}
          />
        </Category>

        <Category
          id="student-adherence"
          icon={TrendingDown}
          title="Adesão declarada"
          description="Respostas do aluno aos check-ins semanais."
        >
          <Stats
            items={[
              ['Check-ins enviados', student.adherence.checkinsSent],
              ['Check-ins respondidos', student.adherence.checkinsResponded],
              ['Taxa de resposta', percent(student.adherence.responseRate.value)],
            ]}
          />
          <Note>{DECLARED_LABEL}</Note>

          {student.health && student.health.evolution.length > 0 ? (
            <SubSection title="Evolução declarada por semana">
              <ul className="mt-3 divide-y divide-border">
                {student.health.evolution.map((point) => (
                  <li key={point.week} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-label font-semibold">Semana {point.week}</p>
                      <time dateTime={point.at} className="font-mono text-xs text-muted-foreground">
                        {dateTime(point.at)}
                      </time>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
                      {(
                        [
                          ['Sono', plain(sleepLabel(point.sleepQuality))],
                          ['Humor', plain(moodLabel(point.mood))],
                          ['Alimentação', plain(point.nutritionScore)],
                          ['Aderência', plain(point.adherenceScore)],
                          ['Duração do treino', plain(durationFitLabel(point.durationFit))],
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label} className="min-w-0">
                          <dt className="text-xs text-muted-foreground">{label}</dt>
                          <dd className="mt-0.5 text-label font-medium">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
            </SubSection>
          ) : null}

          {student.health && student.health.painReports.length > 0 ? (
            <SubSection title="Relatos de desconforto">
              <ul className="mt-3 space-y-3">
                {student.health.painReports.map((report) => (
                  <li key={report.at} className="border-l-2 border-coral pl-3">
                    <p className="text-xs font-semibold text-muted-foreground">
                      Semana {report.week}
                    </p>
                    <p className="mt-0.5 text-label">{report.text}</p>
                  </li>
                ))}
              </ul>
            </SubSection>
          ) : null}
        </Category>

        <Category
          id="student-ai-quality"
          icon={Bot}
          title="Qualidade das respostas da IA"
          description={student.aiQuality.blockedRate.definition}
        >
          <Stats
            items={[
              ['Respostas validadas', student.aiQuality.validated],
              ['Respostas bloqueadas', student.aiQuality.blocked],
              ['Taxa de bloqueio', percent(student.aiQuality.blockedRate.value)],
            ]}
          />
          {student.aiQuality.occurrences.length > 0 ? (
            <SubSection title="Ocorrências">
              <ul className="mt-3 space-y-3">
                {student.aiQuality.occurrences.map((occurrence) => (
                  <li key={occurrence.at} className="rounded-lg bg-secondary p-3">
                    <time
                      dateTime={occurrence.at}
                      className="font-mono text-xs text-muted-foreground"
                    >
                      {dateTime(occurrence.at)}
                    </time>
                    <p className="mt-1 text-label whitespace-pre-wrap">{occurrence.content}</p>
                  </li>
                ))}
              </ul>
            </SubSection>
          ) : null}
        </Category>

        <Category
          id="student-risk"
          icon={AlertTriangle}
          title="Risco de cancelamento"
          description="Leitura comercial de retenção, somando sinais nomeados. Não descreve a condição física da pessoa."
        >
          {student.churnRisk.score === 0 ? (
            <p className="py-4 text-label text-muted-foreground">
              Sem sinal de risco de cancelamento no momento.
            </p>
          ) : (
            <div className="py-4">
              <p className="text-label font-semibold">
                {student.churnRisk.score} de 3 sinais de risco
              </p>
              <ul className="mt-2 space-y-1.5">
                {student.churnRisk.signals.map((signal) => (
                  <li
                    key={signal.code}
                    className="flex items-start gap-2 text-label text-muted-foreground"
                  >
                    <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                    {signal.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Category>

        <Category
          id="student-timeline"
          icon={History}
          title="Linha do tempo do aluno"
          description="Anamnese, protocolo, check-ins, conversas, assinatura e atendimentos humanos num único fluxo, do mais recente para o mais antigo."
        >
          <Timeline events={student.timeline} />
        </Category>

        <Category
          id="workout-history"
          icon={Dumbbell}
          title="Histórico de treinos"
          description={student.workoutHistory.reason}
        >
          <p className="py-4">
            <StatusBadge tone="quiet" variant="solid">
              Indisponível
            </StatusBadge>
          </p>
        </Category>
      </div>
      <DataQuality notes={data.meta.dataQuality} />
    </article>
  );
}
