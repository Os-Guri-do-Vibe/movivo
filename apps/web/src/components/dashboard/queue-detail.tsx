'use client';

import {
  ADVANCED_TECHNIQUE_LABELS,
  LOAD_STRATEGY_LABELS,
  PARQ_QUESTION_IDS,
  PARQ_RISK_FACTOR_LABEL,
  PRIMARY_GOAL_LABELS,
  protocolStructureSchema,
  type AdvancedTechnique,
  type ProtocolExercise,
  type ProtocolStructure,
  type Weekday,
} from '@movivo/shared';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowDownUp,
  ArrowLeft,
  CheckCircle2,
  Eye,
  GripVertical,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  approveSubstitutionNow,
  amendActiveProtocol,
  captureDashboardEvent,
  DashboardApiError,
  discardSubstitution,
  getAnamnesisAnswers,
  getQueueDetail,
  saveProtocol,
  signProtocol,
} from '@/lib/dashboard-api';
import type {
  ActionResult,
  AnamnesisAnswers,
  ExerciseCatalogOption,
  ProtocolConflict,
  ProtocolDetail,
  QueueDetail as QueueDetailType,
} from '@/lib/dashboard-types';

import { ConfirmAction } from './confirm-action';
import { ConversationReplay } from './conversation-replay';
import { ExerciseCatalogPicker, isUnlinkedExerciseId } from './exercise-catalog-picker';
import { useMarkNotificationRead } from './notifications-provider';
import {
  ChipGroupField,
  ComboboxField,
  NumberField,
  TextAreaField,
  TextField,
  type FieldOption,
} from './fields';
import { WEEKDAY_ITEMS } from '../onboarding/step2-anamnesis';
import { AnamnesisAnswersModal, BIOLOGICAL_SEX_LABELS } from './protocol-anamnesis-answers';
import { meaningfulText } from './queue-board';
import { SubstitutionCatalogGapDialog } from './substitution-catalog-gap-dialog';
import { useReviewHold } from './use-review-hold';
import {
  allItemsDiscarded,
  buildItemEdits,
  SubstitutionItemsReview,
  unresolvedItemIndexes,
  type ItemDraft,
  type ItemDrafts,
} from './substitution-items-review';

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

/**
 * Achado 2026-09-02: a coluna "Estratégia" mostrava `loadStrategy` — mas o próprio schema
 * (`packages/shared/src/schemas/protocol.schema.ts`) já documentava essa coluna como sendo
 * a de TÉCNICA avançada (`ADVANCED_TECHNIQUE_LABELS`), e é isso que a página pública do
 * protocolo e o PDF (que já usam `ADVANCED_TECHNIQUE_LABELS`) sempre mostraram. Só esta
 * tela de revisão do CREF estava com o campo errado — corrigido para "Técnica". A pedido
 * do fundador, `loadStrategy` (dado de treino como outro qualquer) ganhou coluna própria
 * "Estratégia" ao lado direito, em vez de ficar só na conversa do AI Coach. `NONE_TECHNIQUE`
 * é sentinela de UI apenas — vira `technique: undefined` ao salvar (a maioria dos
 * exercícios não usa técnica avançada; `loadStrategy`, ao contrário, é sempre obrigatório).
 */
const NONE_TECHNIQUE = 'NONE' as const;
type TechniqueFieldValue = AdvancedTechnique | typeof NONE_TECHNIQUE;

const TECHNIQUE_ITEMS: readonly FieldOption<TechniqueFieldValue>[] = [
  { value: NONE_TECHNIQUE, label: 'Nenhuma (série tradicional)' },
  ...(Object.entries(ADVANCED_TECHNIQUE_LABELS) as [AdvancedTechnique, string][]).map(
    ([value, label]) => ({ value, label }),
  ),
];

const LOAD_STRATEGY_ITEMS: readonly FieldOption<
  ProtocolStructure['sessions'][number]['exercises'][number]['loadStrategy']
>[] = Object.entries(LOAD_STRATEGY_LABELS).map(([value, label]) => ({
  value: value as ProtocolStructure['sessions'][number]['exercises'][number]['loadStrategy'],
  label,
}));

const WEEKLY_FREQUENCY_ITEMS: readonly FieldOption<string>[] = Array.from(
  { length: 7 },
  (_, i) => ({ value: String(i + 1), label: `${i + 1}x` }),
);

/**
 * Novo exercício em branco. `pending-` marca que ainda não foi escolhido no catálogo: o
 * editor não salva até o RT selecionar um exercício oficial no autocomplete (achado
 * 2026-10-15 — o antigo `manual-` ia para o protocolo e travava a assinatura).
 */
function blankExercise(): ProtocolStructure['sessions'][number]['exercises'][number] {
  return {
    exerciseId: `pending-${crypto.randomUUID()}`,
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
          {value === 'reps' ? 'Reps' : 'Min'}
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

/** Segundos até 60 "40 s", minutos até 60min "1 min 30 s", acima disso em horas "1 h 30 min". */
function formatDurationLabel(totalSeconds: number): string {
  if (totalSeconds <= 60) return `${totalSeconds} s`;
  if (totalSeconds <= 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
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

/** O protocolo guarda a duração em segundos (`durationSeconds`); o RT digita em minutos. */
function secondsToMinutes(seconds: number): number {
  return Math.round((seconds / 60) * 100) / 100;
}

function minutesToSeconds(minutes: number): number {
  return Math.round(minutes * 60);
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

function issueText(entry: unknown): string {
  if (typeof entry === 'object' && entry !== null) {
    const { detail, message } = entry as { detail?: unknown; message?: unknown };
    if (typeof detail === 'string') return detail;
    if (typeof message === 'string') return message;
  }
  return String(entry);
}

function validationMessages(error: unknown): string[] {
  if (error instanceof DashboardApiError && Array.isArray(error.details)) {
    return error.details.map(issueText).slice(0, 6);
  }
  if (error instanceof DashboardApiError && typeof error.details === 'object' && error.details) {
    const issues = (error.details as { issues?: unknown }).issues;
    if (Array.isArray(issues)) return issues.map(issueText).slice(0, 6);
  }
  return [error instanceof Error ? error.message : 'Não foi possível salvar o protocolo.'];
}

/**
 * Troca o exercício pela opção do catálogo: id e nome oficiais, e a forma de medir do
 * catálogo (repetições × tempo) quando a do item atual não combina. O vídeo curado é
 * resolvido no servidor a partir do id.
 */
function catalogSelectionPatch(
  exercise: ProtocolExercise,
  option: ExerciseCatalogOption,
): Partial<ProtocolExercise> {
  const patch: Partial<ProtocolExercise> = {
    exerciseId: option.id,
    name: option.name,
    videoUrl: undefined,
  };
  if (option.measurement === 'DURATION' && exercise.durationSeconds === undefined) {
    return { ...patch, reps: undefined, durationSeconds: option.pattern === 'CARDIO' ? 600 : 30 };
  }
  if (option.measurement === 'REPS' && exercise.durationSeconds !== undefined) {
    return { ...patch, durationSeconds: undefined, reps: { min: 8, max: 12 } };
  }
  return patch;
}

/** Nome legível de cada regra apontada pelo servidor (o `detail` traz o caso concreto). */
const RULE_LABELS: Record<string, string> = {
  EXERCISE_UNKNOWN: 'Exercício fora do catálogo',
  EXERCISE_CONTRAINDICATED: 'Contraindicação do catálogo para este aluno',
  EXERCISE_LEVEL_TOO_HIGH: 'Exercício acima do nível do aluno',
  ISOLATION_AS_BASE: 'Isolados como base da sessão',
  SPLIT_LEVEL_NOT_ALLOWED: 'Divisão acima do nível do aluno',
  SPLIT_FREQUENCY_MISMATCH: 'Divisão incompatível com a frequência',
  TECHNIQUE_LEVEL_NOT_ALLOWED: 'Técnica avançada para iniciante',
  TECHNIQUE_OVERUSE: 'Técnica avançada em excesso',
  PARQ_PHASE_CAP_EXCEEDED: 'Fase acima do modo conservador (PAR-Q)',
  PARQ_RIR_TOO_LOW: 'RIR abaixo do piso do modo conservador (PAR-Q)',
  PARQ_VIOLATION: 'Modo conservador do PAR-Q',
  PHASE_DURATION_OUT_OF_RANGE: 'Duração do mesociclo fora da faixa da fase',
  SESSION_COUNT_MISMATCH: 'Menos sessões que os dias disponíveis',
  WEEKLY_SESSIONS_EXCEED_AVAILABILITY: 'Mais sessões que os dias disponíveis do aluno',
  WEEKLY_FREQUENCY_INCONSISTENT: 'Frequência semanal diferente do número de sessões',
  DUPLICATE_WEEKDAY: 'Duas sessões no mesmo dia',
  WEEKDAY_MISMATCH: 'Dias da semana',
};

function conflictText(conflict: Pick<ProtocolConflict, 'rule' | 'detail'>): string {
  const label = RULE_LABELS[conflict.rule];
  return label ? `${label}: ${conflict.detail}` : conflict.detail;
}

/** Divergências das regras automáticas que o profissional reconhece como decisão própria. */
function ProfessionalDecision({
  conflicts,
  acknowledged,
  onAcknowledgedChange,
  id,
}: {
  conflicts: readonly ProtocolConflict[];
  acknowledged: boolean;
  onAcknowledgedChange: (value: boolean) => void;
  id: string;
}) {
  return (
    <div className="mt-4 rounded-lg border border-coral bg-background p-4 text-left">
      <p className="text-label font-semibold">Divergências das regras automáticas</p>
      <p className="mt-1 text-xs text-muted-foreground">
        A prescrição é sua. As regras abaixo foram feitas para a geração automática e não bloqueiam
        a sua decisão, mas ela fica registrada na auditoria.
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-label">
        {conflicts.map((conflict) => (
          <li key={conflict.key}>{conflictText(conflict)}</li>
        ))}
      </ul>
      <label htmlFor={id} className="mt-3 flex items-start gap-2 text-label font-medium">
        <input
          id={id}
          type="checkbox"
          className="mt-1 size-4 shrink-0 accent-primary"
          checked={acknowledged}
          onChange={(event) => onAcknowledgedChange(event.target.checked)}
        />
        Confirmo que avaliei o caso e mantenho esta prescrição como decisão profissional minha.
      </label>
    </div>
  );
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
  protocolId,
  canRemove,
  onUpdate,
  onSelectCatalog,
  onPendingChange,
  onRemove,
  onAddWarmupBlock,
  onUpdateWarmupBlock,
  onRemoveWarmupBlock,
}: {
  exercise: ProtocolExercise;
  sessionIndex: number;
  exerciseIndex: number;
  protocolId: string;
  canRemove: boolean;
  onUpdate: (sessionIndex: number, exerciseIndex: number, patch: Partial<ProtocolExercise>) => void;
  onSelectCatalog: (
    sessionIndex: number,
    exerciseIndex: number,
    option: ExerciseCatalogOption,
  ) => void;
  /** Texto digitado no autocomplete que ainda não virou seleção (bloqueia o salvar). */
  onPendingChange: (key: string, pending: boolean) => void;
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
          <ExerciseCatalogPicker
            exerciseId={exercise.exerciseId}
            name={exercise.name}
            protocolId={protocolId}
            onSelect={(option) => onSelectCatalog(sessionIndex, exerciseIndex, option)}
            onPendingChange={(pending) =>
              onPendingChange(`${sessionIndex}:${exercise.exerciseId}`, pending)
            }
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

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
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
        <MiniField label="Técnica">
          <ComboboxField
            id={`technique-${exercise.exerciseId}`}
            label="Técnica avançada"
            items={TECHNIQUE_ITEMS}
            value={exercise.technique ?? NONE_TECHNIQUE}
            className="[&>span]:sr-only"
            onChange={(technique) =>
              update({ technique: technique === NONE_TECHNIQUE ? undefined : technique })
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
                  durationSeconds: mode === 'duration' ? 600 : undefined,
                })
              }
            />
            {isDuration ? (
              <NumberField
                className="w-28"
                min={0.1}
                step={0.5}
                inputMode="decimal"
                value={numberInputValue(secondsToMinutes(exercise.durationSeconds ?? 0))}
                aria-label="Duração (min)"
                onChange={(value) => update({ durationSeconds: minutesToSeconds(Number(value)) })}
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
                        durationSeconds: mode === 'duration' ? 300 : undefined,
                      })
                    }
                  />
                  {blockIsDuration ? (
                    <NumberField
                      className="w-20"
                      min={0.1}
                      step={0.5}
                      inputMode="decimal"
                      value={numberInputValue(secondsToMinutes(block.durationSeconds ?? 0))}
                      aria-label={`Duração do bloco de aquecimento ${blockIndex + 1} (min)`}
                      onChange={(value) =>
                        onUpdateWarmupBlock(sessionIndex, exerciseIndex, blockIndex, {
                          durationSeconds: minutesToSeconds(Number(value)),
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

function SortableExerciseRow({
  exercise,
  position,
}: {
  exercise: ProtocolExercise;
  position: number;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: exercise.exerciseId });
  const label = exercise.name || 'Exercício sem nome';

  return (
    <li
      ref={setNodeRef}
      style={{
        // Só o eixo vertical: a lista é uma coluna, arrastar pro lado não muda nada.
        transform: CSS.Transform.toString(transform ? { ...transform, x: 0 } : null),
        transition,
      }}
      className={cn(
        'flex items-center gap-3 rounded-lg border border-border bg-card p-3',
        isDragging && 'relative z-10 border-ring shadow-lg',
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Arrastar "${label}" (posição ${position})`}
        title="Arraste, ou use espaço e as setas do teclado"
        className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring active:cursor-grabbing"
      >
        <GripVertical aria-hidden="true" className="size-4" />
      </button>
      <span className="w-5 shrink-0 font-mono text-xs text-muted-foreground">{position}</span>
      <span className="min-w-0 flex-1 truncate text-label font-medium">{label}</span>
    </li>
  );
}

/**
 * Modo "Reordenar": no lugar dos cards (altos demais pra arrastar), uma lista compacta de
 * uma linha por exercício. Mouse/toque pelo `PointerSensor` e teclado pelo `KeyboardSensor`
 * (espaço pega, setas movem, espaço solta) — a mesma ordem que o aluno vai ver no treino.
 */
function ExerciseReorderList({
  exercises,
  sessionNumber,
  onMove,
}: {
  exercises: ProtocolExercise[];
  sessionNumber: number;
  onMove: (from: number, to: number) => void;
}) {
  const sensors = useSensors(
    // 4px de tolerância: um clique simples no handle não vira arrasto sem querer.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = exercises.findIndex((exercise) => exercise.exerciseId === active.id);
    const to = exercises.findIndex((exercise) => exercise.exerciseId === over.id);
    if (from !== -1 && to !== -1) onMove(from, to);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext
        items={exercises.map((exercise) => exercise.exerciseId)}
        strategy={verticalListSortingStrategy}
      >
        <ol
          aria-label={`Ordem dos exercícios — sessão ${sessionNumber}`}
          className="flex flex-col gap-2"
        >
          {exercises.map((exercise, exerciseIndex) => (
            <SortableExerciseRow
              key={exercise.exerciseId}
              exercise={exercise}
              position={exerciseIndex + 1}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
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
  onSaved: (result: ActionResult) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProtocolStructure>(() => structuredClone(protocol.content));
  const [reorderingSession, setReorderingSession] = useState<number | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [anamnesisOpen, setAnamnesisOpen] = useState(false);
  const [amendmentReason, setAmendmentReason] = useState('');
  // Autocomplete com texto digitado que ainda não virou seleção do catálogo (chave por item).
  const [pendingPicks, setPendingPicks] = useState<ReadonlySet<string>>(() => new Set());
  // Divergências das regras automáticas devolvidas ao publicar uma atualização: o RT as
  // reconhece como decisão própria e publica de novo (achado 2026-10-15).
  const [decisionConflicts, setDecisionConflicts] = useState<ProtocolConflict[]>([]);
  const [decisionAcknowledged, setDecisionAcknowledged] = useState(false);
  const isActiveProtocol = protocol.status === 'ACTIVE' && Boolean(protocol.signatureHash);
  const availability = protocol.review?.availability;

  function resetEditorState() {
    setReorderingSession(null);
    setIssues([]);
    setAmendmentReason('');
    setPendingPicks(new Set());
    setDecisionConflicts([]);
    setDecisionAcknowledged(false);
  }

  function startEdit() {
    setDraft(structuredClone(protocol.content));
    resetEditorState();
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    resetEditorState();
  }

  const markPending = useCallback((key: string, pending: boolean) => {
    setPendingPicks((current) => {
      if (current.has(key) === pending) return current;
      const next = new Set(current);
      if (pending) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  function selectCatalogExercise(
    sessionIndex: number,
    exerciseIndex: number,
    option: ExerciseCatalogOption,
  ) {
    const session = draft.sessions[sessionIndex];
    const current = session?.exercises[exerciseIndex];
    if (!session || !current) return;
    if (session.exercises.some((ex, i) => i !== exerciseIndex && ex.exerciseId === option.id)) {
      setIssues([`"${option.name}" já está nesta sessão. Escolha outro exercício.`]);
      return;
    }
    setIssues([]);
    updateExercise(sessionIndex, exerciseIndex, catalogSelectionPatch(current, option));
  }

  /** `protocolSessionSchema` — até 7 sessões, uma por dia; o RT escolhe os exercícios. */
  function addSession() {
    setDraft((current) => ({
      ...current,
      sessions: [
        ...current.sessions,
        {
          dayLabel: `Treino ${String.fromCharCode(65 + current.sessions.length)}`,
          focus: 'Novo treino',
          exercises: [blankExercise()],
        },
      ],
    }));
  }

  function removeSession(index: number) {
    setReorderingSession(null);
    setDraft((current) => ({
      ...current,
      sessions: current.sessions.filter((_, position) => position !== index),
    }));
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

  function moveExercise(sessionIndex: number, from: number, to: number) {
    setDraft((current) => ({
      ...current,
      sessions: current.sessions.map((session, position) =>
        position === sessionIndex
          ? { ...session, exercises: arrayMove(session.exercises, from, to) }
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
    // Exercício só entra no protocolo escolhido no catálogo oficial (achado 2026-10-15):
    // texto digitado sem seleção nunca vira prescrição em silêncio.
    if (pendingPicks.size > 0) {
      setIssues([
        'Há exercício digitado sem seleção: escolha uma opção da lista do catálogo (Esc mantém o exercício atual).',
      ]);
      return;
    }
    const unlinked = draft.sessions.flatMap((session, index) =>
      session.exercises
        .filter((exercise) => isUnlinkedExerciseId(exercise.exerciseId) || !exercise.name.trim())
        .map(
          (exercise) =>
            `Selecione no catálogo o exercício de "${session.dayLabel || `Sessão ${index + 1}`}"${
              exercise.name.trim() ? ` (hoje "${exercise.name.trim()}")` : ''
            }.`,
        ),
    );
    if (unlinked.length > 0) {
      setIssues(unlinked.slice(0, 6));
      return;
    }
    // Dia da semana é tudo ou nada: sessão sem dia no meio de sessões com dia nunca entra no
    // calendário do aluno do jeito que o profissional espera.
    const withDay = draft.sessions.filter((session) => session.weekday !== undefined).length;
    if (withDay > 0 && withDay < draft.sessions.length) {
      setIssues(['Defina o dia da semana de todas as sessões.']);
      return;
    }
    // Com dia fixo em todas as sessões, a frequência é o número de sessões — nunca um número
    // solto que esconda treino a mais ou a menos do calendário do aluno.
    const fixedDays = withDay === draft.sessions.length;
    const candidate = fixedDays ? { ...draft, weeklyFrequency: draft.sessions.length } : draft;
    const parsed = protocolStructureSchema.safeParse(candidate);
    if (!parsed.success) {
      setIssues(parsed.error.issues.map((issue) => issue.message).slice(0, 6));
      return;
    }
    const weeklySessions = fixedDays ? parsed.data.sessions.length : parsed.data.weeklyFrequency;
    if (availability?.daysPerWeek && weeklySessions > availability.daysPerWeek) {
      setIssues([
        `O aluno tem ${availability.daysPerWeek} dia(s) disponível(is) por semana e o protocolo ficaria com ${weeklySessions} sessões. Remova ou junte sessões.`,
      ]);
      return;
    }
    if (isActiveProtocol && amendmentReason.trim().length < 3) {
      setIssues(['Informe o motivo da atualização manual.']);
      return;
    }
    if (decisionConflicts.length > 0 && !decisionAcknowledged) {
      setIssues(['Confirme as divergências como decisão profissional sua para publicar.']);
      return;
    }
    setPending(true);
    try {
      const result = isActiveProtocol
        ? await amendActiveProtocol(protocol.id, {
            content: parsed.data,
            expectedVersion: protocol.version,
            reason: amendmentReason.trim(),
            confirmation: true,
            ...(decisionAcknowledged && decisionConflicts.length > 0
              ? { acknowledgedConflicts: decisionConflicts.map((conflict) => conflict.key) }
              : {}),
          })
        : await saveProtocol(protocol.id, parsed.data);
      captureDashboardEvent(isActiveProtocol ? 'cref_protocol_amended' : 'cref_protocol_edited');
      setEditing(false);
      resetEditorState();
      await onSaved(result);
    } catch (error) {
      if (
        error instanceof DashboardApiError &&
        error.code === 'PROFESSIONAL_DECISION_REQUIRED' &&
        error.conflicts.length > 0
      ) {
        setDecisionConflicts(error.conflicts);
        setDecisionAcknowledged(false);
        return;
      }
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
              {draft.sessions.every((session) => session.weekday !== undefined) ? (
                <p className="self-end pb-2 text-label text-muted-foreground">
                  Frequência semanal:{' '}
                  <span className="font-semibold text-foreground">{draft.sessions.length}x</span>{' '}
                  (uma sessão por dia definido)
                </p>
              ) : (
                <ChipGroupField
                  label="Frequência semanal"
                  items={WEEKLY_FREQUENCY_ITEMS}
                  value={String(draft.weeklyFrequency)}
                  onChange={(value) =>
                    setDraft((current) => ({ ...current, weeklyFrequency: Number(value) }))
                  }
                />
              )}
            </div>
          ) : (
            <p className="mt-1 text-label text-muted-foreground">
              {PHASE_LABELS[protocol.content.phase] ?? protocol.content.phase} ·{' '}
              {protocol.content.weeklyFrequency}x por semana · duração:{' '}
              {protocol.totalWeeks === 1 ? '1 semana' : `${protocol.totalWeeks} semanas`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setAnamnesisOpen(true)}
            aria-label="Ver respostas da anamnese"
            title="Ver respostas da anamnese"
          >
            <Eye aria-hidden="true" className="size-4" />
          </Button>
          {editing ? (
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={() => void save()} disabled={pending}>
                <Save aria-hidden="true" className="size-4" />{' '}
                {pending
                  ? 'Validando…'
                  : isActiveProtocol
                    ? 'Salvar e publicar atualização'
                    : 'Salvar'}
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
      </div>
      <AnamnesisAnswersModal
        kind="PROTOCOL"
        id={protocol.id}
        open={anamnesisOpen}
        onOpenChange={setAnamnesisOpen}
      />

      {editing && isActiveProtocol ? (
        <div className="mt-4 rounded-lg border border-border bg-secondary/30 p-4">
          <label htmlFor="protocol-amendment-reason" className="text-label font-semibold">
            Motivo da atualização
          </label>
          <TextAreaField
            id="protocol-amendment-reason"
            className="mt-2"
            value={amendmentReason}
            maxLength={500}
            onChange={setAmendmentReason}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            A publicação criará a versão {protocol.version + 1}, manterá o histórico e reenviará o
            protocolo ao aluno.
          </p>
        </div>
      ) : null}

      {availability?.daysPerWeek ? (
        <p className="mt-4 rounded-lg bg-secondary p-3 text-label text-secondary-foreground">
          <span className="font-semibold">Disponibilidade do aluno:</span>{' '}
          {availability.daysPerWeek} dia(s) por semana
          {availability.preferredDays.length > 0
            ? ` · prefere ${availability.preferredDays
                .map((day) => WEEKDAY_LABELS[day] ?? day)
                .join(', ')}`
            : ''}
          . As sessões nunca passam dessa quantidade.
        </p>
      ) : null}

      {!editing && protocol.review?.origin === 'AI' && protocol.review.qualityNotices?.length ? (
        <div className="mt-4 rounded-lg border border-coral p-4" role="note">
          <p className="text-label font-semibold">Qualidade contextual do rascunho</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Conferência da metodologia vigente em conjunto com o perfil do aluno. A decisão final é
            do profissional CREF; esta avaliação não comprova segurança individual.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-label">
            {protocol.review.qualityNotices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {!editing && protocol.review && protocol.review.blocking.length > 0 ? (
        <div
          role="alert"
          className="mt-4 rounded-lg bg-destructive p-4 text-destructive-foreground"
        >
          <p className="text-label font-semibold">Corrija antes de assinar ou publicar:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-label">
            {protocol.review.blocking.map((violation) => (
              <li key={violation.key}>{conflictText(violation)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {!editing && protocol.review && protocol.review.conflicts.length > 0 ? (
        <div className="mt-4 rounded-lg border border-coral p-4">
          <p className="text-label font-semibold">
            Prescrição sua com divergências das regras automáticas
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-label">
            {protocol.review.conflicts.map((conflict) => (
              <li key={conflict.key}>{conflictText(conflict)}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Elas não bloqueiam a sua decisão: você as confirma ao assinar e o registro fica na
            auditoria.
          </p>
        </div>
      ) : null}

      {editing && decisionConflicts.length > 0 ? (
        <ProfessionalDecision
          id="protocol-amend-decision"
          conflicts={decisionConflicts}
          acknowledged={decisionAcknowledged}
          onAcknowledgedChange={setDecisionAcknowledged}
        />
      ) : null}

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
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <ComboboxField
                    id={`session-weekday-${index}`}
                    label="Dia da semana"
                    items={WEEKDAY_ITEMS}
                    value={session.weekday as Weekday}
                    placeholder="Escolha o dia"
                    className="w-44"
                    onChange={(weekday) => updateSession(index, { weekday })}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={content.sessions.length < 2}
                      onClick={() => removeSession(index)}
                      title={
                        content.sessions.length < 2
                          ? 'O protocolo precisa de pelo menos uma sessão'
                          : 'Remover esta sessão'
                      }
                    >
                      <Trash2 aria-hidden="true" className="size-4 text-destructive" /> Remover
                      sessão
                    </Button>
                    <Button
                      type="button"
                      variant={reorderingSession === index ? 'default' : 'ghost'}
                      size="sm"
                      disabled={session.exercises.length < 2}
                      aria-pressed={reorderingSession === index}
                      onClick={() =>
                        setReorderingSession(reorderingSession === index ? null : index)
                      }
                      title={
                        session.exercises.length < 2
                          ? 'A sessão precisa de pelo menos dois exercícios para reordenar'
                          : 'Arraste os exercícios para mudar a ordem'
                      }
                    >
                      <ArrowDownUp aria-hidden="true" className="size-4" />{' '}
                      {reorderingSession === index ? 'Concluir ordem' : 'Reordenar exercícios'}
                    </Button>
                  </div>
                </div>
                {reorderingSession === index ? (
                  <ExerciseReorderList
                    exercises={session.exercises}
                    sessionNumber={index + 1}
                    onMove={(from, to) => moveExercise(index, from, to)}
                  />
                ) : (
                  session.exercises.map((exercise, exerciseIndex) => (
                    <ExerciseEditorCard
                      key={exercise.exerciseId}
                      exercise={exercise}
                      sessionIndex={index}
                      exerciseIndex={exerciseIndex}
                      protocolId={protocol.id}
                      canRemove={session.exercises.length > 1}
                      onUpdate={updateExercise}
                      onSelectCatalog={selectCatalogExercise}
                      onPendingChange={markPending}
                      onRemove={removeExercise}
                      onAddWarmupBlock={addWarmupBlock}
                      onUpdateWarmupBlock={updateWarmupBlock}
                      onRemoveWarmupBlock={removeWarmupBlock}
                    />
                  ))
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={session.exercises.length >= 15 || reorderingSession === index}
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
                {/* Achado 2026-09-02: cada sessão tem sua PRÓPRIA <table>, e sem largura de
                    coluna fixa o navegador calcula cada uma com base só no conteúdo daquela
                    tabela — nomes de exercício mais longos numa sessão empurravam as colunas
                    seguintes, então "Séries"/"Descanso"/etc. ficavam em posições X diferentes
                    entre uma sessão e outra. `table-fixed` + largura em % igual em toda tabela
                    (mesmo container pai, mesma largura disponível) alinha as colunas entre
                    TODAS as sessões da tela, não só dentro de uma. */}
                <table className="w-full min-w-[44rem] table-fixed border-collapse text-left text-label">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th scope="col" className="w-[27%] p-2 font-semibold">
                        Exercício
                      </th>
                      <th scope="col" className="w-[7%] p-2 font-semibold">
                        Séries
                      </th>
                      <th scope="col" className="w-[12%] p-2 font-semibold">
                        Repetições / Duração
                      </th>
                      <th scope="col" className="w-[12%] p-2 font-semibold">
                        Descanso
                      </th>
                      <th scope="col" className="w-[6%] p-2 font-semibold">
                        RIR
                      </th>
                      <th scope="col" className="w-[12%] p-2 font-semibold">
                        Técnica
                      </th>
                      <th scope="col" className="w-[13%] p-2 font-semibold">
                        Estratégia
                      </th>
                      <th scope="col" className="w-[11%] p-2 font-semibold">
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
                                    ? `${block.sets}×${formatDurationLabel(block.durationSeconds)}`
                                    : `${block.sets}×${block.reps?.min}–${block.reps?.max}`,
                                )
                                .join(', ')}
                            </span>
                          ) : null}
                        </td>
                        <td className="p-2 font-mono">{exercise.sets}</td>
                        <td className="p-2 font-mono">
                          {exercise.durationSeconds !== undefined
                            ? formatDurationLabel(exercise.durationSeconds)
                            : exercise.reps
                              ? `${exercise.reps.min}–${exercise.reps.max}`
                              : ''}
                        </td>
                        <td className="p-2 font-mono">
                          {formatDurationLabel(exercise.restSeconds)}
                        </td>
                        <td className="p-2 font-mono">{exercise.rir ?? '—'}</td>
                        <td className="p-2 text-xs">
                          {exercise.technique ? ADVANCED_TECHNIQUE_LABELS[exercise.technique] : '—'}
                        </td>
                        <td className="p-2 text-xs">
                          {LOAD_STRATEGY_LABELS[exercise.loadStrategy]}
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
        {editing ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              content.sessions.length >= 7 ||
              (availability?.daysPerWeek
                ? content.sessions.length >= availability.daysPerWeek
                : false)
            }
            onClick={addSession}
            title={
              availability?.daysPerWeek && content.sessions.length >= availability.daysPerWeek
                ? 'O protocolo já tem uma sessão por dia disponível do aluno'
                : 'Adicionar sessão'
            }
          >
            <Plus aria-hidden="true" className="size-4" /> Adicionar sessão
          </Button>
        ) : null}
      </div>
      {editing ? (
        <label className="mt-5 flex flex-col gap-2 text-label font-semibold">
          Observações gerais
          <TextAreaField
            className="min-h-28 py-2"
            value={draft.generalNotes ?? ''}
            maxLength={1000}
            onChange={(value) =>
              setDraft((current) => ({ ...current, generalNotes: value || undefined }))
            }
            aria-describedby={issues.length > 0 ? 'protocol-editor-issues' : undefined}
          />
        </label>
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

  /**
   * Resumo compacto (rótulo curto por pergunta, não a pergunta inteira — achado
   * 2026-09-03, a pedido do fundador). Percorre `PARQ_QUESTION_IDS` em vez do array de
   * respostas cru: normaliza a ORDEM (sempre Q1→Q9, independente de como a API devolveu)
   * e a leitura do booleano (`=== true`, nunca truthy de um valor inesperado).
   */
  const riskFactors = answers?.health.parq
    ? PARQ_QUESTION_IDS.filter(
        (questionId) =>
          answers.health.parq?.answers.find((answer) => answer.questionId === questionId)
            ?.answer === true,
      ).map((questionId) => PARQ_RISK_FACTOR_LABEL[questionId])
    : [];

  return (
    <header className="mt-5 rounded-xl border border-border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1 font-bold">Protocolo para Revisão</h1>
        {protocol.isFallback ? (
          <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-medium text-destructive-foreground">
            Protocolo Fallback
          </span>
        ) : null}
      </div>
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
                  ? riskFactors.join(', ')
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

/**
 * Detalhe de um item da Fila do Profissional (protocolo ou substituição). Alertas do AI Coach e
 * check-ins têm tela própria em `alert-detail.tsx`.
 */
export function QueueDetail({ kind, id }: { kind: 'PROTOCOL' | 'SUBSTITUTION'; id: string }) {
  const returnHref = '/dashboard/educacao-fisica';
  const [detail, setDetail] = useState<QueueDetailType | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  // Item da proposta cujo exercício está sendo adicionado ao catálogo (`null` = diálogo fechado).
  const [catalogGapItem, setCatalogGapItem] = useState<number | null>(null);
  // Rascunho das decisões do profissional por item (troca em lote). Recomeça a cada carga do
  // detalhe: depois de aprovar/adicionar ao catálogo o servidor é a fonte de verdade.
  const [itemDrafts, setItemDrafts] = useState<ItemDrafts>({});
  // Reconhecimento das divergências da prescrição do profissional na assinatura. Recomeça a
  // cada carga: uma divergência nova nunca herda a confirmação de outra.
  const [signAcknowledged, setSignAcknowledged] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError('');
      try {
        setDetail(await getQueueDetail(kind, id, signal));
        setItemDrafts({});
        setSignAcknowledged(false);
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

  // Protocolo ou troca de exercício com envio automático agendado: enquanto esta tela está
  // aberta o envio espera, mesmo que o prazo (1h / 30 min) venza; ao sair, o que venceu é
  // enviado na hora. Silencioso de propósito: a tela do protocolo opcional e a do obrigatório
  // são idênticas (ver os testes de paridade), então não há faixa nem aviso só para um caso.
  const holdKind = kind === 'SUBSTITUTION' ? 'SUBSTITUTION' : 'PROTOCOL';
  const awaitingAutoRelease =
    (kind === 'PROTOCOL' || kind === 'SUBSTITUTION') && Boolean(detail?.item.autoReleaseAt);
  useReviewHold(holdKind, id, awaitingAutoRelease);
  useMarkNotificationRead(
    kind === 'SUBSTITUTION' ? 'substitution' : 'protocol',
    id,
    Boolean(detail),
  );

  async function runAction(action: () => Promise<unknown>, event: string, message: string) {
    await action();
    captureDashboardEvent(event, { kind });
    setSuccess(message);
    await load();
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

  const signConflicts = detail.protocol?.review?.conflicts ?? [];
  const signBlocking = detail.protocol?.review?.blocking ?? [];

  return (
    <article>
      <Link
        href={returnHref}
        className="inline-flex min-h-11 items-center gap-2 text-label font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" /> Voltar para a Fila do Profissional
      </Link>
      <p className="mt-2 text-xs font-medium text-muted-foreground">
        Fila do Profissional · Notificação
      </p>

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
            onSaved={async (result) => {
              // A prescrição do profissional foi gravada. Divergências das regras automáticas
              // não bloqueiam: ele as confirma como decisão própria na assinatura.
              const conflicts = result.conflicts ?? [];
              setSuccess(
                conflicts.length > 0
                  ? `Alterações salvas. Ao assinar, confirme as divergências das regras automáticas: ${conflicts
                      .map(conflictText)
                      .join('; ')}.`
                  : 'Edição validada no servidor e registrada para revisão.',
              );
              await load();
            }}
          />
        ) : null}
        {detail.substitution ? (
          <SubstitutionItemsReview
            substitution={detail.substitution}
            drafts={itemDrafts}
            onChange={(index: number, draft: ItemDraft) =>
              setItemDrafts((current) => ({ ...current, [index]: draft }))
            }
            onAddCatalog={setCatalogGapItem}
          />
        ) : null}

        {detail.replay ? <ConversationReplay replay={detail.replay} /> : null}

        {/* Achado 2026-08-19: pra protocolo, "Contexto autorizado" só repetia a versão
            (já no título) e um `humanReviewRequired` sempre `true` — sem valor pro RT. Mesma
            razão pra substituição (2026-09-02): `context` sempre vem vazio, o que importa
            já está em `SubstitutionSummary`. */}
        {kind === 'PROTOCOL' && detail.protocol && !detail.protocol.signatureHash ? (
          <div className="flex justify-end">
            <ConfirmAction
              triggerLabel="Assinar e liberar"
              title="Confirmar assinatura deste conteúdo?"
              description="Revise o protocolo completo. A confirmação registra sua conta, o horário e o hash exato desta versão."
              confirmLabel="Confirmar e assinar"
              disabled={signBlocking.length > 0}
              confirmDisabled={signConflicts.length > 0 && !signAcknowledged}
              onConfirm={() =>
                runAction(
                  () =>
                    signProtocol(
                      detail.protocol?.id ?? id,
                      signAcknowledged ? signConflicts.map((conflict) => conflict.key) : [],
                    ),
                  'cref_protocol_signed',
                  'Protocolo assinado e auditoria registrada.',
                )
              }
            >
              {signConflicts.length > 0 ? (
                <ProfessionalDecision
                  id="protocol-sign-decision"
                  conflicts={signConflicts}
                  acknowledged={signAcknowledged}
                  onAcknowledgedChange={setSignAcknowledged}
                />
              ) : null}
            </ConfirmAction>
          </div>
        ) : null}

        {kind === 'SUBSTITUTION' && detail.substitution?.status === 'PENDING'
          ? (() => {
              const substitution = detail.substitution;
              const unresolved = unresolvedItemIndexes(substitution, itemDrafts);
              const everyItemDiscarded = allItemsDiscarded(substitution, itemDrafts);
              const multiple = substitution.items.length > 1;
              return (
                <div className="space-y-3">
                  {unresolved.length > 0 ? (
                    <p role="note" className="text-label text-muted-foreground">
                      {unresolved.length > 1
                        ? 'Há pedidos de exercício fora do catálogo: adicione-os ao catálogo ou descarte esses itens para aprovar.'
                        : 'O exercício pedido está fora do catálogo: adicione-o ao catálogo ou descarte o item para aprovar.'}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap justify-end gap-3">
                    <ConfirmAction
                      triggerLabel="Recusar"
                      title={multiple ? 'Recusar todas as trocas?' : 'Recusar esta troca?'}
                      description={
                        multiple
                          ? 'Os exercícios originais são mantidos no protocolo do aluno. Ele será avisado que as trocas não foram aplicadas.'
                          : 'O exercício original é mantido no protocolo do aluno. Ele será avisado que a troca não foi aplicada.'
                      }
                      confirmLabel="Confirmar recusa"
                      destructive
                      onConfirm={() =>
                        runAction(
                          () => discardSubstitution(id),
                          'cref_substitution_discarded',
                          multiple
                            ? 'Trocas recusadas — exercícios originais mantidos.'
                            : 'Troca recusada — exercício original mantido.',
                        )
                      }
                    />
                    {everyItemDiscarded ? null : (
                      <ConfirmAction
                        triggerLabel="Aprovar agora"
                        title={
                          multiple ? 'Aplicar estas trocas agora?' : 'Aplicar esta troca agora?'
                        }
                        description={
                          multiple
                            ? 'As trocas mantidas são aplicadas ao protocolo do aluno imediatamente, sem esperar a liberação automática, com as edições que você fez. Itens descartados não são aplicados. O PDF atualizado é reenviado pelo WhatsApp.'
                            : 'A troca é aplicada ao protocolo do aluno imediatamente, sem esperar a liberação automática, e o PDF atualizado é reenviado pelo WhatsApp.'
                        }
                        confirmLabel="Confirmar e aplicar"
                        disabled={unresolved.length > 0}
                        onConfirm={() =>
                          runAction(
                            () =>
                              approveSubstitutionNow(id, buildItemEdits(substitution, itemDrafts)),
                            'cref_substitution_approved',
                            multiple
                              ? 'Trocas aplicadas e protocolo reenviado.'
                              : 'Troca aplicada e protocolo reenviado.',
                          )
                        }
                      />
                    )}
                  </div>
                </div>
              );
            })()
          : null}

        {catalogGapItem !== null && detail.substitution ? (
          <SubstitutionCatalogGapDialog
            substitutionId={id}
            itemIndex={catalogGapItem}
            requestedName={
              detail.substitution.items.find((item) => item.index === catalogGapItem)?.to.name ??
              detail.substitution.to.name
            }
            onClose={() => setCatalogGapItem(null)}
            onSaved={(message) => {
              setCatalogGapItem(null);
              captureDashboardEvent('cref_substitution_catalog_gap_added', { kind });
              setSuccess(message);
              void load();
            }}
          />
        ) : null}
      </div>
    </article>
  );
}
