'use client';

/**
 * Revisão do protocolo (treino ou alimentar): o plano é o protagonista. Alternância Ver/Editar no
 * cabeçalho; na edição, o mesmo plano vira campos e uma barra fixa embaixo diz se há alterações
 * não salvas, com "Descartar" e "Salvar edição". O servidor confere toda edição e devolve cada
 * problema com o caminho do campo — mostrado no resumo do topo e na linha (sessão, exercício,
 * refeição) a que se refere. Sair com alterações pede confirmação.
 *
 * Com `caseId` é o rascunho de um caso da Fila; com `amend`, o protocolo que o aluno já usa (a
 * edição vira a próxima versão e o aluno recebe o protocolo atualizado). Aprovar, recusar, pedir
 * ajuste e regerar ficam na barra de decisão da tela do caso (`protocol-case.tsx`).
 */
import { Eye, Pencil, RefreshCw, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import {
  editProtocolRequestSchema,
  type NutritionPlanStructure,
  type ProtocolReview as Protocol,
  type TrainingPlanStructure,
} from '@movivo/shared';

import { Button } from '@/components/ui/button';
import {
  amendActiveProtocol,
  getActiveProtocol,
  getExceptionProtocol,
  ProtocolEditError,
  saveExceptionProtocol,
} from '@/lib/control-center-api';
import { groupIssues, isDirty, issueKey, type LocatedIssue } from '@/lib/protocol-edit';
import { mealLabel, planOverview, sessionLetter } from '@/lib/protocol-format';
import { cn } from '@/lib/utils';

import { AnamnesisAnswersButton } from './anamnesis-answers';
import { ConfirmAction } from './confirm-action';
import { useControlCenterResource } from './control-center-ui';
import { NutritionPlanEditor, NutritionPlanView } from './nutrition-plan';
import { TrainingPlanEditor, TrainingPlanView } from './training-plan';

export interface ProtocolEditState {
  editing: boolean;
  dirty: boolean;
}

type Structure = TrainingPlanStructure | NutritionPlanStructure;
const NBSP = String.fromCharCode(160);
type SchemaIssue = NonNullable<
  ReturnType<typeof editProtocolRequestSchema.safeParse>['error']
>['issues'][number];

/** Mensagem do Zod (inglês por padrão) em português, para a conferência local antes do envio. */
function zodMessage(issue: SchemaIssue): string {
  switch (issue.code) {
    case 'too_small':
      return issue.origin === 'string'
        ? 'Preencha este campo.'
        : issue.origin === 'array'
          ? `Precisa de pelo menos ${String(issue.minimum)}.`
          : `O valor mínimo é ${String(issue.minimum)}.`;
    case 'too_big':
      return issue.origin === 'string'
        ? `Texto longo demais (até ${String(issue.maximum)} caracteres).`
        : issue.origin === 'array'
          ? `No máximo ${String(issue.maximum)}.`
          : `O valor máximo é ${String(issue.maximum)}.`;
    case 'invalid_type':
      return 'Campo obrigatório ou com valor inválido.';
    default:
      return /[a-z]/.test(issue.message) && !/\b(expected|invalid|must)\b/i.test(issue.message)
        ? issue.message
        : 'Valor inválido.';
  }
}

/** Onde o problema está, em palavras ("Força A · Agachamento", "Almoço", "Dia de treino"). */
export function issueLocation(key: string, structure: Structure): string | null {
  const [kind, a, b] = key.split(':');
  if ('sessions' in structure) {
    const session = structure.sessions[Number(a)];
    if (!session) return null;
    const name = session.title.trim() || `Sessão ${sessionLetter(Number(a))}`;
    if (kind === 'session') return name;
    if (kind === 'exercise') {
      const exercise =
        session.content.modality === 'STRENGTH' ? session.content.exercises[Number(b)] : undefined;
      return exercise ? `${name} · ${exercise.name}` : name;
    }
    return null;
  }
  if (kind === 'meal') {
    const meal = structure.meals[Number(a)];
    return meal ? mealLabel(meal.slot) : null;
  }
  if (kind === 'targets') return a === 'restDay' ? 'Dia de descanso' : 'Dia de treino';
  return null;
}

function overviewOf(protocol: Protocol, queuePresentation: boolean): string {
  if (protocol.kind === 'TRAINING') {
    if (!queuePresentation) return planOverview(protocol.structure);
    const frequency = protocol.structure.sessions.reduce(
      (total, session) => total + session.weeklyFrequency,
      0,
    );
    const weeks = protocol.structure.phases.reduce((total, phase) => total + phase.weeks, 0);
    const focus =
      protocol.strategy?.title ??
      protocol.structure.phases
        .map((phase) => phase.name)
        .filter(Boolean)
        .join(' · ');
    return [
      focus,
      `${frequency}× por semana`,
      weeks > 0 ? `duração: ${weeks} ${weeks === 1 ? 'semana' : 'semanas'}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }
  const { meals, trainingDay } = protocol.structure;
  return `${meals.length} refeições · ${trainingDay.energyKcal.min}–${trainingDay.energyKcal.max} kcal no dia de treino`;
}

export function ProtocolReview({
  caseId,
  amend,
  canAct,
  onChanged,
  onStateChange,
  queuePresentation = false,
  onLoaded,
}: {
  caseId?: string;
  amend?: { studentId: string; kind: 'TRAINING' | 'NUTRITION' };
  canAct: boolean;
  onChanged: () => Promise<void>;
  queuePresentation?: boolean;
  /** Avisa a tela de cima se está editando e se há mudanças. */
  onStateChange?: (state: ProtocolEditState) => void;
  /** O protocolo salvo (carregado ou recarregado): a tela do caso mostra mesociclo e datas. */
  onLoaded?: (protocol: Protocol) => void;
}) {
  const amendStudentId = amend?.studentId;
  const amendKind = amend?.kind;
  const load = useCallback(
    (signal?: AbortSignal) =>
      amendStudentId && amendKind
        ? getActiveProtocol(amendStudentId, amendKind, signal)
        : getExceptionProtocol(caseId ?? '', signal),
    [caseId, amendStudentId, amendKind],
  );
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(load);
  const [draft, setDraft] = useState<Protocol | null>(null);
  const [issues, setIssues] = useState<LocatedIssue[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const issuesRef = useRef<HTMLDivElement>(null);

  const dirty = Boolean(data && draft && isDirty(data.structure, draft.structure));
  const editing = draft !== null;

  useEffect(() => {
    onStateChange?.({ editing, dirty });
  }, [editing, dirty, onStateChange]);

  useEffect(() => {
    if (data) onLoaded?.(data);
  }, [data, onLoaded]);

  // Fechar a aba ou recarregar com alterações não salvas pede confirmação do navegador.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const announce = useCallback((message: string) => {
    // O mesmo texto duas vezes seguidas também é lido: alterna um espaço invisível no fim.
    setAnnouncement((previous) => (previous === message ? message + NBSP : message));
  }, []);

  if (!data) {
    if (loading && !error) return <PlanSkeleton />;
    return (
      <section role="alert" className="rounded-xl border border-coral bg-card p-5">
        <p className="flex items-center gap-2 text-label font-semibold">
          <TriangleAlert aria-hidden="true" className="size-4" />
          {forbidden ? 'O protocolo não faz parte do seu acesso' : 'O protocolo não carregou'}
        </p>
        {error ? <p className="mt-1 text-label text-muted-foreground">{error}</p> : null}
        {!forbidden ? (
          <Button className="mt-4" variant="outline" onClick={() => void refresh()}>
            <RefreshCw aria-hidden="true" /> Tentar novamente
          </Button>
        ) : null}
      </section>
    );
  }

  const editable = canAct && data.editable;
  const title = data.kind === 'TRAINING' ? 'Plano de treino' : 'Plano alimentar';
  const current = draft ?? data;
  const grouped = groupIssues(issues);

  const startEdit = () => {
    setDraft(data);
    setIssues([]);
    setNotice('');
  };
  const discard = () => {
    setDraft(null);
    setIssues([]);
  };
  const change = (structure: Structure, structural = false) => {
    if (!draft) return;
    setDraft({ ...draft, structure } as Protocol);
    // Mudou a ordem ou a lista: os problemas apontados podem não estar mais naquela linha.
    if (structural && issues.length > 0) setIssues([]);
  };

  const save = async () => {
    if (!draft) return;
    const parsed = editProtocolRequestSchema.safeParse({
      kind: draft.kind,
      structure: draft.structure,
    });
    if (!parsed.success) {
      setIssues(
        parsed.error.issues.map((issue) => ({
          // O caminho vem a partir do corpo do pedido (`structure.sessions…`).
          key: issueKey(
            issue.path
              .filter((p): p is string | number => typeof p !== 'symbol')
              .slice(issue.path[0] === 'structure' ? 1 : 0),
          ),
          message: zodMessage(issue),
        })),
      );
      requestAnimationFrame(() => issuesRef.current?.focus());
      return;
    }
    setSaving(true);
    setIssues([]);
    try {
      if (amend) await amendActiveProtocol(amend.studentId, parsed.data);
      else await saveExceptionProtocol(caseId ?? '', parsed.data);
      setDraft(null);
      setNotice(
        amend
          ? 'Emenda salva. O aluno recebe a versão atualizada no WhatsApp.'
          : 'Edição salva e conferida pelo servidor.',
      );
      await Promise.all([refresh(), onChanged()]);
    } catch (err) {
      setIssues(
        err instanceof ProtocolEditError && err.details.length > 0
          ? err.details.map((detail) => ({ key: issueKey(detail.path), message: detail.message }))
          : [
              {
                key: 'plan',
                message:
                  err instanceof Error ? err.message : 'Não foi possível salvar o protocolo.',
              },
            ],
      );
      requestAnimationFrame(() => issuesRef.current?.focus());
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label={title} className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-h3 font-semibold">
            {queuePresentation ? 'Protocolo' : title}
            <span className="rounded-full border border-border px-2 py-0.5 font-mono text-xs font-normal text-muted-foreground">
              {queuePresentation ? `versão ${data.version}` : `v${data.version}`}
            </span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {overviewOf(current, queuePresentation)}
            {!queuePresentation && data.strategy ? ` · ${data.strategy.title}` : ''}
          </p>
        </div>
        {queuePresentation ? (
          <div className="flex items-center gap-1">
            {caseId ? <AnamnesisAnswersButton caseId={caseId} variant="icon" /> : null}
            {editable ? (
              <ModeButton
                icon={Pencil}
                label="Editar"
                active={editing}
                compact
                onClick={() => {
                  if (!editing) startEdit();
                }}
              />
            ) : null}
          </div>
        ) : editable ? (
          <div
            role="group"
            aria-label="Modo do protocolo"
            className="inline-flex rounded-lg border border-border p-0.5"
          >
            {dirty ? (
              <DiscardConfirm
                onConfirm={discard}
                trigger={(open) => (
                  <ModeButton icon={Eye} label="Ver" active={false} onClick={open} />
                )}
              />
            ) : (
              <ModeButton icon={Eye} label="Ver" active={!editing} onClick={discard} />
            )}
            <ModeButton
              icon={Pencil}
              label={amend ? 'Emendar' : 'Editar'}
              active={editing}
              onClick={() => {
                if (!editing) startEdit();
              }}
            />
          </div>
        ) : null}
      </header>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {notice && !editing ? (
        <p role="status" className="mt-4 text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}

      {issues.length > 0 && draft ? (
        <div
          ref={issuesRef}
          tabIndex={-1}
          role="alert"
          className="mt-4 rounded-lg border border-coral bg-background p-3 text-label outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          <p className="font-medium">
            {issues.length === 1
              ? 'A edição não passou na conferência:'
              : `A edição não passou na conferência (${issues.length} pontos):`}
          </p>
          <ul className="mt-1.5 space-y-1 text-xs">
            {issues.map((issue, index) => {
              const where = issueLocation(issue.key, draft.structure);
              return (
                <li key={`${index}-${issue.message}`}>
                  {where ? <span className="font-medium">{where}: </span> : null}
                  {issue.message}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="mt-5">
        {draft ? (
          draft.kind === 'TRAINING' ? (
            <TrainingPlanEditor
              structure={draft.structure}
              weekModel={draft.weekModel}
              options={draft.exerciseOptions}
              issues={grouped}
              onChange={change}
              announce={announce}
            />
          ) : (
            <NutritionPlanEditor
              structure={draft.structure}
              foods={draft.foodOptions ?? []}
              issues={grouped}
              onChange={change}
            />
          )
        ) : data.kind === 'TRAINING' ? (
          <TrainingPlanView protocol={data} compact={queuePresentation} />
        ) : (
          <NutritionPlanView structure={data.structure} compact={queuePresentation} />
        )}
      </div>

      {draft ? (
        <div className="sticky bottom-0 z-20 -mx-4 mt-6 -mb-4 rounded-b-xl border-t border-border bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:-mx-5 sm:-mb-5 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <p role="status" className="mr-auto flex min-w-0 items-center gap-2 text-xs">
              <span
                aria-hidden="true"
                className={cn('size-2 shrink-0 rounded-full', dirty ? 'bg-coral' : 'bg-border')}
              />
              <span className={dirty ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                {dirty ? 'Alterações não salvas' : 'Nenhuma alteração ainda'}
              </span>
              {amend && dirty ? (
                <span className="hidden text-muted-foreground sm:inline">
                  · ao salvar, vira a versão {data.version + 1} e o aluno recebe
                </span>
              ) : null}
            </p>
            {dirty ? (
              <DiscardConfirm
                onConfirm={discard}
                trigger={(open) => (
                  <Button type="button" variant="outline" disabled={saving} onClick={open}>
                    Descartar
                  </Button>
                )}
              />
            ) : (
              <Button type="button" variant="outline" disabled={saving} onClick={discard}>
                Sair da edição
              </Button>
            )}
            <Button type="button" disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? 'Conferindo…' : 'Salvar edição'}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ModeButton({
  icon: Icon,
  label,
  active,
  compact = false,
  onClick,
}: {
  icon: typeof Eye;
  label: string;
  active: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={compact ? label : undefined}
      onClick={onClick}
      className={cn(
        'inline-flex h-10 items-center gap-1.5 rounded-md text-label font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring',
        compact ? 'w-10 justify-center p-0' : 'px-3',
        active
          ? 'bg-secondary text-secondary-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
      <span className={compact ? 'sr-only' : undefined}>{label}</span>
    </button>
  );
}

function DiscardConfirm({
  onConfirm,
  trigger,
}: {
  onConfirm: () => void;
  trigger: (open: () => void) => ReactNode;
}) {
  return (
    <ConfirmAction
      triggerLabel="Descartar"
      title="Descartar as alterações?"
      description="O que você mudou nesta edição se perde. O protocolo volta a ser o que está salvo."
      confirmLabel="Descartar alterações"
      destructive
      onConfirm={async () => {
        onConfirm();
      }}
      renderTrigger={trigger}
    />
  );
}

function PlanSkeleton() {
  return (
    <div
      role="status"
      aria-label="Carregando o protocolo"
      className="space-y-4 rounded-xl border border-border bg-card p-5"
    >
      <div className="h-5 w-48 animate-pulse rounded bg-muted" />
      <div className="h-3 w-72 max-w-full animate-pulse rounded bg-muted" />
      <div className="grid gap-px overflow-hidden rounded-xl border border-border sm:grid-cols-7">
        {[0, 1, 2, 3, 4, 5, 6].map((key) => (
          <div key={key} className="h-16 animate-pulse bg-muted" />
        ))}
      </div>
      {[0, 1].map((key) => (
        <div key={key} className="h-36 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}
