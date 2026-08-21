'use client';

import {
  EMPHASIS_REGION_LABELS,
  PAIN_REGION_LABELS,
  PARQ_DECLARATIONS,
  PARQ_QUESTION_IDS,
  PARQ_QUESTION_TEXT,
  PRIMARY_GOAL_LABELS,
  TRAINING_LOCATION_LABELS,
} from '@movivo/shared';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import {
  ACTIVITY_ITEMS,
  BARRIER_ITEMS,
  DURATION_ITEMS,
  EXPERIENCE_ITEMS,
  PERIOD_ITEMS,
  STATUS_ITEMS,
  STOPPED_FOR_ITEMS,
  WEEKDAY_ITEMS,
} from '../onboarding/step2-anamnesis';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getAnamnesisAnswers } from '@/lib/dashboard-api';
import type { AnamnesisAnswers } from '@/lib/dashboard-types';

export const BIOLOGICAL_SEX_LABELS: Record<string, string> = {
  MALE: 'Masculino',
  FEMALE: 'Feminino',
};
const DECLARATION_LABELS: Record<string, string> = Object.fromEntries(
  PARQ_DECLARATIONS.map((d) => [d.id, d.label]),
);

function labelFrom(items: { value: string; label: string }[], value: string | undefined): string {
  if (!value) return '—';
  return items.find((item) => item.value === value)?.label ?? value;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

/** `isoDateSchema` (yyyy-mm-dd) → dd/mm/aaaa. Split de string, não `Date` — evita o
 *  fuso deslocar o dia (`new Date('2001-07-18')` é meia-noite UTC = dia anterior no Brasil). */
export function formatBirthDate(value: string): string {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

/** E.164 brasileiro (`+55` + DDD de 2 dígitos + celular de 9 dígitos) → "+55 (11) 91234-5678".
 *  Fora desse formato (outro país, número malformado), devolve o valor original sem inventar. */
export function formatPhone(value: string): string {
  const match = /^\+55(\d{2})(\d{5})(\d{4})$/.exec(value);
  if (!match) return value;
  const [, ddd, first, second] = match;
  return `+55 (${ddd}) ${first}-${second}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 rounded-xl border border-border bg-card p-4 sm:p-6">
      <h2 className="text-h3 font-bold">{title}</h2>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[220px_1fr] sm:items-baseline">
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className="text-body">{value}</dd>
    </div>
  );
}

/**
 * Só o conteúdo (sem fetch, sem link de voltar, sem heading de página) — reusado pela
 * página standalone (`ProtocolAnamnesisAnswers` abaixo) E pelo modal da fila
 * (`AnamnesisAnswersModal`, achado 2026-08-18: olho nas duas caixas da fila abre o mesmo
 * conteúdo num modal, sem navegar pra outra página).
 */
export function AnamnesisAnswersContent({ answers }: { answers: AnamnesisAnswers }) {
  const { personal, routine, health } = answers;

  return (
    <div>
      <Section title="Cadastro pessoal">
        <dl className="space-y-2">
          <Field label="Nome" value={personal.name} />
          <Field label="Data de nascimento" value={formatBirthDate(personal.birthDate)} />
          <Field
            label="Sexo biológico"
            value={BIOLOGICAL_SEX_LABELS[personal.biologicalSex] ?? personal.biologicalSex}
          />
          <Field label="Altura" value={`${personal.heightCm} cm`} />
          <Field label="Peso" value={`${personal.weightKg} kg`} />
          <Field label="WhatsApp" value={formatPhone(personal.phoneNumber)} />
          <Field label="E-mail" value={personal.email ?? '—'} />
        </dl>
      </Section>

      <Section title="Objetivos e rotina">
        <dl className="space-y-2">
          <Field
            label="Objetivo principal"
            value={
              PRIMARY_GOAL_LABELS[routine.primaryGoal as keyof typeof PRIMARY_GOAL_LABELS] ??
              routine.primaryGoal
            }
          />
          {health.freeText?.primaryGoalOther ? (
            <Field label="Objetivo (detalhe)" value={health.freeText.primaryGoalOther} />
          ) : null}
          <Field
            label="Ênfase muscular"
            value={
              routine.emphasis.length
                ? routine.emphasis
                    .map(
                      (region) =>
                        EMPHASIS_REGION_LABELS[region as keyof typeof EMPHASIS_REGION_LABELS] ??
                        region,
                    )
                    .join(', ')
                : 'Sem preferência'
            }
          />
          <Field label="Status de treino" value={labelFrom(STATUS_ITEMS, routine.trainingStatus)} />
          {routine.stoppedFor ? (
            <Field label="Parado há" value={labelFrom(STOPPED_FOR_ITEMS, routine.stoppedFor)} />
          ) : null}
          <Field label="Experiência" value={labelFrom(EXPERIENCE_ITEMS, routine.experience)} />
          <Field
            label="Atividades anteriores"
            value={
              routine.pastActivities.length
                ? routine.pastActivities.map((v) => labelFrom(ACTIVITY_ITEMS, v)).join(', ')
                : '—'
            }
          />
          {health.freeText?.pastActivityOther ? (
            <Field label="Outra atividade" value={health.freeText.pastActivityOther} />
          ) : null}
          <Field
            label="Barreiras de consistência"
            value={
              routine.consistencyBarriers.length
                ? routine.consistencyBarriers.map((v) => labelFrom(BARRIER_ITEMS, v)).join(', ')
                : '—'
            }
          />
          {health.freeText?.consistencyBarrierOther ? (
            <Field label="Outra barreira" value={health.freeText.consistencyBarrierOther} />
          ) : null}
          <Field label="Dias por semana" value={String(routine.daysPerWeek)} />
          <Field
            label="Dias preferidos"
            value={
              routine.preferredDays.length
                ? routine.preferredDays.map((v) => labelFrom(WEEKDAY_ITEMS, v)).join(', ')
                : '—'
            }
          />
          <Field
            label="Duração da sessão"
            value={labelFrom(DURATION_ITEMS, routine.sessionDuration)}
          />
          <Field
            label="Local"
            value={
              TRAINING_LOCATION_LABELS[routine.location as keyof typeof TRAINING_LOCATION_LABELS] ??
              routine.location
            }
          />
          <Field
            label="Período preferido"
            value={labelFrom(PERIOD_ITEMS, routine.preferredPeriod)}
          />
          <Field
            label="Pratica outro esporte"
            value={
              routine.practicesOtherSport
                ? `Sim${routine.otherSportDaysPerWeek ? ` · ${routine.otherSportDaysPerWeek}x/semana` : ''}`
                : 'Não'
            }
          />
          {health.freeText?.otherSportName ? (
            <Field label="Qual esporte" value={health.freeText.otherSportName} />
          ) : null}
          {health.freeText?.avoidedExercise ? (
            <Field label="Exercício a evitar" value={health.freeText.avoidedExercise} />
          ) : null}
        </dl>
      </Section>

      <Section title="PAR-Q — questionário de prontidão">
        {health.parq ? (
          <ol className="space-y-4">
            {PARQ_QUESTION_IDS.map((questionId) => {
              const found = health.parq?.answers.find((a) => a.questionId === questionId);
              return (
                <li key={questionId}>
                  <p className="text-label font-semibold">{PARQ_QUESTION_TEXT[questionId]}</p>
                  <p className="mt-1 text-body">
                    {found ? (found.answer ? 'Sim' : 'Não') : 'Sem resposta'}
                    {found?.detail ? ` — ${found.detail}` : ''}
                  </p>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-body text-muted-foreground">PAR-Q não respondido.</p>
        )}
      </Section>

      <Section title="Dor e limitações">
        {health.pain?.hasPain ? (
          <dl className="space-y-2">
            <Field
              label="Pontos de dor"
              value={health.pain.points
                .map((p) => {
                  const region =
                    PAIN_REGION_LABELS[p.region as keyof typeof PAIN_REGION_LABELS] ?? p.region;
                  return `${region} (${p.intensity}/10)${p.regionOther ? ` — ${p.regionOther}` : ''}`;
                })
                .join(', ')}
            />
            {health.pain.trend ? <Field label="Tendência" value={health.pain.trend} /> : null}
            {health.pain.trigger ? <Field label="Gatilho" value={health.pain.trigger} /> : null}
            <Field
              label="Acompanhamento médico"
              value={health.pain.underMedicalFollowUp ? 'Sim' : 'Não'}
            />
            {health.pain.hasProfessionalExplanation && health.pain.professionalExplanation ? (
              <Field
                label="Explicação de profissional"
                value={health.pain.professionalExplanation}
              />
            ) : null}
            {health.pain.hasAvoidanceRecommendation && health.pain.avoidanceRecommendation ? (
              <Field label="Recomendação de evitação" value={health.pain.avoidanceRecommendation} />
            ) : null}
          </dl>
        ) : (
          <p className="text-body text-muted-foreground">Sem relato de dor.</p>
        )}
      </Section>

      {health.declarations ? (
        <Section title="Declarações aceitas">
          <ul className="list-disc space-y-1 pl-5 text-body">
            {health.declarations.accepted.map((item) => (
              <li key={item}>{DECLARATION_LABELS[item] ?? item}</li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

/**
 * Estado de carregamento/erro comum aos dois pontos de entrada (página e modal).
 * `enabled=false` não busca nada — a fila pode ter várias dezenas de cards, cada um com
 * seu próprio modal montado (fechado); sem essa trava, todos disparariam a busca junto.
 */
function useAnamnesisAnswers(kind: 'PROTOCOL' | 'PARQ', id: string, enabled = true) {
  const [answers, setAnswers] = useState<AnamnesisAnswers | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError('');
      try {
        setAnswers(await getAnamnesisAnswers(kind, id, signal));
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(
          caught instanceof Error ? caught.message : 'Não foi possível carregar a anamnese.',
        );
      }
    },
    [kind, id],
  );

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [enabled, load]);

  return { answers, error, reload: load };
}

/** Página standalone (`/dashboard/fila/protocol/[id]/anamnesis`) — link direto/bookmark. */
export function ProtocolAnamnesisAnswers({ protocolId }: { protocolId: string }) {
  const { answers, error, reload } = useAnamnesisAnswers('PROTOCOL', protocolId);

  if (!answers && !error) {
    return (
      <div
        role="status"
        className="h-72 animate-pulse rounded-xl border border-border bg-card"
        aria-label="Carregando respostas da anamnese"
      />
    );
  }

  if (!answers) {
    return (
      <section role="alert" className="rounded-xl border border-coral bg-card p-6">
        <h1 className="text-h2 font-bold">As respostas não carregaram</h1>
        <p className="mt-2 text-body text-muted-foreground">{error}</p>
        <Button className="mt-4" onClick={() => void reload()}>
          <RefreshCw aria-hidden="true" /> Tentar novamente
        </Button>
      </section>
    );
  }

  return (
    <article>
      <Link
        href={`/dashboard/fila/protocol/${protocolId}`}
        className="inline-flex min-h-11 items-center gap-2 text-label font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" /> Voltar ao protocolo
      </Link>

      <header className="mt-5">
        <h1 className="text-h1 font-bold">Respostas da anamnese</h1>
        <p className="mt-1 text-label text-muted-foreground">
          Enviado em {formatDate(answers.submittedAt)}
        </p>
      </header>

      <AnamnesisAnswersContent answers={answers} />
    </article>
  );
}

/**
 * Modal aberto pelo olho da fila (achado 2026-08-18: mesma tela, nas duas caixas —
 * "Obrigatória" ainda não tem protocolo, então o `kind` decide qual endpoint chamar).
 */
export function AnamnesisAnswersModal({
  kind,
  id,
  open,
  onOpenChange,
}: {
  kind: 'PROTOCOL' | 'PARQ';
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { answers, error, reload } = useAnamnesisAnswers(kind, id, open);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Respostas da anamnese</DialogTitle>
          <DialogDescription>
            {answers ? `Enviado em ${formatDate(answers.submittedAt)}` : 'Carregando…'}
          </DialogDescription>
        </DialogHeader>

        {!answers && !error ? (
          <div
            role="status"
            className="h-72 animate-pulse rounded-xl border border-border bg-card"
            aria-label="Carregando respostas da anamnese"
          />
        ) : null}

        {!answers && error ? (
          <div role="alert" className="rounded-xl border border-coral bg-card p-6">
            <p className="text-body text-muted-foreground">{error}</p>
            <Button className="mt-4" onClick={() => void reload()}>
              <RefreshCw aria-hidden="true" /> Tentar novamente
            </Button>
          </div>
        ) : null}

        {answers ? <AnamnesisAnswersContent answers={answers} /> : null}
      </DialogContent>
    </Dialog>
  );
}
