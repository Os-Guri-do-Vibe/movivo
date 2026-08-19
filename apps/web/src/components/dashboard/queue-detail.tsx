'use client';

import {
  PARQ_QUESTION_TEXT,
  PRIMARY_GOAL_LABELS,
  protocolStructureSchema,
  type ProtocolStructure,
} from '@movivo/shared';
import { ArrowLeft, CheckCircle2, Pencil, RefreshCw, Save, ShieldAlert, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  captureDashboardEvent,
  DashboardApiError,
  getAnamnesisAnswers,
  getQueueDetail,
  releaseParq,
  resolveHandoff,
  saveProtocol,
  signProtocol,
} from '@/lib/dashboard-api';
import type {
  AnamnesisAnswers,
  ProtocolDetail,
  QueueDetail as QueueDetailType,
  QueueKind,
} from '@/lib/dashboard-types';

import { ConfirmAction } from './confirm-action';
import { ConversationReplay } from './conversation-replay';
import { WEEKDAY_ITEMS } from '../onboarding/step2-anamnesis';
import { BIOLOGICAL_SEX_LABELS } from './protocol-anamnesis-answers';
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

function numberInputValue(value: number): number | '' {
  return Number.isNaN(value) ? '' : value;
}

function validationMessages(error: unknown): string[] {
  if (error instanceof DashboardApiError && Array.isArray(error.details)) {
    return error.details.map((entry) => String(entry)).slice(0, 6);
  }
  if (error instanceof DashboardApiError && typeof error.details === 'object' && error.details) {
    const issues = (error.details as { issues?: unknown }).issues;
    if (Array.isArray(issues)) return issues.map((entry) => String(entry)).slice(0, 6);
  }
  return [error instanceof Error ? error.message : 'Não foi possível salvar o protocolo.'];
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

/**
 * Card "Protocolo · versão N" — o ícone de lápis no topo edita DENTRO deste mesmo
 * componente (achado 2026-08-19, a pedido do fundador): nada de trocar pra um formulário
 * separado com outro layout. Em modo de edição, a MESMA tabela vira campos editáveis.
 */
function ProtocolSummary({
  protocol,
  onSaved,
}: {
  protocol: ProtocolDetail;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProtocolStructure>(() => structuredClone(protocol.content));
  const [reason, setReason] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  function startEdit() {
    setDraft(structuredClone(protocol.content));
    setReason('');
    setIssues([]);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setIssues([]);
  }

  function updateSession(index: number, patch: Partial<ProtocolStructure['sessions'][number]>) {
    setDraft((current) => ({
      ...current,
      sessions: current.sessions.map((session, position) =>
        position === index ? { ...session, ...patch } : session,
      ),
    }));
  }

  function updateExercise(
    sessionIndex: number,
    exerciseIndex: number,
    patch: Partial<ProtocolStructure['sessions'][number]['exercises'][number]>,
  ) {
    setDraft((current) => ({
      ...current,
      sessions: current.sessions.map((session, position) =>
        position === sessionIndex
          ? {
              ...session,
              exercises: session.exercises.map((exercise, exPosition) =>
                exPosition === exerciseIndex ? { ...exercise, ...patch } : exercise,
              ),
            }
          : session,
      ),
    }));
  }

  async function save() {
    setIssues([]);
    const parsed = protocolStructureSchema.safeParse(draft);
    if (!parsed.success) {
      setIssues(parsed.error.issues.map((issue) => issue.message).slice(0, 6));
      return;
    }
    if (reason.trim().length < 5) {
      setIssues(['Informe por que o protocolo foi editado para compor a auditoria.']);
      return;
    }

    setPending(true);
    try {
      await saveProtocol(protocol.id, parsed.data, reason.trim());
      captureDashboardEvent('cref_protocol_edited');
      setEditing(false);
      await onSaved();
    } catch (error) {
      setIssues(validationMessages(error));
    } finally {
      setPending(false);
    }
  }

  const content = editing ? draft : protocol.content;

  return (
    <section
      aria-labelledby="protocol-title"
      className="rounded-xl border border-border bg-card p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1">
          <h2 id="protocol-title" className="text-h2 font-bold">
            Protocolo · versão {protocol.version}
          </h2>
          {editing ? (
            <div className="mt-2 flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold">
                Fase
                <select
                  className={fieldClass}
                  value={draft.phase}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      phase: event.target.value as ProtocolStructure['phase'],
                    }))
                  }
                >
                  <option value="ADAPTACAO">Adaptação</option>
                  <option value="HIPERTROFIA">Hipertrofia</option>
                  <option value="FORCA">Força</option>
                  <option value="DELOAD">Deload</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold">
                Frequência semanal
                <input
                  className={fieldClass}
                  type="number"
                  min={1}
                  max={7}
                  value={numberInputValue(draft.weeklyFrequency)}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      weeklyFrequency: event.target.valueAsNumber,
                    }))
                  }
                />
              </label>
            </div>
          ) : (
            <p className="mt-1 text-label text-muted-foreground">
              {PHASE_LABELS[protocol.content.phase] ?? protocol.content.phase} ·{' '}
              {protocol.content.weeklyFrequency}x por semana · duração:{' '}
              {protocol.totalWeeks === 1 ? '1 semana' : `${protocol.totalWeeks} semanas`}
            </p>
          )}
        </div>
        {editing ? (
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => void save()} disabled={pending}>
              <Save aria-hidden="true" className="size-4" /> {pending ? 'Validando…' : 'Salvar'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={cancelEdit}
              disabled={pending}
              aria-label="Cancelar edição"
              title="Cancelar edição"
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={startEdit}
            aria-label="Editar Protocolo"
            title="Editar Protocolo"
          >
            <Pencil aria-hidden="true" className="size-4" />
          </Button>
        )}
      </div>

      {issues.length > 0 ? (
        <div
          id="protocol-editor-issues"
          role="alert"
          className="mt-4 rounded-lg bg-destructive p-4 text-destructive-foreground"
        >
          <p className="text-label font-semibold">A edição precisa de revisão:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-label">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 space-y-4">
        {content.sessions.map((session, index) => (
          <details
            // `dayLabel` sozinho não é único (fallback alterna "Treino A"/"Treino B" —
            // achado 2026-08-18); índice garante a chave mesmo com rótulos repetidos.
            key={`${index}-${session.dayLabel}`}
            className="rounded-lg border border-border bg-background p-4"
            open
          >
            <summary className="cursor-pointer text-h3 font-semibold focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
              {editing ? (
                <span className="ml-2 inline-flex flex-wrap gap-2 align-middle">
                  <input
                    className={`${fieldClass} inline-block w-auto`}
                    value={session.dayLabel}
                    maxLength={60}
                    aria-label={`Identificação do dia — sessão ${index + 1}`}
                    onClick={(event) => event.preventDefault()}
                    onChange={(event) => updateSession(index, { dayLabel: event.target.value })}
                  />
                  <input
                    className={`${fieldClass} inline-block w-auto`}
                    value={session.focus}
                    maxLength={120}
                    aria-label={`Foco — sessão ${index + 1}`}
                    onClick={(event) => event.preventDefault()}
                    onChange={(event) => updateSession(index, { focus: event.target.value })}
                  />
                </span>
              ) : (
                sessionTitle(session, content.phase)
              )}
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
                      Repetições em Reserva (RIR)
                    </th>
                    <th scope="col" className="p-2 font-semibold">
                      Estratégia
                    </th>
                    <th scope="col" className="p-2 font-semibold">
                      Vídeo de execução
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {session.exercises.map((exercise, exerciseIndex) =>
                    editing ? (
                      <tr
                        key={exercise.exerciseId}
                        className="border-b border-border last:border-0"
                      >
                        <td className="p-2 align-top">
                          <input
                            className={fieldClass}
                            value={exercise.name}
                            maxLength={120}
                            aria-label="Nome"
                            onChange={(event) =>
                              updateExercise(index, exerciseIndex, { name: event.target.value })
                            }
                          />
                          <textarea
                            className={`${fieldClass} mt-1.5 min-h-16 py-1.5 text-xs`}
                            value={exercise.notes ?? ''}
                            maxLength={400}
                            placeholder="Observação"
                            aria-label="Observação"
                            onChange={(event) =>
                              updateExercise(index, exerciseIndex, {
                                notes: event.target.value || undefined,
                              })
                            }
                          />
                        </td>
                        <td className="p-2 align-top">
                          <input
                            className={`${fieldClass} w-20`}
                            type="number"
                            min={1}
                            max={12}
                            value={numberInputValue(exercise.sets)}
                            aria-label="Séries"
                            onChange={(event) =>
                              updateExercise(index, exerciseIndex, {
                                sets: event.target.valueAsNumber,
                              })
                            }
                          />
                        </td>
                        <td className="p-2 align-top">
                          {exercise.durationSeconds !== undefined ? (
                            // Isométrico/cardio contínuo (prancha, caminhada, bike, tiros —
                            // achado 2026-08-18): prescrito por tempo, "reps" não existe.
                            <input
                              className={`${fieldClass} w-24`}
                              type="number"
                              min={5}
                              max={2400}
                              value={numberInputValue(exercise.durationSeconds)}
                              aria-label="Duração (s)"
                              onChange={(event) =>
                                updateExercise(index, exerciseIndex, {
                                  durationSeconds: event.target.valueAsNumber,
                                })
                              }
                            />
                          ) : (
                            <div className="flex items-center gap-1">
                              <input
                                className={`${fieldClass} w-16`}
                                type="number"
                                min={1}
                                max={100}
                                value={numberInputValue(exercise.reps?.min ?? 1)}
                                aria-label="Repetições mín."
                                onChange={(event) =>
                                  updateExercise(index, exerciseIndex, {
                                    reps: {
                                      min: event.target.valueAsNumber,
                                      max: exercise.reps?.max ?? event.target.valueAsNumber,
                                    },
                                  })
                                }
                              />
                              <span aria-hidden="true">–</span>
                              <input
                                className={`${fieldClass} w-16`}
                                type="number"
                                min={1}
                                max={100}
                                value={numberInputValue(exercise.reps?.max ?? 1)}
                                aria-label="Repetições máx."
                                onChange={(event) =>
                                  updateExercise(index, exerciseIndex, {
                                    reps: {
                                      min: exercise.reps?.min ?? event.target.valueAsNumber,
                                      max: event.target.valueAsNumber,
                                    },
                                  })
                                }
                              />
                            </div>
                          )}
                        </td>
                        <td className="p-2 align-top">
                          <input
                            className={`${fieldClass} w-20`}
                            type="number"
                            min={0}
                            max={600}
                            value={numberInputValue(exercise.restSeconds)}
                            aria-label="Descanso (s)"
                            onChange={(event) =>
                              updateExercise(index, exerciseIndex, {
                                restSeconds: event.target.valueAsNumber,
                              })
                            }
                          />
                        </td>
                        <td className="p-2 align-top">
                          <input
                            className={`${fieldClass} w-16`}
                            type="number"
                            min={0}
                            max={5}
                            value={exercise.rir ?? ''}
                            aria-label="Repetições em Reserva (RIR)"
                            onChange={(event) =>
                              updateExercise(index, exerciseIndex, {
                                rir: Number.isNaN(event.target.valueAsNumber)
                                  ? undefined
                                  : event.target.valueAsNumber,
                              })
                            }
                          />
                        </td>
                        <td className="p-2 align-top">
                          <select
                            className={fieldClass}
                            value={exercise.loadStrategy}
                            aria-label="Estratégia de carga"
                            onChange={(event) =>
                              updateExercise(index, exerciseIndex, {
                                loadStrategy: event.target.value as typeof exercise.loadStrategy,
                              })
                            }
                          >
                            <option value="BODYWEIGHT">Peso corporal</option>
                            <option value="FIXED_LOAD">Carga fixa</option>
                            <option value="DOUBLE_PROGRESSION">Progressão dupla</option>
                            <option value="RPE">Percepção de esforço (RPE)</option>
                          </select>
                        </td>
                        <td className="p-2 align-top">
                          <input
                            className={`${fieldClass} w-40`}
                            type="url"
                            value={exercise.videoUrl ?? ''}
                            maxLength={500}
                            placeholder="https://…"
                            aria-label="Link de vídeo de execução"
                            onChange={(event) =>
                              updateExercise(index, exerciseIndex, {
                                videoUrl: event.target.value || undefined,
                              })
                            }
                          />
                        </td>
                      </tr>
                    ) : (
                      <tr
                        key={exercise.exerciseId}
                        className="border-b border-border last:border-0"
                      >
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
                        <td className="p-2 font-mono">{exercise.rir ?? '—'}</td>
                        <td className="p-2 text-xs">{exercise.loadStrategy}</td>
                        <td className="p-2 text-xs">
                          {exercise.videoUrl ? (
                            <a
                              href={exercise.videoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                            >
                              Assistir
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
      {editing ? (
        <>
          <label className="mt-5 flex flex-col gap-2 text-label font-semibold">
            Observações gerais
            <textarea
              className={`${fieldClass} min-h-28 py-2`}
              value={draft.generalNotes ?? ''}
              maxLength={1000}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  generalNotes: event.target.value || undefined,
                }))
              }
            />
          </label>
          <label className="mt-5 flex flex-col gap-2 text-label font-semibold">
            Motivo da edição{' '}
            <span className="text-xs font-normal text-muted-foreground">
              Obrigatório para auditoria
            </span>
            <textarea
              className={`${fieldClass} min-h-24 py-2`}
              value={reason}
              maxLength={500}
              required
              onChange={(event) => setReason(event.target.value)}
              aria-describedby={issues.length > 0 ? 'protocol-editor-issues' : undefined}
            />
          </label>
        </>
      ) : protocol.content.generalNotes ? (
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

/** `isoDateSchema` (yyyy-mm-dd) → idade em anos completos, sem depender de `Date` (fuso
 *  deslocaria o dia — mesmo cuidado de `formatBirthDate` em `protocol-anamnesis-answers`). */
function calculateAge(birthDate: string): number | null {
  const [year, month, day] = birthDate.split('-').map(Number);
  if (!year || !month || !day) return null;
  const today = new Date();
  let age = today.getFullYear() - year;
  const hadBirthdayThisYear =
    today.getMonth() + 1 > month || (today.getMonth() + 1 === month && today.getDate() >= day);
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(date);
}

/**
 * Card "Protocolo para Revisão" (achado 2026-08-19, a pedido do fundador): substitui o
 * header genérico (título + resumo) só pra PROTOCOLO, cruzando o protocolo com a
 * anamnese do titular pra dar ao RT o perfil completo do aluno de uma vez, sem precisar
 * abrir o modal de respostas. PARQ/CHECKIN/HANDOFF continuam com o header genérico —
 * "severity" nunca é SAFETY pra item de protocolo, então não há badge de segurança aqui.
 */
function ProtocolStudentHeader({
  protocolId,
  protocol,
}: {
  protocolId: string;
  protocol: ProtocolDetail;
}) {
  const [answers, setAnswers] = useState<AnamnesisAnswers | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    getAnamnesisAnswers('PROTOCOL', protocolId, controller.signal)
      .then(setAnswers)
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(
          caught instanceof Error ? caught.message : 'Não foi possível carregar a anamnese.',
        );
      });
    return () => controller.abort();
  }, [protocolId]);

  const endDate = new Date(
    new Date(protocol.createdAt).getTime() + protocol.totalWeeks * 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const riskFactors =
    answers?.health.parq?.answers
      .filter((answer) => answer.answer)
      .map(
        (answer) =>
          PARQ_QUESTION_TEXT[answer.questionId as keyof typeof PARQ_QUESTION_TEXT] ??
          answer.questionId,
      ) ?? [];

  return (
    <header className="mt-5 rounded-xl border border-border bg-card p-4 sm:p-6">
      <h1 className="text-h1 font-bold">Protocolo para Revisão</h1>
      {!answers && !error ? (
        <div
          role="status"
          aria-label="Carregando dados do aluno"
          className="mt-4 h-32 animate-pulse rounded-lg bg-secondary"
        />
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-label text-destructive">
          {error}
        </p>
      ) : null}
      {answers ? (
        <div className="mt-4 space-y-2 text-label">
          <div className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
            <div className="space-y-2">
              <p>
                <span className="font-semibold">Nome do Aluno:</span> {answers.personal.name}
              </p>
              <p>
                <span className="font-semibold">Idade:</span>{' '}
                {calculateAge(answers.personal.birthDate) ?? '—'} anos
              </p>
              <p>
                <span className="font-semibold">Objetivo:</span>{' '}
                {PRIMARY_GOAL_LABELS[
                  answers.routine.primaryGoal as keyof typeof PRIMARY_GOAL_LABELS
                ] ?? answers.routine.primaryGoal}
              </p>
              <p>
                <span className="font-semibold">Fatores de Risco:</span>{' '}
                {riskFactors.length
                  ? riskFactors.join('; ')
                  : 'Nenhum fator de risco identificado.'}
              </p>
              <p>
                <span className="font-semibold">Mesociclo:</span>{' '}
                {PHASE_LABELS[protocol.content.phase] ?? protocol.content.phase}
              </p>
            </div>
            <div className="space-y-2">
              <p>
                <span className="font-semibold">Peso:</span> {answers.personal.weightKg}kg
              </p>
              <p>
                <span className="font-semibold">Altura:</span> {answers.personal.heightCm} cm
              </p>
              <p>
                <span className="font-semibold">Sexo:</span>{' '}
                {BIOLOGICAL_SEX_LABELS[answers.personal.biologicalSex] ??
                  answers.personal.biologicalSex}
              </p>
              <p>
                <span className="font-semibold">Frequência:</span> {answers.routine.daysPerWeek}x
                por semana
                {answers.routine.preferredDays.length
                  ? ` | ${answers.routine.preferredDays.map((day) => WEEKDAY_LABELS[day] ?? day).join(', ')}`
                  : ''}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
            <p>
              <span className="font-semibold">Início do protocolo:</span>{' '}
              {formatShortDate(protocol.createdAt)}
            </p>
            <p>
              <span className="font-semibold">Fim do protocolo:</span> {formatShortDate(endDate)}
            </p>
          </div>
        </div>
      ) : null}
    </header>
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

      {kind === 'PROTOCOL' && detail.protocol ? (
        <ProtocolStudentHeader protocolId={detail.protocol.id} protocol={detail.protocol} />
      ) : (
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
      )}

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
          <ProtocolSummary
            protocol={detail.protocol}
            onSaved={async () => {
              setSuccess('Edição validada no servidor e registrada para revisão.');
              await load();
            }}
          />
        ) : null}
        {detail.replay ? <ConversationReplay replay={detail.replay} /> : null}

        {/* Achado 2026-08-19: pra protocolo, "Contexto autorizado" só repetia a versão
            (já no título) e um `humanReviewRequired` sempre `true` — sem valor pro RT. */}
        {kind !== 'PROTOCOL' ? <Context detail={detail} /> : null}

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
