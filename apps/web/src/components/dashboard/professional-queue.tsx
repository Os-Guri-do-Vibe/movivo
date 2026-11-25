'use client';

/**
 * Fila do Profissional (`PROTOCOL_REVIEW` e `DECISION_FAILURE`): um item por aluno.
 *
 * Hierarquia (progressive disclosure):
 * 1. cabeçalho do aluno — avatar, nome, situação (obrigatória/opcional), prazo mais próximo e
 *    "Ver anamnese" (leitura auditada);
 * 2. uma linha por pendência — "Protocolo de treino", "Protocolo alimentar", "Troca de exercício",
 *    "Falha ao gerar…" — com a própria situação, o lápis (revisar/editar), as setas (pedir ajuste
 *    ou regerar) e o relógio do prazo;
 * 3. "Detalhes e auditoria", aberto sob demanda — o texto longo da IA em seções com rótulo
 *    (justificativa, parecer do coordenador, avaliação postural, por que veio para a fila).
 *    Aberto num caso de revisão opcional, segura a liberação automática como a tela do caso.
 *
 * Alertas (dor, segurança, pedidos do aluno) é outro painel: `exceptions-queue.tsx`.
 */
import {
  ArrowLeftRight,
  ArrowUpRight,
  ChevronDown,
  CircleCheck,
  ClipboardCheck,
  Clock,
  Dumbbell,
  Pencil,
  Salad,
  SlidersHorizontal,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { getException, getExceptions } from '@/lib/control-center-api';
import {
  ageLabel,
  describeAction,
  isProtocolAction,
  UNCERTAINTY_LABEL,
} from '@/lib/exception-copy';
import {
  groupQueueByStudent,
  humanizeReason,
  initialsOf,
  releaseSentence,
  splitFailure,
  splitQueue,
  splitRationale,
  timeLeft,
  type QueueLine,
  type QueueLineKind,
  type QueueStudentGroup,
} from '@/lib/professional-queue';
import { cn } from '@/lib/utils';

import { AnamnesisAnswersButton } from './anamnesis-answers';
import { CONTROL_H, FieldDivider } from './control-center-table';
import { ResourceState, SectorHeader, useControlCenterResource } from './control-center-ui';
import { IconAction } from './icon-action';
import { BulletList, DetailSection, PostureList, ReasonList } from './detail-sections';
import { PAGE_CONTAINER } from './methodology-ui';
import { RegenerateProtocolAction } from './regenerate-action';
import { useNow } from './review-urgency';
import { useReviewHold } from './use-review-hold';

const LINE_ICON: Record<QueueLineKind, LucideIcon> = {
  TRAINING_PLAN: Dumbbell,
  NUTRITION_PLAN: Salad,
  SUBSTITUTION: ArrowLeftRight,
  ADJUSTMENT: SlidersHorizontal,
  SWAP_GAP: ArrowLeftRight,
  FAILURE: TriangleAlert,
  OTHER: ClipboardCheck,
};

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

type Refresh = () => Promise<void>;

export function ProfessionalQueue() {
  const load = useCallback((signal?: AbortSignal) => getExceptions(undefined, 'QUEUE', signal), []);
  const { data, error, forbidden, loading, refresh, updatedAt } = useControlCenterResource(load);
  const reload = useCallback(() => refresh(), [refresh]);

  // Voltar para a aba traz a fila atualizada (o que venceu o prazo some sozinho).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const sections = useMemo(() => (data ? splitQueue(groupQueueByStudent(data)) : null), [data]);
  const total = sections ? sections.mandatory.length + sections.optional.length : 0;

  return (
    <section aria-label="Fila do Profissional" className={cn(PAGE_CONTAINER, 'space-y-8')}>
      <div className="space-y-3">
        <SectorHeader
          title="Fila do Profissional"
          icon={ClipboardCheck}
          updatedAt={updatedAt}
          refreshing={loading}
          onRefresh={() => void refresh()}
        />
        <p className="max-w-prose text-label text-muted-foreground">
          O que os agentes criaram ou mudaram nos protocolos, um item por aluno. A revisão opcional
          é liberada sozinha ao fim do prazo; a obrigatória espera você.
        </p>
      </div>

      {!data ? (
        loading && !error ? (
          <QueueSkeleton />
        ) : (
          <ResourceState
            loading={false}
            error={error}
            forbidden={forbidden}
            onRetry={() => void refresh()}
          />
        )
      ) : (
        <>
          {error ? (
            <p
              role="alert"
              className="flex items-center gap-2 rounded-lg border border-coral bg-card px-4 py-3 text-label"
            >
              <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />A última atualização
              falhou: {error}
            </p>
          ) : null}
          {total === 0 ? (
            <QueueEmpty />
          ) : sections ? (
            <div className="space-y-10">
              <QueueSection
                title="Revisão obrigatória"
                description="O aluno só recebe depois que você revisar e liberar. Inclui PAR-Q de risco e geração que falhou."
                groups={sections.mandatory}
                emptyText="Nenhum aluno esperando revisão obrigatória."
                onChanged={reload}
              />
              <QueueSection
                title="Revisão opcional"
                description="Liberada sozinha ao fim do prazo (2 h para protocolo, 5 min para troca de exercício). Revise antes se quiser ajustar."
                groups={sections.optional}
                emptyText="Nada aguardando o prazo de liberação."
                onChanged={reload}
              />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function QueueSkeleton() {
  return (
    <div role="status" aria-label="Carregando a fila" className="space-y-4">
      <div className="h-5 w-48 animate-pulse rounded-md bg-muted" />
      {[0, 1, 2].map((key) => (
        <div key={key} className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="size-10 animate-pulse rounded-full bg-muted" />
            <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          </div>
          <div className="mt-4 h-10 animate-pulse rounded-lg bg-muted" />
        </div>
      ))}
    </div>
  );
}

function QueueEmpty() {
  return (
    <div
      role="status"
      className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center"
    >
      <CircleCheck aria-hidden="true" className="mx-auto size-8 text-muted-foreground" />
      <h2 className="mt-4 text-h3 font-semibold">Fila em dia</h2>
      <p className="mx-auto mt-2 max-w-sm text-label text-muted-foreground">
        Nada aguardando revisão no seu domínio. Quando os agentes gerarem ou mudarem um protocolo,
        ele aparece aqui.
      </p>
    </div>
  );
}

function QueueSection({
  title,
  description,
  groups,
  emptyText,
  onChanged,
}: {
  title: string;
  description: string;
  groups: QueueStudentGroup[];
  emptyText: string;
  onChanged: Refresh;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h2 id={headingId} className="text-h3 font-semibold">
            {title}
          </h2>
          <span
            className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-border px-2 font-mono text-xs text-muted-foreground tabular-nums"
            aria-label={groups.length === 1 ? '1 aluno' : `${groups.length} alunos`}
          >
            {groups.length}
          </span>
        </div>
        <p className="max-w-prose text-xs text-muted-foreground">{description}</p>
      </div>
      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-label text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <ol className="space-y-3">
          {groups.map((group) => (
            <StudentCard key={group.studentId} group={group} onChanged={onChanged} />
          ))}
        </ol>
      )}
    </section>
  );
}

function StudentCard({ group, onChanged }: { group: QueueStudentGroup; onChanged: Refresh }) {
  const nameId = useId();
  const now = useNow();
  const left = group.nextReleaseAt ? timeLeft(group.nextReleaseAt, now) : null;
  const pending = group.lines.length === 1 ? '1 pendência' : `${group.lines.length} pendências`;

  return (
    <li>
      <article
        aria-labelledby={nameId}
        className="@container rounded-xl border border-border bg-card text-card-foreground"
      >
        <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 p-4 @xl:grid-cols-[auto_minmax(0,1fr)_auto_auto] @xl:px-5">
          <span
            aria-hidden="true"
            className="col-start-1 row-start-1 flex size-10 items-center justify-center rounded-full bg-secondary text-label font-semibold text-secondary-foreground"
          >
            {initialsOf(group.studentName)}
          </span>
          <div className="col-start-2 row-start-1 min-w-0">
            <h3 id={nameId} className="truncate text-body font-semibold">
              {group.studentName}
            </h3>
            <p className="text-xs text-muted-foreground">
              {pending} · {ageLabel(group.oldestAt, now)}
              {group.readOnly ? ' · somente leitura para o seu papel' : ''}
            </p>
          </div>
          <div className="col-span-2 col-start-2 row-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs @xl:col-span-1 @xl:col-start-3 @xl:row-start-1 @xl:justify-end">
            {group.mandatory ? <UrgencyDot tone="attention">Revisão obrigatória</UrgencyDot> : null}
            {group.nextReleaseAt ? (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground tabular-nums">
                <Clock aria-hidden="true" className="size-3.5" />
                {left
                  ? `${group.mandatory ? 'Próxima liberação' : 'Liberação automática'} em ${left}`
                  : 'Liberando agora'}
              </span>
            ) : null}
          </div>
          <div className="col-start-3 row-start-1 @xl:col-start-4">
            <AnamnesisAnswersButton caseId={group.anamnesisCaseId} variant="icon" />
          </div>
        </header>
        <ul
          aria-label={`Pendências de ${group.studentName}`}
          className="divide-y divide-border border-t border-border"
        >
          {group.lines.map((line) => (
            <QueueLineRow key={line.item.id} line={line} now={now} onChanged={onChanged} />
          ))}
        </ul>
      </article>
    </li>
  );
}

function UrgencyDot({ tone, children }: { tone: 'attention' | 'neutral'; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
      <span
        aria-hidden="true"
        className={cn(
          'size-2 shrink-0 rounded-full',
          tone === 'attention' ? 'bg-coral' : 'bg-muted-foreground',
        )}
      />
      {children}
    </span>
  );
}

function lineStatus(line: QueueLine, now: Date): { tone: 'attention' | 'neutral'; text: string } {
  if (line.kind === 'FAILURE') {
    return { tone: 'attention', text: 'Falhou · nada foi enviado ao aluno' };
  }
  if (line.mandatory) {
    return { tone: 'attention', text: 'Revisão obrigatória · sem envio automático' };
  }
  if (!line.item.autoReleaseAt) return { tone: 'neutral', text: 'Revisão opcional' };
  const left = timeLeft(line.item.autoReleaseAt, now);
  return {
    tone: 'neutral',
    text: left ? `Revisão opcional · libera em ${left}` : 'Revisão opcional · liberando agora',
  };
}

function QueueLineRow({
  line,
  now,
  onChanged,
}: {
  line: QueueLine;
  now: Date;
  onChanged: Refresh;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const Icon = LINE_ICON[line.kind];
  const status = lineStatus(line, now);
  const { item } = line;
  const href = `/dashboard/fila/${item.id}`;
  const release = !line.mandatory && item.autoReleaseAt ? item.autoReleaseAt : null;

  return (
    <li className="px-4 py-3 @xl:px-5">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 @2xl:grid-cols-[auto_minmax(0,1fr)_auto]">
        <span
          aria-hidden="true"
          className={cn(
            'flex size-10 items-center justify-center rounded-lg border border-border',
            line.kind === 'FAILURE' ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-label font-medium">{line.title}</p>
          <p className="mt-0.5 text-xs">
            <UrgencyDot tone={status.tone}>
              <span className="font-normal text-muted-foreground">{status.text}</span>
            </UrgencyDot>
          </p>
        </div>
        <div className="col-span-2 flex items-center gap-1 @2xl:col-span-1">
          <Button
            type="button"
            variant="ghost"
            className={cn(CONTROL_H, 'mr-auto gap-1.5 px-2.5 text-xs @2xl:mr-1')}
            // O nome falado começa pelo texto visível (WCAG 2.5.3) e diz de qual linha é.
            aria-label={`Detalhes e auditoria de ${line.title}`}
            aria-expanded={expanded}
            aria-controls={expanded ? detailsId : undefined}
            onClick={() => setExpanded((open) => !open)}
          >
            Detalhes
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'size-4 transition-transform duration-200 motion-reduce:transition-none',
                expanded && 'rotate-180',
              )}
            />
          </Button>
          {line.editLabel ? <IconAction label={line.editLabel} icon={Pencil} href={href} /> : null}
          {line.canRegenerate ? (
            <RegenerateProtocolAction
              caseId={line.item.id}
              target={
                line.kind === 'FAILURE'
                  ? 'FAILURE'
                  : line.kind === 'NUTRITION_PLAN'
                    ? 'NUTRITION'
                    : 'TRAINING'
              }
              onDone={onChanged}
            />
          ) : null}
          {release ? (
            <>
              <span className="mx-1">
                <FieldDivider />
              </span>
              <IconAction
                informational
                icon={Clock}
                label="Prazo da liberação automática"
                hint={releaseSentence(release, now)}
              />
            </>
          ) : null}
        </div>
      </div>
      {expanded ? <LineDetails id={detailsId} line={line} href={href} /> : null}
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Detalhes e auditoria                                                       */
/* -------------------------------------------------------------------------- */

function LineDetails({ id, line, href }: { id: string; line: QueueLine; href: string }) {
  const { item } = line;
  const load = useCallback((signal?: AbortSignal) => getException(item.id, signal), [item.id]);
  const { data, error, loading, refresh } = useControlCenterResource(load);
  // Com os detalhes abertos, a liberação automática que vencer espera (igual à tela do caso).
  const holding = !line.mandatory && item.canResolve;
  useReviewHold(item.id, holding);

  return (
    <div
      id={id}
      role="region"
      aria-label={`Detalhes e auditoria: ${line.title}`}
      className="mt-3 rounded-lg border border-border bg-background/60 px-4 py-1 @2xl:ml-[3.25rem]"
    >
      {loading && !data ? (
        <div role="status" aria-label="Carregando os detalhes" className="space-y-2 py-3">
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
        </div>
      ) : error && !data ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 py-3 text-label">
          <span>Não foi possível carregar os detalhes: {error}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
            Tentar de novo
          </Button>
        </div>
      ) : data ? (
        <DetailsBody line={line} detail={data} holding={holding} />
      ) : null}
      <div className="border-t border-border py-3">
        <Link
          href={href}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-label font-medium text-foreground underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none lg:min-h-10"
        >
          Abrir a revisão completa
          <ArrowUpRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </div>
  );
}

type Detail = Awaited<ReturnType<typeof getException>>;

function proposalSentence(action: Record<string, unknown>, names: Record<string, string>): string {
  if (action.type === 'PUBLISH_TRAINING_PLAN')
    return 'Publicar o protocolo de treino e enviá-lo ao aluno.';
  if (action.type === 'PUBLISH_NUTRITION_PLAN') {
    return 'Publicar o protocolo alimentar e enviá-lo ao aluno.';
  }
  return isProtocolAction(action) ? 'Publicar o protocolo.' : describeAction(action, names);
}

function DetailsBody({
  line,
  detail,
  holding,
}: {
  line: QueueLine;
  detail: Detail;
  holding: boolean;
}) {
  const { item } = line;
  const { proposal, decision } = detail;
  const sections = proposal ? splitRationale(proposal.rationale) : null;
  const failure = line.kind === 'FAILURE' ? splitFailure(item.summary) : null;
  const reasons = decision?.reasons.map(humanizeReason) ?? [];

  return (
    <div className="divide-y divide-border">
      {failure ? (
        <DetailSection title="O que aconteceu">
          <p>{failure.headline}</p>
          {failure.problems.length > 0 ? (
            <div className="mt-2">
              <BulletList lines={failure.problems} />
            </div>
          ) : null}
          <p className="mt-2 text-xs text-muted-foreground">
            Nada foi enviado ao aluno. “Regerar protocolo” encerra o caso e os agentes tentam de
            novo; o novo protocolo volta para a fila.
          </p>
        </DetailSection>
      ) : null}

      {!proposal && !failure ? (
        <DetailSection title="O que aconteceu">
          <p>{item.summary}</p>
        </DetailSection>
      ) : null}

      {proposal ? (
        <DetailSection title="Proposta">
          <p>{proposalSentence(proposal.action, detail.exerciseNames ?? {})}</p>
        </DetailSection>
      ) : null}

      {sections && sections.rationale.length > 0 ? (
        <DetailSection title="Justificativa da IA">
          <BulletList lines={sections.rationale} />
        </DetailSection>
      ) : null}

      {sections && sections.coordinator.length > 0 ? (
        <DetailSection title="Parecer do coordenador">
          <div className="space-y-1.5">
            {sections.coordinator.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </div>
        </DetailSection>
      ) : null}

      {sections && sections.posture.length > 0 ? (
        <DetailSection title="Avaliação postural (leitura da IA)">
          <PostureList entries={sections.posture} />
        </DetailSection>
      ) : null}

      {proposal && proposal.assumptions.length > 0 ? (
        <DetailSection title="Hipóteses não confirmadas">
          <BulletList lines={proposal.assumptions} />
        </DetailSection>
      ) : null}

      {proposal ? (
        <DetailSection title="Incerteza e acompanhamento">
          <dl className="space-y-1.5">
            <div>
              <dt className="inline font-medium">Incerteza: </dt>
              <dd className="inline">{UNCERTAINTY_LABEL[proposal.uncertainty]}</dd>
            </div>
            <div>
              <dt className="inline font-medium">Como saber se funcionou: </dt>
              <dd className="inline">{proposal.expectedOutcome}</dd>
            </div>
          </dl>
        </DetailSection>
      ) : null}

      {reasons.length > 0 ? (
        <DetailSection title="Por que veio para a fila">
          <ReasonList reasons={reasons} />
        </DetailSection>
      ) : null}

      <DetailSection title="Prazo e registro">
        <dl className="space-y-1.5">
          <div>
            <dt className="inline font-medium">Revisão: </dt>
            <dd className="inline">
              {line.mandatory
                ? 'obrigatória: o aluno só recebe depois que um profissional liberar'
                : 'opcional: liberada sozinha ao fim do prazo'}
            </dd>
          </div>
          {!line.mandatory && item.autoReleaseAt ? (
            <div>
              <dt className="inline font-medium">Liberação automática: </dt>
              <dd className="inline">
                {dateTime.format(new Date(item.autoReleaseAt))}
                {holding ? ' · com estes detalhes abertos, o envio espera você' : ''}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="inline font-medium">Criado em: </dt>
            <dd className="inline">{dateTime.format(new Date(item.createdAt))}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Caso: </dt>
            <dd className="inline font-mono text-xs text-muted-foreground">{item.id}</dd>
          </div>
        </dl>
      </DetailSection>
    </div>
  );
}
