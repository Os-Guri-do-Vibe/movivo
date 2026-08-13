'use client';

import { ArrowLeft, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useCallback } from 'react';

import { getStudent } from '@/lib/control-center-api';

import {
  DataQuality,
  ResourceState,
  SectorHeader,
  useControlCenterResource,
} from './control-center-ui';
import { ChurnRiskSignals } from './students-dashboard';

/** Rótulo obrigatório da US-7.4 (TASK-7.4.3): adesão é declaração, não execução. */
const DECLARED_LABEL =
  'Declarado via check-in: mede a resposta do aluno ao check-in, não a execução do treino. Treino concluído verificado depende de workout_completions (Sprint 8).';

const TIMELINE_LABELS: Record<string, string> = {
  ANAMNESIS: 'Anamnese',
  PROTOCOL: 'Protocolo',
  CHECKIN: 'Check-in',
  CONVERSATION: 'Conversa',
  SUBSCRIPTION: 'Assinatura',
  HANDOFF: 'Atendimento humano',
};

function text(value: string | null): string {
  return value?.trim() || 'Não informado';
}

function percent(value: number | null): string {
  return value === null ? 'Sem amostra' : `${value.toFixed(1)}%`;
}

function date(value: string | null): string {
  if (!value) return 'Não assinado';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

function DetailList({ items }: { items: Array<[string, string | number]> }) {
  return (
    <dl className="mt-4 grid gap-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg bg-secondary p-3">
          <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
          <dd className="mt-1 text-label">{value}</dd>
        </div>
      ))}
    </dl>
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
  return (
    <article>
      <Link
        href="/dashboard/alunos"
        className="mb-5 inline-flex min-h-11 items-center gap-2 text-label font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" /> Voltar aos alunos
      </Link>
      <SectorHeader
        title={text(student.name)}
        description="Visão 360 do cadastro, rotina e acompanhamento técnico dentro do escopo autorizado."
        meta={data.meta}
        refreshing={loading}
        onRefresh={() => void refresh()}
      />

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

      <div className="mt-6 grid gap-5 xl:grid-cols-2">
        <section
          className="rounded-xl border border-border bg-card p-5"
          aria-labelledby="student-registration"
        >
          <h2 id="student-registration" className="text-h2 font-bold">
            Cadastro e plano
          </h2>
          <DetailList
            items={[
              ['E-mail', text(student.email)],
              ['Telefone', student.phoneNumber],
              ['Cadastro', student.status],
              ['Assinatura', text(student.subscriptionStatus)],
              ['Protocolo', text(student.protocolStatus)],
            ]}
          />
        </section>

        <section
          className="rounded-xl border border-border bg-card p-5"
          aria-labelledby="student-health-flow"
        >
          <h2 id="student-health-flow" className="text-h2 font-bold">
            Formulários e segurança
          </h2>
          {student.health ? (
            <p className="mt-2 text-label text-muted-foreground">
              Informações de saúde decifradas para este acesso e registradas na trilha de auditoria.
            </p>
          ) : (
            <p className="mt-2 text-label text-muted-foreground">
              Seu acesso não inclui informações de saúde: o servidor não envia PAR-Q, relato de dor
              nem evolução declarada nesta ficha.
            </p>
          )}
          <DetailList
            items={[
              ['Anamnese', text(student.anamnesisStatus)],
              ...(student.health
                ? ([['PAR-Q', text(student.health.parqState)]] as Array<[string, string]>)
                : []),
              ['Revisão CREF', student.requiresProfessionalReview ? 'Necessária' : 'Sem pendência'],
            ]}
          />
        </section>

        <section
          className="rounded-xl border border-border bg-card p-5"
          aria-labelledby="student-routine"
        >
          <h2 id="student-routine" className="text-h2 font-bold">
            Rotina informada
          </h2>
          {student.routine ? (
            <DetailList
              items={[
                ['Objetivo', text(student.routine.primaryGoal)],
                ['Situação atual', text(student.routine.trainingStatus)],
                ['Experiência', text(student.routine.experience)],
                ['Dias por semana', student.routine.daysPerWeek ?? 'Não informado'],
                ['Dias preferidos', student.routine.preferredDays.join(', ') || 'Não informado'],
                ['Duração', text(student.routine.sessionDuration)],
                ['Local', text(student.routine.location)],
                ['Período', text(student.routine.preferredPeriod)],
              ]}
            />
          ) : (
            <p className="mt-3 text-label text-muted-foreground">Rotina ainda não preenchida.</p>
          )}
        </section>

        <section
          className="rounded-xl border border-border bg-card p-5"
          aria-labelledby="student-protocol"
        >
          <h2 id="student-protocol" className="text-h2 font-bold">
            Treino vigente
          </h2>
          {student.currentProtocol ? (
            <DetailList
              items={[
                ['Versão', student.currentProtocol.version],
                [
                  'Vigência',
                  `Semana ${student.currentProtocol.currentWeek} de ${student.currentProtocol.totalWeeks}`,
                ],
                ['Assinatura CREF', date(student.currentProtocol.signedAt)],
              ]}
            />
          ) : (
            <p className="mt-3 text-label text-muted-foreground">Nenhum protocolo vigente.</p>
          )}
        </section>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <section
          className="rounded-xl border border-border bg-card p-5"
          aria-labelledby="student-adherence"
        >
          <h2 id="student-adherence" className="text-h2 font-bold">
            Adesão declarada
          </h2>
          <p className="mt-2 text-label text-muted-foreground">{DECLARED_LABEL}</p>
          <DetailList
            items={[
              ['Check-ins enviados', student.adherence.checkinsSent],
              ['Check-ins respondidos', student.adherence.checkinsResponded],
              ['Taxa de resposta', percent(student.adherence.responseRate.value)],
            ]}
          />
          {student.health && student.health.evolution.length > 0 ? (
            <>
              <h3 className="mt-5 text-h3 font-semibold">Evolução declarada por semana</h3>
              <ul className="mt-3 space-y-2">
                {student.health.evolution.map((point) => (
                  <li key={point.week} className="rounded-lg bg-secondary p-3 text-label">
                    <span className="font-semibold">Semana {point.week}</span>{' '}
                    <span className="text-muted-foreground">
                      esforço percebido {text(point.fatigue)} · treinos declarados{' '}
                      {text(point.workouts)} · ajuste {text(point.adjustment)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {student.health && student.health.painReports.length > 0 ? (
            <>
              <h3 className="mt-5 text-h3 font-semibold">Relatos de desconforto</h3>
              <ul className="mt-3 space-y-2">
                {student.health.painReports.map((report) => (
                  <li key={report.at} className="rounded-lg bg-secondary p-3 text-label">
                    <span className="font-semibold">Semana {report.week}</span>{' '}
                    <span className="text-muted-foreground">{report.text}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <section
          className="rounded-xl border border-border bg-card p-5"
          aria-labelledby="student-ai-quality"
        >
          <h2 id="student-ai-quality" className="text-h2 font-bold">
            Qualidade das respostas da IA
          </h2>
          <p className="mt-2 text-label text-muted-foreground">
            {student.aiQuality.blockedRate.definition}
          </p>
          <DetailList
            items={[
              ['Respostas bloqueadas', student.aiQuality.blocked],
              ['Respostas validadas', student.aiQuality.validated],
              ['Taxa de bloqueio', percent(student.aiQuality.blockedRate.value)],
            ]}
          />
          {student.aiQuality.occurrences.length > 0 ? (
            <>
              <h3 className="mt-5 text-h3 font-semibold">Ocorrências anonimizadas</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Identificadores diretos foram removidos no backend antes da exibição.
              </p>
              <ul className="mt-3 space-y-2">
                {student.aiQuality.occurrences.map((occurrence) => (
                  <li key={occurrence.at} className="rounded-lg bg-secondary p-3 text-label">
                    <time dateTime={occurrence.at} className="font-mono text-xs">
                      {date(occurrence.at)}
                    </time>
                    <p className="mt-1 whitespace-pre-wrap">{occurrence.content}</p>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      </div>

      <section
        className="mt-5 rounded-xl border border-border bg-card p-5"
        aria-labelledby="student-risk"
      >
        <h2 id="student-risk" className="text-h2 font-bold">
          Risco de cancelamento
        </h2>
        <p className="mt-2 text-label text-muted-foreground">
          Leitura comercial de retenção, somando sinais nomeados. Não descreve a condição física da
          pessoa.
        </p>
        <ChurnRiskSignals risk={student.churnRisk} />
      </section>

      <section
        className="mt-5 rounded-xl border border-border bg-card p-5"
        aria-labelledby="student-timeline"
      >
        <h2 id="student-timeline" className="text-h2 font-bold">
          Linha do tempo do aluno
        </h2>
        <p className="mt-2 text-label text-muted-foreground">
          Anamnese, protocolo e versões, check-ins, conversas, assinatura e atendimentos humanos num
          único fluxo, do mais recente para o mais antigo.
        </p>
        {student.timeline.length === 0 ? (
          <p className="mt-4 text-label text-muted-foreground">
            Nenhum evento registrado neste período.
          </p>
        ) : (
          <ol className="mt-4 space-y-3">
            {student.timeline.map((event, index) => (
              <li
                key={`${event.at}-${index}`}
                className="rounded-lg border border-border bg-secondary p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-label font-semibold">{event.title}</span>
                  <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                    {TIMELINE_LABELS[event.kind]}
                    <time dateTime={event.at}>{date(event.at)}</time>
                  </span>
                </div>
                {event.detail ? (
                  <p className="mt-1 text-label text-muted-foreground">{event.detail}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section
        className="mt-5 rounded-xl border border-dashed border-border bg-card p-5"
        aria-labelledby="workout-history"
      >
        <h2 id="workout-history" className="text-h2 font-bold">
          Histórico de treinos
        </h2>
        <p className="mt-2 text-label text-muted-foreground">{student.workoutHistory.reason}</p>
        <span className="mt-3 inline-flex rounded-full border border-border px-2 py-1 text-xs font-semibold text-muted-foreground">
          Indisponível
        </span>
      </section>
      <DataQuality notes={data.meta.dataQuality} />
    </article>
  );
}
