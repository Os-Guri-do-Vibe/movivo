'use client';

/**
 * Plano de treino na revisão: a semana simulada, as fases e uma lista de sessões com a MESMA
 * estrutura de cartão (letra, título, tipo, prioridade, frequência · duração · PSE). Exercícios em
 * colunas alinhadas entre todas as sessões (o template da grade é um só). No modo de edição, o
 * mesmo cartão vira campos: reordenar sessões e exercícios (↑/↓, alça, teclado), trocar, adicionar
 * e remover exercício do catálogo, e ajustar séries, repetições/tempo, descanso, RIR e carga.
 * As sessões abrem recolhidas (letra, título e resumo) para reordenar com a lista inteira à vista;
 * o botão do cartão expande os campos e os exercícios da sessão.
 */
import {
  ArrowLeftRight,
  CalendarDays,
  ChevronDown,
  MessageSquarePlus,
  Plus,
  Trash2,
} from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';

import type {
  PlanSession,
  ProtocolReview as Protocol,
  ProtocolWeekModel,
  SessionPriority,
  StrengthExercise,
  TrainingPlanStructure,
  Weekday,
} from '@movivo/shared';

import { Button } from '@/components/ui/button';
import {
  addExercise,
  addStrengthSession,
  canAddStrengthSession,
  exerciseKeys,
  LIMITS,
  moveExercise,
  moveOccurrence,
  removeExercise,
  removeSession,
  replaceExercise,
  swapOccurrences,
  updateExercise,
  updateSession,
  weekLayout,
  WEEKDAYS,
  withFrequency,
  type CatalogOption,
  type DayItem,
  type OccurrenceRef,
} from '@/lib/protocol-edit';
import {
  exerciseExtras,
  hyroxRow,
  LOAD_STRATEGY_LABEL,
  loadLabel,
  muscleLabel,
  PRIORITY_LABEL,
  repsLabel,
  restLabel,
  segmentRow,
  sessionLetter,
  sessionMeta,
  sessionTypeLabel,
  weekDays,
  type SegmentRow,
} from '@/lib/protocol-format';
import { cn } from '@/lib/utils';

import { FOCUS_RING, ICON_BUTTON } from './control-center-table';
import { Disclosure } from './detail-sections';
import { ExercisePicker } from './exercise-picker';
import { NumField, RowIssues, SelectField, TextInput } from './plan-fields';
import { ReorderControls, useDragReorder } from './reorder-controls';
import { DayControls } from './day-controls';

type TrainingProtocol = Extract<Protocol, { kind: 'TRAINING' }>;
export type IssueMap = ReadonlyMap<string, readonly string[]>;

/** Um template de colunas para TODAS as sessões: Séries, Repetições, Descanso e Carga alinhadas. */
const STRENGTH_COLS =
  '@xl:grid-cols-[2rem_minmax(0,1fr)_4.5rem_6rem_6.5rem_8.5rem] @xl:items-baseline';
const ENDURANCE_COLS = '@xl:grid-cols-[2rem_minmax(0,1fr)_9rem_10rem] @xl:items-baseline';
const CELL_LABEL = 'text-muted-foreground @xl:sr-only';

/* -------------------------------------------------------------------------- */
/* Leitura                                                                    */
/* -------------------------------------------------------------------------- */

export function WeekStrip({ preview }: { preview: TrainingProtocol['weekPreview'] }) {
  const days = weekDays(preview);
  return (
    <section aria-labelledby="semana-simulada" className="@container space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="semana-simulada" className="flex items-center gap-2 text-label font-semibold">
          <CalendarDays aria-hidden="true" className="size-4 text-muted-foreground" />
          Primeira semana
        </h3>
        <p className="text-xs text-muted-foreground">
          Simulada a partir de hoje com a disponibilidade do aluno
        </p>
      </div>
      <ol className="grid gap-px overflow-hidden rounded-xl border border-border bg-border @2xl:grid-cols-7">
        {days.map((day) => (
          <li
            key={day.date}
            aria-label={`${day.long}, ${day.dayMonth}`}
            className={cn(
              'grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-3 bg-card px-3 py-2.5 @2xl:min-h-24 @2xl:grid-cols-1 @2xl:gap-1.5',
              day.beforeStart && 'bg-muted/40',
            )}
          >
            <p className="text-xs tabular-nums">
              <span className="font-semibold text-foreground">{day.short}</span>{' '}
              <span className="text-muted-foreground">{day.dayMonth}</span>
            </p>
            {day.beforeStart ? (
              <p className="text-xs text-muted-foreground">Antes do início</p>
            ) : day.sessions.length === 0 ? (
              <p className="text-xs text-muted-foreground">Descanso</p>
            ) : (
              <ul className="space-y-1">
                {day.sessions.map((session) => (
                  <li key={`${session.sessionKey}-${session.slot ?? ''}`} className="text-xs">
                    <span className="block font-medium text-foreground">{session.title}</span>
                    {session.slot ? (
                      <span className="text-muted-foreground">{session.slot}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      {preview.sessions.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhuma sessão coube nesta semana com a disponibilidade atual do aluno.
        </p>
      ) : null}
      {preview.dropped.length > 0 ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {preview.dropped.map((dropped, index) => (
            <li key={`${dropped.sessionKey}-${index}`}>
              <span className="font-medium text-foreground">{dropped.title}</span> ficou fora desta
              semana: {dropped.reason}.
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Phases({ phases }: { phases: TrainingPlanStructure['phases'] }) {
  return (
    <section aria-labelledby="fases-do-plano" className="space-y-2">
      <h3 id="fases-do-plano" className="text-label font-semibold">
        Fases
      </h3>
      <ol className="grid gap-2 @2xl:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
        {phases.map((phase, index) => (
          <li
            key={`${index}-${phase.name}`}
            className="rounded-lg border border-border px-3 py-2 text-xs"
          >
            <p className="flex items-baseline justify-between gap-2">
              <span className="font-medium text-foreground">
                {index + 1}. {phase.name}
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {phase.weeks} {phase.weeks === 1 ? 'semana' : 'semanas'}
              </span>
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {phase.focus}
              {phase.endsWithDeload ? ' Termina com uma semana leve.' : ''}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PriorityTag({ priority }: { priority: SessionPriority }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={cn(
          'size-2 rounded-full',
          priority === 'KEY'
            ? 'bg-foreground'
            : priority === 'IMPORTANT'
              ? 'bg-muted-foreground'
              : 'border border-muted-foreground',
        )}
      />
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

function LetterBadge({ index }: { index: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border font-mono text-label font-semibold"
    >
      {sessionLetter(index)}
    </span>
  );
}

function ColumnsHeader({ cols, labels }: { cols: string; labels: readonly string[] }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'hidden gap-x-3 border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground @xl:grid @xl:px-5',
        cols,
      )}
    >
      {labels.map((text, index) => (
        <span key={`${index}-${text}`}>{text}</span>
      ))}
    </div>
  );
}

function StrengthRows({ exercises }: { exercises: readonly StrengthExercise[] }) {
  return (
    <>
      <ColumnsHeader
        cols={STRENGTH_COLS}
        labels={['#', 'Exercício', 'Séries', 'Repetições', 'Descanso', 'Carga']}
      />
      <ol className="divide-y divide-border">
        {exercises.map((exercise, index) => {
          const extras = exerciseExtras(exercise);
          return (
            <li
              key={`${exercise.exerciseId}-${index}`}
              className={cn(
                'grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-2.5 @xl:px-5',
                STRENGTH_COLS,
              )}
            >
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-label font-medium">{exercise.name}</p>
                {extras.length > 0 || exercise.notes ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[...extras, exercise.notes].filter(Boolean).join(' · ')}
                  </p>
                ) : null}
              </div>
              <div className="col-start-2 flex flex-wrap gap-x-3 text-xs tabular-nums @xl:contents @xl:text-label">
                <span>
                  <span className={CELL_LABEL}>Séries </span>
                  {exercise.sets}
                </span>
                <span>
                  <span className={CELL_LABEL}>
                    {exercise.durationSeconds !== undefined ? 'Tempo ' : 'Repetições '}
                  </span>
                  {repsLabel(exercise)}
                </span>
                <span>
                  <span className={CELL_LABEL}>Descanso </span>
                  {restLabel(exercise.restSeconds)}
                </span>
                <span>
                  <span className={CELL_LABEL}>Carga </span>
                  {loadLabel(exercise)}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function EnduranceRows({ rows, labels }: { rows: readonly SegmentRow[]; labels: string[] }) {
  return (
    <>
      <ColumnsHeader cols={ENDURANCE_COLS} labels={labels} />
      <ol className="divide-y divide-border">
        {rows.map((row, index) => (
          <li
            key={`${index}-${row.label}`}
            className={cn(
              'grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-2.5 @xl:px-5',
              ENDURANCE_COLS,
            )}
          >
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-label font-medium">{row.label}</p>
              {row.notes ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{row.notes}</p>
              ) : null}
            </div>
            <div className="col-start-2 flex flex-wrap gap-x-3 text-xs tabular-nums @xl:contents @xl:text-label">
              <span>
                <span className={CELL_LABEL}>Volume </span>
                {row.volume}
              </span>
              <span>
                <span className={CELL_LABEL}>Intensidade </span>
                {row.target}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

export function SessionContent({ session }: { session: PlanSession }) {
  const { content } = session;
  switch (content.modality) {
    case 'STRENGTH':
      return <StrengthRows exercises={content.exercises} />;
    case 'RUNNING':
      return (
        <EnduranceRows
          rows={content.segments.map(segmentRow)}
          labels={['#', 'Trecho', 'Volume', 'Intensidade']}
        />
      );
    case 'HYROX':
      return (
        <EnduranceRows
          rows={content.blocks.map(hyroxRow)}
          labels={['#', 'Bloco', 'Volume', 'Intensidade']}
        />
      );
    case 'EXTERNAL_SPORT':
      return (
        <p className="px-4 py-3 text-label @xl:px-5">
          Praticado fora da MOVIVO: {content.plannedMinutes} min, PSE {content.plannedRpe}. Só entra
          na conta da carga da semana.
        </p>
      );
  }
}

function SessionCard({
  index,
  session,
  headingId,
  children,
}: {
  index: number;
  session: PlanSession;
  headingId: string;
  children: ReactNode;
}) {
  return (
    <article
      aria-labelledby={headingId}
      className="@container overflow-hidden rounded-xl border border-border bg-card"
    >
      <header className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 px-4 pt-4 pb-3 @2xl:grid-cols-[auto_minmax(0,1fr)_auto] @xl:px-5">
        <LetterBadge index={index} />
        <div className="min-w-0">
          <h3 id={headingId} className="text-body font-semibold">
            {session.title}
          </h3>
          <p className="text-xs text-muted-foreground">{sessionTypeLabel(session)}</p>
        </div>
        <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums @2xl:col-span-1 @2xl:justify-end @2xl:pt-1">
          <PriorityTag priority={session.priority} />
          <span>{sessionMeta(session)}</span>
        </div>
        <p className="col-span-2 text-xs text-muted-foreground @2xl:col-span-3 @2xl:pl-[3.25rem]">
          {session.purpose}
        </p>
      </header>
      <div className="border-t border-border">{children}</div>
    </article>
  );
}

function SessionView({ index, session }: { index: number; session: PlanSession }) {
  const headingId = useId();
  return (
    <SessionCard index={index} session={session} headingId={headingId}>
      <SessionContent session={session} />
    </SessionCard>
  );
}

export function TrainingPlanView({
  protocol,
  compact = false,
}: {
  protocol: TrainingProtocol;
  compact?: boolean;
}) {
  const { structure, weekPreview } = protocol;
  if (compact) {
    const scheduledKeys = new Set<string>();
    const scheduledDays = weekDays(weekPreview)
      .map((day) => ({
        ...day,
        sessions: day.sessions.flatMap((scheduled) => {
          const index = structure.sessions.findIndex(
            (session) => session.key === scheduled.sessionKey,
          );
          const session = structure.sessions[index];
          if (index < 0 || !session) return [];
          scheduledKeys.add(session.key);
          return [{ session, index, slot: scheduled.slot }];
        }),
      }))
      .filter((day) => day.sessions.length > 0);
    const unscheduledSessions = structure.sessions
      .map((session, index) => ({ session, index }))
      .filter(({ session }) => !scheduledKeys.has(session.key));

    return (
      <div className="space-y-4">
        <p className="rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
          Disponibilidade do aluno: sessões distribuídas na primeira semana conforme os horários
          informados.
        </p>
        <section aria-label="Treinos por dia da semana">
          <ol className="space-y-1">
            {scheduledDays.map((day) => (
              <li key={day.date}>
                <Disclosure
                  title={day.long.replace(/^./u, (letter) => letter.toLocaleUpperCase('pt-BR'))}
                  summary={`${day.dayMonth} · ${day.sessions
                    .map(({ session, slot }) =>
                      [session.title, slot, sessionTypeLabel(session)].filter(Boolean).join(' · '),
                    )
                    .join(' | ')}`}
                  className="rounded-lg border border-border px-3 first:border-t"
                >
                  <ol className="space-y-3">
                    {day.sessions.map(({ session, index }, occurrence) => (
                      <li key={`${session.key}-${day.date}-${occurrence}`}>
                        <SessionView index={index} session={session} />
                      </li>
                    ))}
                  </ol>
                </Disclosure>
              </li>
            ))}
          </ol>
        </section>
        {unscheduledSessions.length > 0 ? (
          <Disclosure
            title="Outras sessões do protocolo"
            summary={`${unscheduledSessions.length} sem horário nesta semana`}
          >
            <ol className="space-y-3">
              {unscheduledSessions.map(({ session, index }) => (
                <li key={session.key}>
                  <SessionView index={index} session={session} />
                </li>
              ))}
            </ol>
          </Disclosure>
        ) : null}
        <Disclosure
          title="Semana simulada"
          summary={`${weekPreview.sessions.length} sessões programadas`}
        >
          <WeekStrip preview={weekPreview} />
        </Disclosure>
        <Disclosure title="Fases" summary={`${structure.phases.length} fases`}>
          <Phases phases={structure.phases} />
        </Disclosure>
        <section className="rounded-lg bg-secondary/60 px-4 py-3">
          <h3 className="text-xs font-medium text-muted-foreground">Observações do protocolo</h3>
          <p className="mt-1 whitespace-pre-line text-label">{structure.summary}</p>
        </section>
      </div>
    );
  }
  return (
    <div className="space-y-8">
      <p className="max-w-prose text-label text-muted-foreground">{structure.summary}</p>
      <WeekStrip preview={weekPreview} />
      <section aria-labelledby="sessoes-do-plano" className="space-y-3">
        <h3 id="sessoes-do-plano" className="text-label font-semibold">
          Sessões
        </h3>
        <ol className="space-y-3">
          {structure.sessions.map((session, index) => (
            <li key={session.key}>
              <SessionView index={index} session={session} />
            </li>
          ))}
        </ol>
      </section>
      <Phases phases={structure.phases} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Edição                                                                     */
/* -------------------------------------------------------------------------- */

type Change = (structure: TrainingPlanStructure, structural?: boolean) => void;

const PRIORITY_OPTIONS = (['KEY', 'IMPORTANT', 'COMPLEMENTARY'] as const).map((value) => ({
  value,
  label: PRIORITY_LABEL[value],
}));
const LOAD_OPTIONS = (Object.keys(LOAD_STRATEGY_LABEL) as StrengthExercise['loadStrategy'][]).map(
  (value) => ({ value, label: LOAD_STRATEGY_LABEL[value] }),
);

type PickerState =
  | { mode: 'add'; sessionIndex: number }
  | { mode: 'replace'; sessionIndex: number; exerciseIndex: number }
  | { mode: 'session' }
  | null;

const ICON = cn(
  FOCUS_RING,
  ICON_BUTTON,
  'inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-30',
);

const DAY_LABEL: Readonly<Record<Weekday, string>> = {
  MON: 'Segunda-feira',
  TUE: 'Terça-feira',
  WED: 'Quarta-feira',
  THU: 'Quinta-feira',
  FRI: 'Sexta-feira',
  SAT: 'Sábado',
  SUN: 'Domingo',
};
const NO_DAY = 'NONE';
const DAY_OPTIONS = [
  { value: NO_DAY, label: 'Escolha o dia' },
  ...WEEKDAYS.map((value) => ({ value, label: DAY_LABEL[value] })),
];

const refId = (ref: OccurrenceRef) => `occ-${ref.key}-${ref.occurrence}`;

export function TrainingPlanEditor({
  structure,
  weekModel,
  options,
  issues,
  onChange,
  announce,
}: {
  structure: TrainingPlanStructure;
  /** Semana-modelo do protocolo salvo: onde cada ocorrência cai de segunda a domingo. */
  weekModel?: ProtocolWeekModel;
  options: readonly CatalogOption[];
  issues: IssueMap;
  onChange: Change;
  /** Frase para a região `aria-live` (o que mudou de lugar, o que entrou ou saiu). */
  announce: (message: string) => void;
}) {
  const [picker, setPicker] = useState<PickerState>(null);
  // Cartões abertos, por ocorrência: ao mudar de dia o cartão troca de bloco e continua aberto.
  // A sessão recém-adicionada já vem aberta, para o profissional ajustá-la em seguida.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const setOpen = (id: string, open: boolean) =>
    setOpened((current) => {
      if (current.has(id) === open) return current;
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  const [dragging, setDragging] = useState<OccurrenceRef | null>(null);
  const [overDay, setOverDay] = useState<Weekday | null>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const sessions = structure.sessions;
  const layout = useMemo(() => weekLayout(structure, weekModel), [structure, weekModel]);

  // A sessão muda de bloco no DOM: o foco volta para o mesmo botão.
  useEffect(() => {
    if (!pendingFocus) return;
    document.getElementById(pendingFocus)?.focus();
    setPendingFocus(null);
  }, [pendingFocus, layout]);

  function moveToDay(ref: OccurrenceRef, weekday: Weekday, focusId?: string) {
    const session = sessions.find((candidate) => candidate.key === ref.key);
    const next = moveOccurrence(structure, weekModel, ref, weekday);
    if (!session) return;
    if (next === null) {
      announce(
        `${session.title} já está na ${DAY_LABEL[weekday]}; a mesma sessão não repete no dia.`,
      );
      return;
    }
    if (next === structure) return;
    onChange(next, true);
    if (focusId) setPendingFocus(focusId);
    announce(`Sessão ${session.title} movida para ${DAY_LABEL[weekday]}.`);
  }

  function swapWith(from: OccurrenceRef, to: OccurrenceRef) {
    const next = swapOccurrences(structure, weekModel, from, to);
    const a = sessions.find((candidate) => candidate.key === from.key);
    const b = sessions.find((candidate) => candidate.key === to.key);
    if (!next || !a || !b) return;
    onChange(next, true);
    announce(`Sessões ${a.title} e ${b.title} trocaram de dia.`);
  }

  const pickerSession = picker && picker.mode !== 'session' ? sessions[picker.sessionIndex] : null;
  const excludeIds =
    pickerSession?.content.modality === 'STRENGTH'
      ? pickerSession.content.exercises.map((e) => e.exerciseId)
      : [];

  const choose = (option: CatalogOption) => {
    if (!picker) return;
    if (picker.mode === 'session') {
      const next = addStrengthSession(structure, option);
      onChange(next, true);
      const created = next.sessions.at(-1);
      if (created) setOpen(refId({ key: created.key, occurrence: 0 }), true);
      announce(`Sessão de musculação adicionada com ${option.name}.`);
    } else if (picker.mode === 'add') {
      onChange(addExercise(structure, picker.sessionIndex, option), true);
      announce(`${option.name} adicionado ao fim da sessão ${pickerSession?.title ?? ''}.`);
    } else {
      onChange(replaceExercise(structure, picker.sessionIndex, picker.exerciseIndex, option));
      announce(`Exercício trocado por ${option.name}.`);
    }
  };

  const renderItem = (item: DayItem, weekday: Weekday | null) => {
    const session = sessions[item.sessionIndex];
    if (!session) return null;
    if (item.external) {
      return (
        <li
          key={`${session.key}-${weekday}`}
          className="rounded-xl border border-dashed border-border bg-secondary/30 px-4 py-3 text-label"
        >
          <span className="font-medium">{session.title}</span>
          <span className="text-muted-foreground">
            {' '}
            · esporte que o aluno já pratica; o dia vem do perfil dele
          </span>
        </li>
      );
    }
    const ref: OccurrenceRef = { key: session.key, occurrence: item.occurrence };
    const id = refId(ref);
    const dayIndex = weekday ? WEEKDAYS.indexOf(weekday) : null;
    return (
      <li
        key={`${session.key}#${item.occurrence}`}
        className="rounded-xl transition-shadow data-[dragging]:opacity-60 data-[drop-target]:ring-2 data-[drop-target]:ring-ring"
        data-dragging={
          dragging?.key === ref.key && dragging.occurrence === ref.occurrence ? '' : undefined
        }
        onDragOver={(event) => {
          if (!dragging || (dragging.key === ref.key && dragging.occurrence === ref.occurrence))
            return;
          event.preventDefault();
          event.stopPropagation();
        }}
        onDrop={(event) => {
          if (!dragging) return;
          event.preventDefault();
          event.stopPropagation();
          swapWith(dragging, ref);
          setDragging(null);
          setOverDay(null);
        }}
      >
        <SessionEditor
          index={item.sessionIndex}
          session={session}
          byId={byId}
          issues={issues}
          open={opened.has(id)}
          onOpenChange={(open) => setOpen(id, open)}
          occurrence={{ index: item.occurrence, total: session.weeklyFrequency }}
          canRemove={sessions.length > 1}
          controls={
            weekday ? (
              <DayControls
                id={id}
                name={`sessão ${session.title}`}
                dayIndex={dayIndex}
                dayCount={WEEKDAYS.length}
                onMoveTo={(to) => {
                  const target = WEEKDAYS[to];
                  if (target)
                    moveToDay(ref, target, `${id}-${to > (dayIndex ?? 0) ? 'next' : 'prev'}`);
                }}
                onDragStart={() => setDragging(ref)}
                onDragEnd={() => {
                  setDragging(null);
                  setOverDay(null);
                }}
              />
            ) : null
          }
          dayField={
            <SelectField
              className="w-full @sm:w-56"
              label="Dia da semana"
              ariaLabel={`Dia da semana de ${session.title}`}
              value={weekday ?? NO_DAY}
              options={weekday ? DAY_OPTIONS.filter((o) => o.value !== NO_DAY) : DAY_OPTIONS}
              onChange={(value) => {
                if (value !== NO_DAY) moveToDay(ref, value as Weekday, `${id}-next`);
              }}
            />
          }
          onRemove={() => {
            onChange(removeSession(structure, item.sessionIndex), true);
            announce(`Sessão ${session.title} removida.`);
          }}
          onSession={(next) =>
            onChange(
              updateSession(
                structure,
                item.sessionIndex,
                next.weeklyFrequency === session.weeklyFrequency
                  ? next
                  : withFrequency(next, next.weeklyFrequency),
              ),
            )
          }
          onExercise={(ei, next) =>
            onChange(updateExercise(structure, item.sessionIndex, ei, next))
          }
          onMoveExercise={(from, to) => {
            const name =
              session.content.modality === 'STRENGTH'
                ? session.content.exercises[from]?.name
                : undefined;
            onChange(moveExercise(structure, item.sessionIndex, from, to), true);
            if (name && session.content.modality === 'STRENGTH') {
              announce(
                `${name} movido para a posição ${to + 1} de ${session.content.exercises.length}.`,
              );
            }
          }}
          onRemoveExercise={(ei) => {
            const name =
              session.content.modality === 'STRENGTH' ? session.content.exercises[ei]?.name : '';
            onChange(removeExercise(structure, item.sessionIndex, ei), true);
            announce(`${name ?? 'Exercício'} removido da sessão ${session.title}.`);
          }}
          onAddExercise={() => setPicker({ mode: 'add', sessionIndex: item.sessionIndex })}
          onReplaceExercise={(ei) =>
            setPicker({ mode: 'replace', sessionIndex: item.sessionIndex, exerciseIndex: ei })
          }
        />
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        A semana do protocolo, de segunda a domingo, como o planejador distribuiu pelos horários do
        aluno. Abra uma sessão para editar os exercícios; use as setas, arraste a alça (sobre outro
        dia para mover, sobre outra sessão para trocar os dias) ou escolha o dia dentro da sessão.
        Uma sessão que se repete na semana aparece em cada dia e a edição vale para todas.
      </p>
      <RowIssues messages={issues.get('plan')} />
      <ol className="space-y-4" aria-label="Semana do protocolo">
        {layout.days.map((day) => (
          <li
            key={day.weekday}
            aria-label={DAY_LABEL[day.weekday]}
            data-drop-target={overDay === day.weekday && dragging ? '' : undefined}
            onDragOver={(event) => {
              if (!dragging) return;
              event.preventDefault();
              if (overDay !== day.weekday) setOverDay(day.weekday);
            }}
            onDrop={(event) => {
              if (!dragging) return;
              event.preventDefault();
              moveToDay(dragging, day.weekday);
              setDragging(null);
              setOverDay(null);
            }}
            className="space-y-2 rounded-xl p-1 transition-shadow data-[drop-target]:ring-2 data-[drop-target]:ring-ring"
          >
            <div className="flex items-baseline justify-between gap-3 px-1">
              <h3 className="text-label font-semibold">{DAY_LABEL[day.weekday]}</h3>
              <p className="text-xs text-muted-foreground">
                {day.items.length === 0
                  ? 'Descanso'
                  : `${day.items.length} ${day.items.length === 1 ? 'sessão' : 'sessões'}`}
              </p>
            </div>
            {day.items.length > 0 ? (
              <ol className="space-y-2">
                {day.items.map((item) => renderItem(item, day.weekday))}
              </ol>
            ) : null}
          </li>
        ))}
      </ol>
      {layout.unplaced.length > 0 ? (
        <section aria-label="Sessões sem dia definido" className="space-y-2 rounded-xl p-1">
          <div className="px-1">
            <h3 className="text-label font-semibold">Sem dia definido</h3>
            <p className="text-xs text-muted-foreground">
              Escolha o dia dentro da sessão ou deixe o planejador encaixar ao salvar, conforme a
              disponibilidade do aluno.
            </p>
          </div>
          <ol className="space-y-2">{layout.unplaced.map((item) => renderItem(item, null))}</ol>
        </section>
      ) : null}
      <button
        type="button"
        disabled={!canAddStrengthSession(structure) || options.length === 0}
        onClick={() => setPicker({ mode: 'session' })}
        className={cn(
          FOCUS_RING,
          'flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-input text-label font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
        )}
      >
        <Plus aria-hidden="true" className="size-4" />
        Adicionar sessão de musculação
      </button>
      <ExercisePicker
        open={picker !== null}
        onOpenChange={(open) => {
          if (!open) setPicker(null);
        }}
        title={
          picker?.mode === 'replace'
            ? 'Trocar exercício'
            : picker?.mode === 'session'
              ? 'Primeiro exercício da nova sessão'
              : 'Adicionar exercício'
        }
        options={options}
        excludeIds={excludeIds}
        onSelect={choose}
      />
    </div>
  );
}

function SessionEditor({
  index,
  session,
  byId,
  issues,
  open,
  onOpenChange,
  occurrence,
  controls,
  dayField,
  canRemove,
  onRemove,
  onSession,
  onExercise,
  onMoveExercise,
  onRemoveExercise,
  onAddExercise,
  onReplaceExercise,
}: {
  index: number;
  session: PlanSession;
  byId: ReadonlyMap<string, CatalogOption>;
  issues: IssueMap;
  /** Cartão aberto (campos e exercícios) ou recolhido; o editor guarda o estado de cada um. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Qual das vezes da semana é este cartão (a sessão 2×/semana tem dois cartões). */
  occurrence: { index: number; total: number };
  /** Mover de dia (setas e alça de arrastar). */
  controls: ReactNode;
  /** Escolha direta do dia, dentro da sessão aberta. */
  dayField: ReactNode;
  canRemove: boolean;
  onRemove: () => void;
  onSession: (session: PlanSession) => void;
  onExercise: (index: number, exercise: StrengthExercise) => void;
  onMoveExercise: (from: number, to: number) => void;
  onRemoveExercise: (index: number) => void;
  onAddExercise: () => void;
  onReplaceExercise: (index: number) => void;
}) {
  const headingId = useId();
  const bodyId = useId();
  const exerciseDrag = useDragReorder(onMoveExercise);
  const { content } = session;
  const sessionIssues = issues.get(`session:${index}`);
  const strength = content.modality === 'STRENGTH' ? content : null;
  const keys = strength ? exerciseKeys(strength.exercises) : [];
  // Problema apontado pelo servidor na sessão ou num exercício dela: abre para o campo ficar à vista.
  const hasIssues = [...issues.keys()].some(
    (key) => key === `session:${index}` || key.startsWith(`exercise:${index}:`),
  );
  useEffect(() => {
    if (hasIssues) onOpenChange(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só reage ao surgimento do problema
  }, [hasIssues]);
  const summary = strength
    ? `${strength.focus} · ${strength.exercises.length} ${strength.exercises.length === 1 ? 'exercício' : 'exercícios'}`
    : sessionTypeLabel(session);

  return (
    <article
      aria-labelledby={headingId}
      aria-invalid={sessionIssues ? true : undefined}
      className={cn(
        '@container overflow-hidden rounded-xl border bg-card',
        sessionIssues ? 'border-coral' : 'border-border',
      )}
    >
      <header className="space-y-2 px-4 pt-4 pb-3 @xl:px-5">
        <div className="flex items-center gap-2">
          {controls}
          <h3 className="min-w-0 flex-1">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={open ? bodyId : undefined}
              onClick={() => onOpenChange(!open)}
              className={cn(
                FOCUS_RING,
                'flex min-h-11 w-full items-center gap-3 rounded-lg text-left lg:min-h-10',
              )}
            >
              <LetterBadge index={index} />
              <span className="min-w-0 flex-1">
                <span id={headingId} className="block truncate text-body font-semibold">
                  {session.title}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {summary} · {sessionMeta(session)}
                </span>
              </span>
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  'size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
                  open && 'rotate-180',
                )}
              />
            </button>
          </h3>
          <button
            type="button"
            aria-label={`Remover sessão ${session.title}`}
            title={
              !canRemove
                ? 'O plano precisa de pelo menos uma sessão'
                : occurrence.total > 1
                  ? 'Remove a sessão de todos os dias em que ela aparece'
                  : undefined
            }
            disabled={!canRemove}
            onClick={onRemove}
            className={ICON}
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </button>
        </div>
        <RowIssues messages={sessionIssues} />
      </header>

      {open ? (
        <div id={bodyId} className="border-t border-border">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3 @xl:px-5">
            {dayField}
            {occurrence.total > 1 ? (
              <p className="text-xs text-muted-foreground">
                Vez {occurrence.index + 1} de {occurrence.total} na semana. A edição vale para todas
                as vezes.
              </p>
            ) : null}
          </div>
          <div className="border-b border-border px-4 py-3 @xl:px-5">
            <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
              <TextInput
                className="col-span-2 @2xl:col-span-1"
                label="Título"
                value={session.title}
                maxLength={80}
                ariaLabel={`Título da sessão ${sessionLetter(index)}`}
                onChange={(title) => onSession({ ...session, title })}
              />
              {strength ? (
                <TextInput
                  className="col-span-2 @2xl:col-span-1"
                  label="Foco"
                  value={strength.focus}
                  maxLength={120}
                  ariaLabel={`Foco da sessão ${session.title}`}
                  onChange={(focus) => onSession({ ...session, content: { ...strength, focus } })}
                />
              ) : (
                <p className="col-span-2 self-end pb-2 text-xs text-muted-foreground @2xl:col-span-1">
                  {sessionTypeLabel(session)}
                </p>
              )}
              <NumField
                label="Vezes/semana"
                ariaLabel={`Vezes por semana da sessão ${session.title}`}
                value={session.weeklyFrequency}
                min={1}
                max={7}
                onChange={(value) => onSession({ ...session, weeklyFrequency: value ?? 1 })}
              />
              <NumField
                label="Duração (min)"
                ariaLabel={`Duração em minutos da sessão ${session.title}`}
                value={session.estimatedMinutes}
                min={5}
                max={300}
                step={5}
                onChange={(value) => onSession({ ...session, estimatedMinutes: value ?? 5 })}
              />
              <SelectField
                className="col-span-2 @2xl:col-span-1"
                label="Prioridade"
                ariaLabel={`Prioridade da sessão ${session.title}`}
                value={session.priority}
                options={
                  content.modality === 'EXTERNAL_SPORT'
                    ? PRIORITY_OPTIONS.filter((o) => o.value !== 'KEY')
                    : PRIORITY_OPTIONS
                }
                onChange={(priority) => onSession({ ...session, priority })}
              />
            </div>
          </div>
          {strength ? (
            <div className="space-y-2 p-3 @xl:p-4">
              <ol className="space-y-2" aria-label={`Exercícios da sessão ${session.title}`}>
                {strength.exercises.map((exercise, ei) => (
                  <li
                    key={keys[ei]}
                    {...exerciseDrag.row(ei)}
                    className="rounded-lg transition-shadow data-[dragging]:opacity-60 data-[drop-target]:ring-2 data-[drop-target]:ring-ring"
                  >
                    <ExerciseEditor
                      index={ei}
                      count={strength.exercises.length}
                      exercise={exercise}
                      option={byId.get(exercise.exerciseId)}
                      issues={issues.get(`exercise:${index}:${ei}`)}
                      dragHandle={exerciseDrag.handle(ei)}
                      onChange={(next) => onExercise(ei, next)}
                      onMove={(to) => onMoveExercise(ei, to)}
                      onRemove={() => onRemoveExercise(ei)}
                      onReplace={() => onReplaceExercise(ei)}
                    />
                  </li>
                ))}
              </ol>
              <button
                type="button"
                disabled={strength.exercises.length >= LIMITS.exercisesPerSession}
                title={
                  strength.exercises.length >= LIMITS.exercisesPerSession
                    ? `Limite de ${LIMITS.exercisesPerSession} exercícios por sessão`
                    : undefined
                }
                onClick={onAddExercise}
                className={cn(
                  FOCUS_RING,
                  'flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-input text-label font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-50 lg:min-h-10',
                )}
              >
                <Plus aria-hidden="true" className="size-4" />
                Adicionar exercício do catálogo
              </button>
            </div>
          ) : (
            <>
              <SessionContent session={session} />
              <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground @xl:px-5">
                O conteúdo de corrida, HYROX e esporte externo muda pelo “Pedir ajuste aos agentes”.
              </p>
            </>
          )}
        </div>
      ) : null}
    </article>
  );
}

function ExerciseEditor({
  index,
  count,
  exercise,
  option,
  issues,
  dragHandle,
  onChange,
  onMove,
  onRemove,
  onReplace,
}: {
  index: number;
  count: number;
  exercise: StrengthExercise;
  option: CatalogOption | undefined;
  issues: readonly string[] | undefined;
  dragHandle: { onPointerDown: () => void };
  onChange: (exercise: StrengthExercise) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  onReplace: () => void;
}) {
  const [noteOpen, setNoteOpen] = useState(Boolean(exercise.notes));
  const name = exercise.name;
  const byTime = exercise.durationSeconds !== undefined;
  return (
    <div
      aria-invalid={issues ? true : undefined}
      className={cn(
        '@container rounded-lg border bg-background p-3',
        issues ? 'border-coral' : 'border-border',
      )}
    >
      <div className="flex items-center gap-1">
        <ReorderControls
          name={name}
          index={index}
          count={count}
          onMove={onMove}
          dragHandle={dragHandle}
        />
        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-label font-medium">
            <span className="mr-1.5 font-mono text-xs text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            {name}
          </p>
          {option?.muscleGroups ? (
            <p className="truncate text-xs text-muted-foreground">
              {muscleLabel(option.muscleGroups)}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-11 gap-1.5 px-2.5 text-xs lg:h-10"
          aria-label={`Trocar ${name}`}
          onClick={onReplace}
        >
          <ArrowLeftRight aria-hidden="true" className="size-4" />
          <span className="hidden @md:inline">Trocar</span>
        </Button>
        <button
          type="button"
          aria-label={`Observação de ${name}`}
          aria-pressed={noteOpen}
          onClick={() => setNoteOpen((open) => !open)}
          className={cn(ICON, noteOpen && 'text-foreground')}
        >
          <MessageSquarePlus aria-hidden="true" className="size-4" />
        </button>
        <button
          type="button"
          aria-label={`Remover ${name}`}
          title={count <= 1 ? 'A sessão precisa de pelo menos um exercício' : undefined}
          disabled={count <= 1}
          onClick={onRemove}
          className={ICON}
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 @sm:grid-cols-3 @xl:grid-cols-6">
        <NumField
          label="Séries"
          ariaLabel={`Séries de ${name}`}
          value={exercise.sets}
          min={1}
          max={12}
          onChange={(sets) => onChange({ ...exercise, sets: sets ?? 1 })}
        />
        {byTime ? (
          <NumField
            className="@xl:col-span-2"
            label="Tempo (s)"
            ariaLabel={`Tempo em segundos de ${name}`}
            value={exercise.durationSeconds}
            min={5}
            max={3600}
            step={5}
            onChange={(durationSeconds) =>
              onChange({ ...exercise, durationSeconds: durationSeconds ?? 5 })
            }
          />
        ) : (
          <>
            <NumField
              label="Reps mín."
              ariaLabel={`Repetições mínimas de ${name}`}
              value={exercise.reps?.min}
              min={1}
              max={100}
              onChange={(min) =>
                onChange({
                  ...exercise,
                  reps: { min: min ?? 1, max: exercise.reps?.max ?? min ?? 1 },
                })
              }
            />
            <NumField
              label="Reps máx."
              ariaLabel={`Repetições máximas de ${name}`}
              value={exercise.reps?.max}
              min={1}
              max={100}
              onChange={(max) =>
                onChange({
                  ...exercise,
                  reps: { min: exercise.reps?.min ?? max ?? 1, max: max ?? 1 },
                })
              }
            />
          </>
        )}
        <NumField
          label="Descanso (s)"
          ariaLabel={`Descanso em segundos de ${name}`}
          value={exercise.restSeconds}
          min={0}
          max={600}
          step={15}
          onChange={(restSeconds) => onChange({ ...exercise, restSeconds: restSeconds ?? 0 })}
        />
        <NumField
          label="RIR"
          ariaLabel={`Repetições em reserva de ${name}`}
          value={exercise.rir}
          min={0}
          max={5}
          allowEmpty
          onChange={(rir) => onChange({ ...exercise, rir })}
        />
        <SelectField
          label="Carga"
          ariaLabel={`Estratégia de carga de ${name}`}
          value={exercise.loadStrategy}
          options={LOAD_OPTIONS}
          onChange={(loadStrategy) => onChange({ ...exercise, loadStrategy })}
        />
      </div>
      {noteOpen ? (
        <TextInput
          className="mt-2"
          label="Observação ao aluno (opcional)"
          ariaLabel={`Observação ao aluno sobre ${name}`}
          value={exercise.notes ?? ''}
          maxLength={400}
          onChange={(notes) => onChange({ ...exercise, notes: notes || undefined })}
        />
      ) : null}
      {issues ? (
        <div className="mt-2">
          <RowIssues messages={issues} />
        </div>
      ) : null}
    </div>
  );
}
