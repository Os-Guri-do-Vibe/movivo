'use client';

import {
  PARQ_QUESTION_TEXT,
  PRIMARY_GOAL_LABELS,
  protocolStructureSchema,
  type ProtocolExercise,
  type ProtocolStructure,
} from '@movivo/shared';
import {
  ArrowLeft,
  CheckCircle2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  captureDashboardEvent,
  DashboardApiError,
  getAnamnesisAnswers,
  getQueueDetail,
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
import {
  ChipGroupField,
  ComboboxField,
  NumberField,
  TextAreaField,
  TextField,
  type FieldOption,
} from './fields';
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

const PHASE_ITEMS: readonly FieldOption<ProtocolStructure['phase']>[] = [
  { value: 'ADAPTACAO', label: 'Adaptação' },
  { value: 'HIPERTROFIA', label: 'Hipertrofia' },
  { value: 'FORCA', label: 'Força' },
  { value: 'DELOAD', label: 'Deload' },
];

const LOAD_STRATEGY_LABELS: Record<string, string> = {
  BODYWEIGHT: 'Peso corporal',
  FIXED_LOAD: 'Carga fixa',
  DOUBLE_PROGRESSION: 'Progressão dupla',
  RPE: 'Percepção de esforço (RPE)',
};

const LOAD_STRATEGY_ITEMS: readonly FieldOption<
  ProtocolStructure['sessions'][number]['exercises'][number]['loadStrategy']
>[] = [
  { value: 'BODYWEIGHT', label: 'Peso corporal' },
  { value: 'FIXED_LOAD', label: 'Carga fixa' },
  { value: 'DOUBLE_PROGRESSION', label: 'Progressão dupla' },
  { value: 'RPE', label: 'Percepção de esforço (RPE)' },
];

const WEEKLY_FREQUENCY_ITEMS: readonly FieldOption<string>[] = Array.from(
  { length: 7 },
  (_, i) => ({ value: String(i + 1), label: `${i + 1}x` }),
);

/** Novo exercício em branco — o RT preenche nome/valores; `id-` marca origem manual (fora do catálogo). */
function blankExercise(): ProtocolStructure['sessions'][number]['exercises'][number] {
  return {
    exerciseId: `manual-${crypto.randomUUID()}`,
    name: '',
    sets: 3,
    reps: { min: 8, max: 12 },
    loadStrategy: 'BODYWEIGHT',
    restSeconds: 60,
  };
}

type WarmupBlock = NonNullable<
  ProtocolStructure['sessions'][number]['exercises'][number]['warmupBlocks']
>[number];

function blankWarmupBlock(): WarmupBlock {
  return { sets: 1, reps: { min: 12, max: 15 }, restSeconds: 30 };
}

/**
 * Campo compacto com rótulo (achado 2026-08-22, a pedido do fundador): o editor de
 * exercício era uma tabela de 8 colunas com células de altura desigual — sem rótulo
 * visível em boa parte dos campos (ex.: "Séries" ficava ambíguo depois que o aquecimento
 * também ganhou seu próprio "séries"). Substituído por cards com grid de campos rotulados.
 */
function MiniField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** Alternador compacto de duas opções (repetições/duração) — `ChipGroupField` é grande
 *  demais (pensado pra toque no onboarding) pro espaço apertado de um card de exercício. */
function MeasureToggle({
  mode,
  onChange,
  label,
}: {
  mode: 'reps' | 'duration';
  onChange: (mode: 'reps' | 'duration') => void;
  label: string;
}) {
  return (
    <div
      className="inline-flex shrink-0 rounded-lg border border-input p-0.5"
      role="radiogroup"
      aria-label={label}
    >
      {(['reps', 'duration'] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          aria-label={value === 'reps' ? 'Repetições' : 'Duração'}
          title={value === 'reps' ? 'Repetições' : 'Duração'}
          onClick={() => onChange(value)}
          className={cn(
            'rounded-md px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring',
            mode === value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-secondary',
          )}
        >
          {value === 'reps' ? 'Reps' : 'Seg'}
        </button>
      ))}
    </div>
  );
}

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

/**
 * Campos dentro de um `<summary>` (nome/foco do treino) recebem o toggle nativo de
 * espaço/Enter do `<details>` mesmo com o foco no input filho. O navegador resolve essa
 * ação padrão pelo `defaultPrevented` acumulado do evento, não pelo ponto em que a
 * propagação foi interrompida — então `stopPropagation` sozinho não impede o toggle
 * (o handler nativo do `<summary>` já processa o evento antes de qualquer listener React,
 * que só roda na raiz delegada). A única forma confiável é cancelar o evento inteiro com
 * `preventDefault` — o que também cancelaria a digitação do espaço — e replicar a
 * inserção do caractere manualmente.
 */
function preventSummaryToggleKeys(
  event: React.KeyboardEvent<HTMLInputElement>,
  onChange: (value: string) => void,
) {
  if (event.key !== ' ' && event.key !== 'Enter') return;
  event.preventDefault();
  if (event.key === 'Enter') return;
  const input = event.currentTarget;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const nextValue = `${input.value.slice(0, start)} ${input.value.slice(end)}`;
  input.value = nextValue;
  input.setSelectionRange(start + 1, start + 1);
  onChange(nextValue);
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
 * Card de exercício em modo edição (achado 2026-08-22, a pedido do fundador — a tabela de
 * 8 colunas apertadas virou cards com grid de campos rotulados, mais compacto e legível).
 * Componente próprio (não inline no `.map` de `ProtocolSummary`) só pra não deixar o JSX
 * do pai ainda mais denso — recebe os mutadores de `ProtocolSummary` já prontos.
 */
function ExerciseEditorCard({
  exercise,
  sessionIndex,
  exerciseIndex,
  canRemove,
  onUpdate,
  onRemove,
  onAddWarmupBlock,
  onUpdateWarmupBlock,
  onRemoveWarmupBlock,
}: {
  exercise: ProtocolExercise;
  sessionIndex: number;
  exerciseIndex: number;
  canRemove: boolean;
  onUpdate: (sessionIndex: number, exerciseIndex: number, patch: Partial<ProtocolExercise>) => void;
  onRemove: (sessionIndex: number, exerciseIndex: number) => void;
  onAddWarmupBlock: (sessionIndex: number, exerciseIndex: number) => void;
  onUpdateWarmupBlock: (
    sessionIndex: number,
    exerciseIndex: number,
    blockIndex: number,
    patch: Partial<WarmupBlock>,
  ) => void;
  onRemoveWarmupBlock: (sessionIndex: number, exerciseIndex: number, blockIndex: number) => void;
}) {
  const update = (patch: Partial<ProtocolExercise>) => onUpdate(sessionIndex, exerciseIndex, patch);
  const isDuration = exercise.durationSeconds !== undefined;
  const warmupBlocks = exercise.warmupBlocks ?? [];

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <TextField
            value={exercise.name}
            maxLength={120}
            placeholder="Nome do exercício"
            aria-label="Nome"
            className="font-medium"
            onChange={(value) => update({ name: value })}
          />
          <TextAreaField
            className="min-h-12 py-1.5 text-xs"
            value={exercise.notes ?? ''}
            maxLength={400}
            placeholder="Observação (opcional)"
            aria-label="Observação"
            onChange={(value) => update({ notes: value || undefined })}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0"
          disabled={!canRemove}
          onClick={() => onRemove(sessionIndex, exerciseIndex)}
          aria-label={`Remover exercício "${exercise.name || 'sem nome'}"`}
          title={canRemove ? 'Remover exercício' : 'A sessão precisa de pelo menos um exercício'}
        >
          <Trash2 aria-hidden="true" className="size-4 text-destructive" />
        </Button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniField label="Séries válidas">
          <NumberField
            min={1}
            max={12}
            value={numberInputValue(exercise.sets)}
            aria-label="Séries válidas"
            onChange={(value) => update({ sets: Number(value) })}
          />
        </MiniField>
        <MiniField label="Descanso (s)">
          <NumberField
            min={0}
            max={600}
            value={numberInputValue(exercise.restSeconds)}
            aria-label="Descanso (s)"
            onChange={(value) => update({ restSeconds: Number(value) })}
          />
        </MiniField>
        <MiniField label="RIR">
          <NumberField
            min={0}
            max={5}
            value={exercise.rir ?? ''}
            aria-label="Repetições em Reserva (RIR)"
            onChange={(value) =>
              update({
                rir: value === '' || Number.isNaN(Number(value)) ? undefined : Number(value),
              })
            }
          />
        </MiniField>
        <MiniField label="Estratégia">
          <ComboboxField
            id={`load-strategy-${exercise.exerciseId}`}
            label="Estratégia de carga"
            items={LOAD_STRATEGY_ITEMS}
            value={exercise.loadStrategy}
            className="[&>span]:sr-only"
            onChange={(loadStrategy) => update({ loadStrategy })}
          />
        </MiniField>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MiniField label="Repetição ou duração">
          <div className="flex items-center gap-2">
            <MeasureToggle
              label="Repetição ou duração"
              mode={isDuration ? 'duration' : 'reps'}
              onChange={(mode) =>
                update({
                  reps: mode === 'reps' ? { min: 8, max: 12 } : undefined,
                  durationSeconds: mode === 'duration' ? 30 : undefined,
                })
              }
            />
            {isDuration ? (
              <NumberField
                className="w-28"
                min={5}
                max={2400}
                value={numberInputValue(exercise.durationSeconds ?? 0)}
                aria-label="Duração (s)"
                onChange={(value) => update({ durationSeconds: Number(value) })}
              />
            ) : (
              <div className="flex items-center gap-1">
                <NumberField
                  className="w-20"
                  min={1}
                  max={100}
                  value={numberInputValue(exercise.reps?.min ?? 1)}
                  aria-label="Repetições mín."
                  onChange={(value) =>
                    update({
                      reps: { min: Number(value), max: exercise.reps?.max ?? Number(value) },
                    })
                  }
                />
                <span aria-hidden="true">–</span>
                <NumberField
                  className="w-20"
                  min={1}
                  max={100}
                  value={numberInputValue(exercise.reps?.max ?? 1)}
                  aria-label="Repetições máx."
                  onChange={(value) =>
                    update({
                      reps: { min: exercise.reps?.min ?? Number(value), max: Number(value) },
                    })
                  }
                />
              </div>
            )}
          </div>
        </MiniField>
        <MiniField label="Vídeo de execução">
          <TextField
            type="url"
            value={exercise.videoUrl ?? ''}
            maxLength={500}
            placeholder="https://…"
            aria-label="Link de vídeo de execução"
            onChange={(value) => update({ videoUrl: value || undefined })}
          />
        </MiniField>
      </div>

      <div className="mt-3 rounded-lg border border-dashed border-input bg-muted/30 p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground">
            Aquecimento (opcional) — séries próprias, fora da série válida acima
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            disabled={warmupBlocks.length >= 4}
            onClick={() => onAddWarmupBlock(sessionIndex, exerciseIndex)}
            aria-label="Adicionar bloco de aquecimento"
            title={
              warmupBlocks.length >= 4
                ? 'Limite de 4 blocos de aquecimento'
                : 'Adicionar bloco de aquecimento'
            }
          >
            <Plus aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
        {warmupBlocks.length > 0 ? (
          <div className="mt-2 flex flex-col gap-1.5">
            {warmupBlocks.map((block, blockIndex) => {
              const blockIsDuration = block.durationSeconds !== undefined;
              return (
                <div
                  key={blockIndex}
                  className="flex flex-wrap items-center gap-1.5 rounded-md bg-background p-1.5"
                >
                  <NumberField
                    className="w-16"
                    min={1}
                    max={6}
                    value={numberInputValue(block.sets)}
                    aria-label={`Séries do bloco de aquecimento ${blockIndex + 1}`}
                    onChange={(value) =>
                      onUpdateWarmupBlock(sessionIndex, exerciseIndex, blockIndex, {
                        sets: Number(value),
                      })
                    }
                  />
                  <span aria-hidden="true" className="text-xs text-muted-foreground">
                    ×
                  </span>
                  <MeasureToggle
                    label={`Medida do bloco de aquecimento ${blockIndex + 1}`}
                    mode={blockIsDuration ? 'duration' : 'reps'}
                    onChange={(mode) =>
                      onUpdateWarmupBlock(sessionIndex, exerciseIndex, blockIndex, {
                        reps: mode === 'reps' ? { min: 12, max: 15 } : undefined,
                        durationSeconds: mode === 'duration' ? 30 : undefined,
                      })
                    }
                  />
                  {blockIsDuration ? (
                    <NumberField
                      className="w-20"
                      min={5}
                      max={2400}
                      value={numberInputValue(block.durationSeconds ?? 0)}
                      aria-label={`Duração do bloco de aquecimento ${blockIndex + 1} (s)`}
                      onChange={(value) =>
                        onUpdateWarmupBlock(sessionIndex, exerciseIndex, blockIndex, {
                          durationSeconds: Number(value),
                        })
                      }
                    />
                  ) : (
                    <div className="flex items-center gap-1">
                      <NumberField
                        className="w-16"
                        min={1}
                        max={100}
                        value={numberInputValue(block.reps?.min ?? 1)}
                        aria-label={`Repetições mín. do bloco de aquecimento ${blockIndex + 1}`}
                        onChange={(value) =>
                          onUpdateWarmupBlock(sessionIndex, exerciseIndex, blockIndex, {
                            reps: { min: Number(value), max: block.reps?.max ?? Number(value) },
                          })
                        }
                      />
                      <span aria-hidden="true" className="text-xs">
                        –
                      </span>
                      <NumberField
                        className="w-16"
                        min={1}
                        max={100}
                        value={numberInputValue(block.reps?.max ?? 1)}
                        aria-label={`Repetições máx. do bloco de aquecimento ${blockIndex + 1}`}
                        onChange={(value) =>
                          onUpdateWarmupBlock(sessionIndex, exerciseIndex, blockIndex, {
                            reps: { min: block.reps?.min ?? Number(value), max: Number(value) },
                          })
                        }
                      />
                    </div>
                  )}
                  <MiniField label="Descanso (s)">
                    <NumberField
                      className="w-20"
                      min={0}
                      max={600}
                      value={
                        block.restSeconds !== undefined ? numberInputValue(block.restSeconds) : ''
                      }
                      aria-label={`Descanso do bloco de aquecimento ${blockIndex + 1} (s)`}
                      onChange={(value) =>
                        onUpdateWarmupBlock(sessionIndex, exerciseIndex, blockIndex, {
                          restSeconds: value === '' ? undefined : Number(value),
                        })
                      }
                    />
                  </MiniField>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="ml-auto size-6 shrink-0"
                    onClick={() => onRemoveWarmupBlock(sessionIndex, exerciseIndex, blockIndex)}
                    aria-label={`Remover bloco de aquecimento ${blockIndex + 1}`}
                  >
                    <Trash2 aria-hidden="true" className="size-3.5 text-destructive" />
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
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

  /** `protocolExerciseSchema.max(15)` — o botão já fica desabilitado antes de chegar lá. */
  function addExercise(sessionIndex: number) {
    setDraft((current) => ({
      ...current,
      sessions: current.sessions.map((session, position) =>
        position === sessionIndex
          ? { ...session, exercises: [...session.exercises, blankExercise()] }
          : session,
      ),
    }));
  }

  /** `protocolExerciseSchema.min(1)` — o botão já fica desabilitado com um exercício só. */
  function removeExercise(sessionIndex: number, exerciseIndex: number) {
    setDraft((current) => ({
      ...current,
      sessions: current.sessions.map((session, position) =>
        position === sessionIndex
          ? { ...session, exercises: session.exercises.filter((_, i) => i !== exerciseIndex) }
          : session,
      ),
    }));
  }

  /** `warmupSetBlockSchema.max(4)` — o botão já fica desabilitado antes de chegar lá. */
  function addWarmupBlock(sessionIndex: number, exerciseIndex: number) {
    updateExercise(sessionIndex, exerciseIndex, {
      warmupBlocks: [
        ...(draft.sessions[sessionIndex]?.exercises[exerciseIndex]?.warmupBlocks ?? []),
        blankWarmupBlock(),
      ],
    });
  }

  function updateWarmupBlock(
    sessionIndex: number,
    exerciseIndex: number,
    blockIndex: number,
    patch: Partial<WarmupBlock>,
  ) {
    const blocks = draft.sessions[sessionIndex]?.exercises[exerciseIndex]?.warmupBlocks ?? [];
    updateExercise(sessionIndex, exerciseIndex, {
      warmupBlocks: blocks.map((block, i) => (i === blockIndex ? { ...block, ...patch } : block)),
    });
  }

  function removeWarmupBlock(sessionIndex: number, exerciseIndex: number, blockIndex: number) {
    const blocks = draft.sessions[sessionIndex]?.exercises[exerciseIndex]?.warmupBlocks ?? [];
    const next = blocks.filter((_, i) => i !== blockIndex);
    updateExercise(sessionIndex, exerciseIndex, { warmupBlocks: next.length ? next : undefined });
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
            <div className="mt-3 flex flex-wrap items-start gap-4">
              <ComboboxField
                id="protocol-phase"
                label="Fase"
                items={PHASE_ITEMS}
                value={draft.phase}
                onChange={(phase) => setDraft((current) => ({ ...current, phase }))}
                className="w-44"
              />
              <ChipGroupField
                label="Frequência semanal"
                items={WEEKLY_FREQUENCY_ITEMS}
                value={String(draft.weeklyFrequency)}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, weeklyFrequency: Number(value) }))
                }
              />
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
            // Achado 2026-08-22: a chave incluía `session.dayLabel` — como esse é o
            // próprio campo editável dessa sessão, cada tecla digitada mudava a key,
            // fazendo o React desmontar/remontar o `<details>` inteiro (perdendo o foco
            // do input a cada caractere). A lista de sessões não é reordenada nem
            // filtrada nesta tela, então o índice sozinho já é uma chave estável.
            key={index}
            className="rounded-lg border border-border bg-background p-4"
            open
          >
            <summary className="cursor-pointer text-h3 font-semibold focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
              {editing ? (
                <span className="ml-2 inline-flex flex-wrap gap-2 align-middle">
                  <TextField
                    className="inline-block w-auto"
                    value={session.dayLabel}
                    maxLength={60}
                    aria-label={`Identificação do dia — sessão ${index + 1}`}
                    onClick={(event: React.MouseEvent) => event.preventDefault()}
                    onKeyDown={(event) =>
                      preventSummaryToggleKeys(event, (value) =>
                        updateSession(index, { dayLabel: value }),
                      )
                    }
                    onChange={(value) => updateSession(index, { dayLabel: value })}
                  />
                  <TextField
                    className="inline-block w-auto"
                    value={session.focus}
                    maxLength={120}
                    aria-label={`Foco — sessão ${index + 1}`}
                    onClick={(event: React.MouseEvent) => event.preventDefault()}
                    onKeyDown={(event) =>
                      preventSummaryToggleKeys(event, (value) =>
                        updateSession(index, { focus: value }),
                      )
                    }
                    onChange={(value) => updateSession(index, { focus: value })}
                  />
                </span>
              ) : (
                sessionTitle(session, content.phase)
              )}
            </summary>
            {editing ? (
              <div className="mt-4 flex flex-col gap-3">
                {session.exercises.map((exercise, exerciseIndex) => (
                  <ExerciseEditorCard
                    key={exercise.exerciseId}
                    exercise={exercise}
                    sessionIndex={index}
                    exerciseIndex={exerciseIndex}
                    canRemove={session.exercises.length > 1}
                    onUpdate={updateExercise}
                    onRemove={removeExercise}
                    onAddWarmupBlock={addWarmupBlock}
                    onUpdateWarmupBlock={updateWarmupBlock}
                    onRemoveWarmupBlock={removeWarmupBlock}
                  />
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={session.exercises.length >= 15}
                  onClick={() => addExercise(index)}
                  title={
                    session.exercises.length >= 15
                      ? 'Limite de 15 exercícios por sessão'
                      : 'Adicionar exercício'
                  }
                >
                  <Plus aria-hidden="true" className="size-4" /> Adicionar exercício
                </Button>
              </div>
            ) : (
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
                    {session.exercises.map((exercise) => (
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
                          {exercise.warmupBlocks?.length ? (
                            <span className="mt-1 block text-xs text-muted-foreground italic">
                              Aquecimento:{' '}
                              {exercise.warmupBlocks
                                .map((block) =>
                                  block.durationSeconds !== undefined
                                    ? `${block.sets}×${block.durationSeconds}s`
                                    : `${block.sets}×${block.reps?.min}–${block.reps?.max}`,
                                )
                                .join(', ')}
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
                        <td className="p-2 text-xs">
                          {LOAD_STRATEGY_LABELS[exercise.loadStrategy] ?? exercise.loadStrategy}
                        </td>
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
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>
        ))}
      </div>
      {editing ? (
        <>
          <label className="mt-5 flex flex-col gap-2 text-label font-semibold">
            Observações gerais
            <TextAreaField
              className="min-h-28 py-2"
              value={draft.generalNotes ?? ''}
              maxLength={1000}
              onChange={(value) =>
                setDraft((current) => ({ ...current, generalNotes: value || undefined }))
              }
            />
          </label>
          <label className="mt-5 flex flex-col gap-2 text-label font-semibold">
            Motivo da edição{' '}
            <span className="text-xs font-normal text-muted-foreground">
              Obrigatório para auditoria
            </span>
            <TextAreaField
              className="min-h-24 py-2"
              value={reason}
              maxLength={500}
              required
              onChange={setReason}
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
 * abrir o modal de respostas. CHECKIN/HANDOFF continuam com o header genérico.
 *
 * Desde 2026-08-24 este é TAMBÉM o header do PAR-Q bloqueante (`origin: 'PARQ'`), que
 * deixou de ter tela própria: a exigência do fundador é que a revisão obrigatória seja
 * indistinguível da opcional aqui dentro — mesmo header, mesmo editor, mesmo "Assinar e
 * liberar" (que, no backend, também libera o PAR-Q). Por isso `severity` NÃO é lida aqui:
 * a legenda de segurança fica no card da fila, onde ela ajuda a priorizar, e não nesta
 * tela, onde só criaria um fluxo visualmente diferente pro mesmo trabalho.
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
          <div className="flex justify-end">
            <ConfirmAction
              triggerLabel="Assinar e liberar"
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
