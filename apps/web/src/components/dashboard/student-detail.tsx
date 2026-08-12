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

function text(value: string | null): string {
  return value?.trim() || 'Não informado';
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
          <p className="mt-2 text-label text-muted-foreground">
            O painel mostra o estado dos formulários; o conteúdo sensível permanece restrito ao
            fluxo técnico auditado.
          </p>
          <DetailList
            items={[
              ['Anamnese', text(student.anamnesisStatus)],
              ['PAR-Q', text(student.parqState)],
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
