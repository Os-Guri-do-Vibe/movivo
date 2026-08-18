'use client';

import { protocolStructureSchema, type ProtocolStructure } from '@movivo/shared';
import { CheckCircle2, Pencil, Save, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { captureDashboardEvent, DashboardApiError, saveProtocol } from '@/lib/dashboard-api';

const fieldClass =
  'min-h-11 w-full rounded-lg border border-input bg-background px-3 text-label focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring';

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

export function ProtocolEditor({
  protocolId,
  content,
  onSaved,
}: {
  protocolId: string;
  content: ProtocolStructure;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProtocolStructure>(() => structuredClone(content));
  const [reason, setReason] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const [success, setSuccess] = useState('');
  const [pending, setPending] = useState(false);

  function reset() {
    setDraft(structuredClone(content));
    setReason('');
    setIssues([]);
    setEditing(false);
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
    setSuccess('');
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
      await saveProtocol(protocolId, parsed.data, reason.trim());
      captureDashboardEvent('cref_protocol_edited');
      setSuccess('Edição validada no servidor e registrada para revisão.');
      setEditing(false);
      await onSaved();
    } catch (error) {
      setIssues(validationMessages(error));
    } finally {
      setPending(false);
    }
  }

  if (!editing) {
    return (
      <div className="mt-5">
        {success ? (
          <p
            role="status"
            className="mb-3 flex items-center gap-2 rounded-lg bg-accent p-3 text-label text-accent-foreground"
          >
            <CheckCircle2 aria-hidden="true" /> {success}
          </p>
        ) : null}
        <Button type="button" variant="outline" size="lg" onClick={() => setEditing(true)}>
          <Pencil aria-hidden="true" /> Editar antes de assinar
        </Button>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="editor-title"
      className="mt-6 rounded-xl border border-border bg-background p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="editor-title" className="text-h2 font-bold">
            Editor do protocolo
          </h2>
          <p className="mt-1 text-label text-muted-foreground">
            A checagem local ajuda a revisar a forma; o ValidationService do servidor é
            autoritativo.
          </p>
        </div>
        <Button type="button" variant="ghost" onClick={reset} disabled={pending}>
          <X aria-hidden="true" /> Cancelar edição
        </Button>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-label font-semibold">
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
        <label className="flex flex-col gap-2 text-label font-semibold">
          Frequência semanal
          <input
            className={fieldClass}
            type="number"
            min={1}
            max={7}
            value={numberInputValue(draft.weeklyFrequency)}
            onChange={(event) =>
              setDraft((current) => ({ ...current, weeklyFrequency: event.target.valueAsNumber }))
            }
          />
        </label>
      </div>

      <div className="mt-6 space-y-5">
        {draft.sessions.map((session, sessionIndex) => (
          <fieldset key={sessionIndex} className="rounded-xl border border-border bg-card p-4">
            <legend className="px-2 text-h3 font-semibold">Sessão {sessionIndex + 1}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-label font-semibold">
                Identificação do dia
                <input
                  className={fieldClass}
                  value={session.dayLabel}
                  maxLength={60}
                  onChange={(event) =>
                    updateSession(sessionIndex, { dayLabel: event.target.value })
                  }
                />
              </label>
              <label className="flex flex-col gap-2 text-label font-semibold">
                Foco
                <input
                  className={fieldClass}
                  value={session.focus}
                  maxLength={120}
                  onChange={(event) => updateSession(sessionIndex, { focus: event.target.value })}
                />
              </label>
            </div>

            <div className="mt-5 space-y-4">
              {session.exercises.map((exercise, exerciseIndex) => (
                <fieldset
                  key={`${exercise.exerciseId}-${exerciseIndex}`}
                  className="rounded-lg bg-secondary p-4"
                >
                  <legend className="px-2 text-label font-semibold">
                    Exercício {exerciseIndex + 1} ·{' '}
                    <span className="font-mono text-xs">{exercise.exerciseId}</span>
                  </legend>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <label className="flex flex-col gap-1.5 text-xs font-semibold md:col-span-2">
                      Nome
                      <input
                        className={fieldClass}
                        value={exercise.name}
                        maxLength={120}
                        onChange={(event) =>
                          updateExercise(sessionIndex, exerciseIndex, { name: event.target.value })
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-1.5 text-xs font-semibold">
                      Séries
                      <input
                        className={fieldClass}
                        type="number"
                        min={1}
                        max={12}
                        value={numberInputValue(exercise.sets)}
                        onChange={(event) =>
                          updateExercise(sessionIndex, exerciseIndex, {
                            sets: event.target.valueAsNumber,
                          })
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-1.5 text-xs font-semibold">
                      Descanso (s)
                      <input
                        className={fieldClass}
                        type="number"
                        min={0}
                        max={600}
                        value={numberInputValue(exercise.restSeconds)}
                        onChange={(event) =>
                          updateExercise(sessionIndex, exerciseIndex, {
                            restSeconds: event.target.valueAsNumber,
                          })
                        }
                      />
                    </label>
                    {exercise.durationSeconds !== undefined ? (
                      // Isométrico/cardio contínuo (prancha, caminhada, bike, tiros — achado
                      // 2026-08-18): prescrito por tempo, "reps" não existe pra esse exercício.
                      <label className="flex flex-col gap-1.5 text-xs font-semibold">
                        Duração (s)
                        <input
                          className={fieldClass}
                          type="number"
                          min={5}
                          max={2400}
                          value={numberInputValue(exercise.durationSeconds)}
                          onChange={(event) =>
                            updateExercise(sessionIndex, exerciseIndex, {
                              durationSeconds: event.target.valueAsNumber,
                            })
                          }
                        />
                      </label>
                    ) : (
                      <>
                        <label className="flex flex-col gap-1.5 text-xs font-semibold">
                          Repetições mín.
                          <input
                            className={fieldClass}
                            type="number"
                            min={1}
                            max={100}
                            value={numberInputValue(exercise.reps?.min ?? 1)}
                            onChange={(event) =>
                              updateExercise(sessionIndex, exerciseIndex, {
                                reps: {
                                  min: event.target.valueAsNumber,
                                  max: exercise.reps?.max ?? event.target.valueAsNumber,
                                },
                              })
                            }
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-xs font-semibold">
                          Repetições máx.
                          <input
                            className={fieldClass}
                            type="number"
                            min={1}
                            max={100}
                            value={numberInputValue(exercise.reps?.max ?? 1)}
                            onChange={(event) =>
                              updateExercise(sessionIndex, exerciseIndex, {
                                reps: {
                                  min: exercise.reps?.min ?? event.target.valueAsNumber,
                                  max: event.target.valueAsNumber,
                                },
                              })
                            }
                          />
                        </label>
                      </>
                    )}
                    <label className="flex flex-col gap-1.5 text-xs font-semibold md:col-span-2">
                      Estratégia de carga
                      <select
                        className={fieldClass}
                        value={exercise.loadStrategy}
                        onChange={(event) =>
                          updateExercise(sessionIndex, exerciseIndex, {
                            loadStrategy: event.target.value as typeof exercise.loadStrategy,
                          })
                        }
                      >
                        <option value="BODYWEIGHT">Peso corporal</option>
                        <option value="FIXED_LOAD">Carga fixa</option>
                        <option value="DOUBLE_PROGRESSION">Progressão dupla</option>
                        <option value="RPE">Percepção de esforço (RPE)</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1.5 text-xs font-semibold md:col-span-2 xl:col-span-4">
                      Observação
                      <textarea
                        className={`${fieldClass} min-h-24 py-2`}
                        value={exercise.notes ?? ''}
                        maxLength={400}
                        onChange={(event) =>
                          updateExercise(sessionIndex, exerciseIndex, {
                            notes: event.target.value || undefined,
                          })
                        }
                      />
                    </label>
                  </div>
                </fieldset>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <label className="mt-5 flex flex-col gap-2 text-label font-semibold">
        Observações gerais
        <textarea
          className={`${fieldClass} min-h-28 py-2`}
          value={draft.generalNotes ?? ''}
          maxLength={1000}
          onChange={(event) =>
            setDraft((current) => ({ ...current, generalNotes: event.target.value || undefined }))
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

      <div className="mt-5 flex flex-wrap gap-3">
        <Button type="button" size="lg" onClick={() => void save()} disabled={pending}>
          <Save aria-hidden="true" />{' '}
          {pending ? 'Validando no servidor…' : 'Validar e salvar edição'}
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={reset} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </section>
  );
}
