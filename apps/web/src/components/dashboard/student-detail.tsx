'use client';

/**
 * Ficha do aluno: quem é, plano e estratégia, adesão (verificada e declarada), decisões,
 * casos da fila, saúde (só para quem pode) e a linha do tempo. Uma coluna, um container por
 * assunto; dado ausente é sempre "Não informado" para a equipe saber que o campo existe.
 */
import type { ControlCenterMetric, ControlCenterTimelineEvent } from '@movivo/shared';
import { ArrowLeft, ClipboardCheck, Dumbbell, History, ShieldAlert, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useCallback } from 'react';
import type { ReactNode } from 'react';

import { getStudent } from '@/lib/control-center-api';
import { goalLabel, KIND_LABEL, PRIORITY_LABEL } from '@/lib/exception-copy';
import { formatPhone } from '@/lib/phone-mask';

import { StatusBadge } from './control-center-table';
import {
  DataQuality,
  ResourceState,
  SectorHeader,
  useControlCenterResource,
} from './control-center-ui';
import {
  executionStatusLabel,
  modalityLabel,
  parqStatus,
  planLabel,
  planStatus,
  registrationStatus,
  subscriptionStatus,
} from './student-labels';
import { describeTimelineEvent } from './student-timeline';

const NOT_INFORMED = 'Não informado';

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});
const dateOnly = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

function Section({
  title,
  hint,
  icon: Icon,
  children,
}: {
  title: string;
  hint?: string;
  icon: typeof UserRound;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-6" aria-label={title}>
      <h2 className="flex items-center gap-2 text-h3 font-bold">
        <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
        {title}
      </h2>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-2 last:border-b-0 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-label sm:text-right">{children}</dd>
    </div>
  );
}

function metricText(metric: ControlCenterMetric): string {
  return metric.value === null
    ? NOT_INFORMED
    : `${metric.value}${metric.unit === 'PERCENT' ? '%' : ''}`;
}

export function StudentDetail({ id: studentId }: { id: string }) {
  const load = useCallback((signal?: AbortSignal) => getStudent(studentId, signal), [studentId]);
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
  const registration = registrationStatus(student.status);
  const subscription = subscriptionStatus(student.subscriptionStatus);
  const plan = planStatus(student.planStatus);
  const goal = goalLabel(student.plan.goal);

  return (
    <article className="space-y-5">
      <Link
        href="/dashboard/alunos"
        className="inline-flex items-center gap-1.5 text-label text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Voltar para a base de alunos
      </Link>
      <SectorHeader
        title={student.name ?? 'Aluno sem nome'}
        icon={UserRound}
        meta={data.meta}
        refreshing={loading}
        onRefresh={() => void refresh()}
      />

      <Section title="Quem é" icon={UserRound}>
        <dl>
          <Row label="Telefone">{formatPhone(student.phoneNumber)}</Row>
          <Row label="E-mail">{student.email ?? NOT_INFORMED}</Row>
          <Row label="Cadastro">
            {registration ? (
              <StatusBadge tone={registration.tone}>{registration.label}</StatusBadge>
            ) : (
              NOT_INFORMED
            )}
          </Row>
          <Row label="Assinatura">
            {subscription ? (
              <StatusBadge tone={subscription.tone}>
                {subscription.label}
                {student.subscriptionPlan ? ` · ${planLabel(student.subscriptionPlan)}` : ''}
              </StatusBadge>
            ) : (
              NOT_INFORMED
            )}
          </Row>
          <Row label="Matrícula concluída em">
            {student.enrolledAt ? dateOnly.format(new Date(student.enrolledAt)) : NOT_INFORMED}
          </Row>
          <Row label="Risco de cancelamento">
            {student.churnRisk.score === 0
              ? 'Nenhum sinal'
              : student.churnRisk.signals.map((signal) => signal.label).join(' · ')}
          </Row>
        </dl>
      </Section>

      <Section
        title="Plano e estratégia"
        hint="O que está vigente hoje para este aluno."
        icon={Dumbbell}
      >
        <dl>
          <Row label="Objetivo declarado">{goal ?? NOT_INFORMED}</Row>
          <Row label="Estratégia">{student.plan.strategy ?? 'Ainda não definida'}</Row>
          <Row label="Plano de treino">
            {student.plan.training ? (
              <>
                v{student.plan.training.version}
                {plan ? (
                  <>
                    {' '}
                    · <StatusBadge tone={plan.tone}>{plan.label}</StatusBadge>
                  </>
                ) : null}
              </>
            ) : (
              'Sem plano publicado'
            )}
          </Row>
          <Row label="Plano alimentar">
            {student.plan.nutrition ? `v${student.plan.nutrition.version}` : 'Sem plano publicado'}
          </Row>
        </dl>
      </Section>

      <Section
        title="Adesão"
        hint="Verificada: sessões concluídas sobre as agendadas. Declarada: check-ins respondidos."
        icon={ClipboardCheck}
      >
        <dl>
          <Row label={`Sessões (${student.adherence.windowDays} dias)`}>
            {student.adherence.planned === 0
              ? 'Nenhuma sessão agendada'
              : `${student.adherence.done} de ${student.adherence.planned} · ${metricText(student.adherence.rate)}`}
          </Row>
          <Row label="Check-ins respondidos">
            {student.checkins.sent === 0
              ? 'Nenhum enviado'
              : `${student.checkins.answered} de ${student.checkins.sent} · ${metricText(student.checkins.responseRate)}`}
          </Row>
          <Row label="Respostas retidas pela validação">
            {student.aiQuality.validated === 0
              ? 'Sem respostas validadas'
              : `${student.aiQuality.blocked} de ${student.aiQuality.validated}`}
          </Row>
        </dl>
        {student.executions.length > 0 ? (
          <ul className="mt-3 space-y-1 text-xs">
            {student.executions.map((execution) => (
              <li key={execution.id} className="flex flex-wrap gap-x-3 text-muted-foreground">
                <span className="text-foreground">
                  {dateOnly.format(new Date(`${execution.performedOn}T12:00:00Z`))}
                </span>
                <span>{modalityLabel(execution.modality)}</span>
                <span>{executionStatusLabel(execution.status)}</span>
                {execution.rpe !== null ? <span>esforço {execution.rpe}</span> : null}
                {execution.durationMinutes !== null ? (
                  <span>{execution.durationMinutes} min</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      {student.health ? (
        <Section
          title="Saúde"
          hint="Dado sensível: cada leitura fica registrada na auditoria."
          icon={ShieldAlert}
        >
          <dl>
            <Row label="PAR-Q">
              {parqStatus(student.health.parqState) ? (
                <StatusBadge tone={parqStatus(student.health.parqState)?.tone ?? 'neutral'}>
                  {parqStatus(student.health.parqState)?.label}
                </StatusBadge>
              ) : (
                NOT_INFORMED
              )}
            </Row>
            <Row label="Dor relatada nos treinos">
              {student.health.painReports.length === 0
                ? 'Nenhuma'
                : student.health.painReports.map((pain) => pain.text).join(' · ')}
            </Row>
          </dl>
          <h3 className="mt-4 text-label font-semibold">Fila de exceções</h3>
          {student.exceptions.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">Nenhum caso aberto.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {student.exceptions.map((item) => (
                <li key={item.id} className="rounded-lg border border-border p-3 text-xs">
                  <Link href={`/dashboard/fila/${item.id}`} className="font-medium underline">
                    {KIND_LABEL[item.kind as keyof typeof KIND_LABEL] ?? item.kind}
                  </Link>
                  <span className="text-muted-foreground">
                    {' · '}
                    {PRIORITY_LABEL[item.priority as keyof typeof PRIORITY_LABEL] ?? item.priority}
                    {' · '}
                    {item.summary}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <h3 className="mt-4 text-label font-semibold">Últimas decisões</h3>
          {student.decisions.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">Nenhuma decisão registrada.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-xs">
              {student.decisions.map((decision) => (
                <li
                  key={`${decision.action}-${decision.createdAt}`}
                  className="text-muted-foreground"
                >
                  <span className="text-foreground">{decision.action}</span>
                  {' · '}
                  {decision.verdict ?? 'sem decisão'}
                  {decision.decidedBy === 'STAFF'
                    ? ' pelo profissional'
                    : decision.verdict
                      ? ' pelas políticas'
                      : ''}
                  {' · '}
                  {dateTime.format(new Date(decision.createdAt))}
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      <Section title="Histórico" hint="Do mais recente para o mais antigo." icon={History}>
        {student.timeline.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem eventos no período.</p>
        ) : (
          <ol className="space-y-2">
            {student.timeline.map((event: ControlCenterTimelineEvent) => {
              const { title, detail } = describeTimelineEvent(event);
              return (
                <li key={`${event.at}-${event.code}`} className="border-l-2 border-border pl-3">
                  <p className="text-label">{title}</p>
                  <p className="text-xs text-muted-foreground">
                    {dateTime.format(new Date(event.at))}
                    {detail ? ` · ${detail}` : ''}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      <DataQuality notes={data.meta.dataQuality} />
    </article>
  );
}
