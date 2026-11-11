'use client';

/**
 * Tela do caso de PUBLICAÇÃO de protocolo (treino ou alimentar) na Fila do Profissional.
 *
 * Hierarquia (de relance → sob demanda):
 * 1. resumo do aluno (limpo, só os dados);
 * 2. "Detalhes e auditoria", recolhido e em colunas quando aberto;
 * 3. o plano (protagonista), com Ver/Editar — `ProtocolReview`;
 * 4. a barra de decisão fixa embaixo: regerar do zero, pedir ajuste (com orientação), recusar
 *    (com nota) e aprovar e liberar. Some durante a edição (a barra de salvar toma o lugar).
 *
 * Nenhum código técnico no corpo: o que serve à auditoria aparece traduzido, com o código pequeno
 * e separado dentro do painel.
 */
import {
  ageInYears,
  type AnamnesisAnswersView,
  type ExceptionDecision,
  type ExceptionDetail,
  type ProtocolReview as ProtocolReviewData,
} from '@movivo/shared';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  approveException,
  ControlCenterApiError,
  getExceptionAnamnesis,
  rejectException,
  requestProtocolAdjustment,
} from '@/lib/control-center-api';
import { readAnamnesis } from '@/lib/anamnesis-labels';
import { goalLabel, UNCERTAINTY_LABEL } from '@/lib/exception-copy';
import { caseSections, decisionLine, reviewStatus, type ProtocolKind } from '@/lib/protocol-case';
import { energyStrategyLabel, mesocycleLabel, protocolEnd, shortDate } from '@/lib/protocol-format';
import { cn } from '@/lib/utils';

import { ConfirmAction } from './confirm-action';
import { BulletList, ClampedList, Disclosure, PostureList, ReasonList } from './detail-sections';
import { ProtocolReview, type ProtocolEditState } from './protocol-review';
import { RegenerateProtocolAction } from './regenerate-action';
import { useNow } from './review-urgency';
import { useControlCenterResource } from './control-center-ui';

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const NOTE_BOX =
  'mt-4 min-h-24 w-full resize-y rounded-md border border-input bg-background p-2.5 text-label text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring';

function answerText(
  reading: ReturnType<typeof readAnamnesis> | null,
  stepNumber: number,
  id: string,
): string | null {
  const section = reading?.sections.find((item) => item.step === stepNumber);
  const row = section?.rows.find((item) => item.id.endsWith(`.${id}`));
  if (!row?.value) return null;
  if (row.value.kind === 'text' || row.value.kind === 'paragraph') return row.value.text || null;
  if (row.value.kind === 'chips') return row.value.items.join(', ') || null;
  return null;
}

function answerAge(view: AnamnesisAnswersView): string | null {
  const birthDate = view.steps.find((step) => step.step === 1)?.data.birthDate;
  if (typeof birthDate !== 'string') return null;
  const age = ageInYears(birthDate);
  return age === null ? null : `${age} anos`;
}

function ProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="inline font-semibold">{label}: </dt>
      <dd className="inline break-words">{value}</dd>
    </div>
  );
}

function ProtocolStudentProfile({
  detail,
  protocol,
  answers,
  loading,
  error,
  forbidden,
  onRetry,
}: {
  detail: ExceptionDetail;
  protocol: ProtocolReviewData | null;
  answers: AnamnesisAnswersView | null;
  loading: boolean;
  error: string;
  forbidden: boolean;
  onRetry: () => void;
}) {
  const reading = answers ? readAnamnesis(answers) : null;
  const goal = answers
    ? answerText(reading, 2, 'primary')
    : goalLabel(record(record(detail.state.goals).declared).primary);
  const days = answerText(reading, 4, 'days');
  const riskFactors = reading?.attention.map((item) => item.title.replace(/^PAR-Q:\s*/u, ''));
  const riskSummary = riskFactors?.length
    ? riskFactors.join(', ')
    : answers
      ? 'Nenhum fator de risco identificado.'
      : 'Não informado';
  const answer = (step: number, id: string) =>
    answers ? (answerText(reading, step, id) ?? 'Não informado') : 'Não informado';
  // Mesmos campos da revisão da v1; no plano alimentar a estratégia ocupa o lugar do mesociclo.
  const left: (readonly [string, string])[] = [
    ['Nome do Aluno', reading?.studentName ?? detail.student?.name ?? 'Aluno sem nome'],
    ['Idade', answers ? (answerAge(answers) ?? 'Não informado') : 'Não informado'],
    ['Objetivo', goal ?? 'Não informado'],
    ['Fatores de Risco', riskSummary],
    protocol?.kind === 'NUTRITION'
      ? ['Estratégia', energyStrategyLabel(protocol.structure.strategy)]
      : ['Mesociclo', protocol ? mesocycleLabel(protocol.structure.phases) : '—'],
  ];
  const right: (readonly [string, string])[] = [
    ['Peso', answer(1, 'weightKg')],
    ['Altura', answer(1, 'heightCm')],
    ['Sexo', answer(1, 'biologicalSex')],
    [
      'Frequência',
      days ? `${days.split(', ').length}x por semana | ${days}` : 'Disponibilidade não informada',
    ],
  ];
  const period: (readonly [string, string])[] = [
    ['Início do protocolo', protocol ? shortDate(protocol.startsOn) : '—'],
    ...(protocol?.kind === 'NUTRITION'
      ? []
      : [
          [
            'Fim do protocolo',
            protocol ? shortDate(protocolEnd(protocol.startsOn, protocol.structure.phases)) : '—',
          ] as const,
        ]),
  ];

  return (
    <section className="@container rounded-xl border border-border bg-card p-4 sm:p-6">
      <h1 className="text-h1 font-bold">Protocolo para Revisão</h1>

      {loading ? (
        <div
          role="status"
          aria-label="Carregando dados do aluno"
          className="mt-4 h-32 animate-pulse rounded-lg bg-secondary"
        />
      ) : null}
      {error ? (
        <div role="alert" className="mt-3">
          <p className="text-label text-destructive">
            {forbidden ? 'Os dados da anamnese não fazem parte do seu acesso.' : error}
          </p>
          {!forbidden ? (
            <Button className="mt-3" variant="outline" onClick={onRetry}>
              Tentar carregar dados do aluno
            </Button>
          ) : null}
        </div>
      ) : null}
      {answers ? null : !loading && !error ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Sem anamnese enviada; os dados complementares do aluno não estão disponíveis.
        </p>
      ) : null}
      <div className="mt-4 space-y-2 text-label">
        <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {[left, right].map((column, index) => (
            <dl key={index} className="space-y-2">
              {column.map(([label, value]) => (
                <ProfileField key={label} label={label} value={value} />
              ))}
            </dl>
          ))}
        </div>
        <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {period.map(([label, value]) => (
            <ProfileField key={label} label={label} value={value} />
          ))}
        </dl>
      </div>
    </section>
  );
}

export function ProtocolCase({
  detail,
  kind,
  decisions,
  onChanged,
}: {
  detail: ExceptionDetail;
  kind: ProtocolKind;
  decisions: readonly ExceptionDecision[] | null;
  onChanged: () => Promise<void>;
}) {
  const router = useRouter();
  const now = useNow();
  const [edit, setEdit] = useState<ProtocolEditState>({ editing: false, dirty: false });
  const onStateChange = useCallback((state: ProtocolEditState) => setEdit(state), []);
  const [protocol, setProtocol] = useState<ProtocolReviewData | null>(null);
  const { case: item, proposal } = detail;
  const loadAnamnesis = useCallback(
    async (signal?: AbortSignal) => {
      try {
        return await getExceptionAnamnesis(item.id, signal);
      } catch (caught) {
        if (caught instanceof ControlCenterApiError && caught.status === 404) return null;
        throw caught;
      }
    },
    [item.id],
  );
  const anamnesis = useControlCenterResource(loadAnamnesis);
  const open = item.status !== 'RESOLVED';
  const pending = proposal?.status === 'PENDING';
  const canAct = open && item.canResolve && pending;
  const status = reviewStatus(item, now);

  return (
    <article className="@container mx-auto w-full max-w-[100rem] space-y-6">
      <nav
        className="flex flex-wrap items-center justify-between gap-3"
        aria-label="Navegação do caso"
      >
        <BackToQueue dirty={edit.dirty} onLeave={() => router.push('/dashboard/fila')} />
      </nav>

      <ProtocolStudentProfile
        detail={detail}
        protocol={protocol}
        answers={anamnesis.data}
        loading={anamnesis.loading}
        error={anamnesis.error}
        forbidden={anamnesis.forbidden}
        onRetry={() => void anamnesis.refresh()}
      />

      <div className="space-y-6">
        <AuditPanel detail={detail} decisions={decisions} />
        <ProtocolReview
          caseId={item.id}
          canAct={canAct}
          onChanged={onChanged}
          onStateChange={onStateChange}
          onLoaded={setProtocol}
          queuePresentation
        />
      </div>

      {canAct && !edit.editing ? (
        <DecisionBar
          caseId={item.id}
          kind={kind}
          headline={status.headline}
          onDone={onChanged}
          onLeave={() => router.push('/dashboard/fila')}
        />
      ) : null}
    </article>
  );
}

function BackToQueue({ dirty, onLeave }: { dirty: boolean; onLeave: () => void }) {
  const className =
    'inline-flex min-h-11 items-center gap-1.5 rounded-md text-label text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring lg:min-h-10';
  if (!dirty) {
    return (
      <Link href="/dashboard/fila" className={className}>
        <ArrowLeft aria-hidden="true" className="size-4" />
        Voltar para a Fila do Profissional
      </Link>
    );
  }
  return (
    <ConfirmAction
      triggerLabel="Voltar para a Fila do Profissional"
      title="Sair sem salvar?"
      description="Há alterações não salvas no protocolo. Ao sair, elas se perdem."
      confirmLabel="Sair sem salvar"
      destructive
      onConfirm={async () => onLeave()}
      renderTrigger={(openDialog) => (
        <Link
          href="/dashboard/fila"
          className={className}
          onClick={(event) => {
            event.preventDefault();
            openDialog();
          }}
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Voltar para a Fila do Profissional
        </Link>
      )}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Decisão                                                                    */
/* -------------------------------------------------------------------------- */

function DecisionBar({
  caseId,
  kind,
  headline,
  onDone,
  onLeave,
}: {
  caseId: string;
  kind: ProtocolKind;
  headline: string;
  onDone: () => Promise<void>;
  onLeave: () => void;
}) {
  const [approveNote, setApproveNote] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const [instruction, setInstruction] = useState('');
  const approveId = useId();
  const rejectId = useId();
  const adjustId = useId();
  const what = kind === 'TRAINING' ? 'de treino' : 'alimentar';

  return (
    <div
      role="region"
      aria-label="Decisão do protocolo"
      className="sticky bottom-0 z-30 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 @3xl:flex @3xl:justify-end">
        <p className="hidden text-xs text-muted-foreground @3xl:mr-auto @3xl:block">{headline}</p>
        <RegenerateProtocolAction
          caseId={caseId}
          target={kind}
          editHint="use o Editar do plano ou o Pedir ajuste"
          onDone={async () => {
            await onDone();
            onLeave();
          }}
        />
        <ConfirmAction
          triggerLabel="Pedir ajuste"
          triggerVariant="outline"
          triggerSize="default"
          triggerClassName="w-full @3xl:w-auto"
          title="Pedir ajuste aos agentes?"
          description={`Os agentes refazem só este protocolo ${what} seguindo a sua orientação. Este rascunho é descartado e o novo volta para a Fila.`}
          confirmLabel="Pedir ajuste"
          confirmDisabled={instruction.trim().length < 3}
          onConfirm={async () => {
            await requestProtocolAdjustment(caseId, instruction.trim());
            setInstruction('');
            await onDone();
            onLeave();
          }}
        >
          <label htmlFor={adjustId} className="mt-4 block text-label font-medium">
            Orientação para os agentes
          </label>
          <textarea
            id={adjustId}
            value={instruction}
            maxLength={1000}
            placeholder="Ex.: trocar a corrida de sábado por bike, reduzir o volume de pernas"
            onChange={(event) => setInstruction(event.target.value)}
            className={cn(NOTE_BOX, 'mt-1.5')}
          />
        </ConfirmAction>
        <ConfirmAction
          triggerLabel="Recusar"
          triggerVariant="outline"
          triggerSize="default"
          triggerClassName="w-full @3xl:w-auto"
          title="Recusar o protocolo?"
          description="Nada é enviado ao aluno e o caso é encerrado. A nota é obrigatória e fica na trilha de decisões."
          confirmLabel="Recusar"
          destructive
          confirmDisabled={rejectNote.trim().length < 3}
          onConfirm={async () => {
            await rejectException(caseId, rejectNote.trim());
            setRejectNote('');
            await onDone();
          }}
        >
          <label htmlFor={rejectId} className="mt-4 block text-label font-medium">
            Motivo da recusa
          </label>
          <textarea
            id={rejectId}
            value={rejectNote}
            maxLength={1000}
            onChange={(event) => setRejectNote(event.target.value)}
            className={cn(NOTE_BOX, 'mt-1.5')}
          />
        </ConfirmAction>
        <div className="col-span-3 @3xl:col-span-1">
          <ConfirmAction
            triggerLabel="Aprovar e liberar"
            triggerSize="default"
            triggerClassName="w-full @3xl:w-auto"
            title="Aprovar e liberar ao aluno?"
            description={`O protocolo ${what} é publicado agora e o aluno o recebe no WhatsApp.`}
            confirmLabel="Aprovar e liberar"
            onConfirm={async () => {
              await approveException(caseId, approveNote.trim() || undefined);
              setApproveNote('');
              await onDone();
            }}
          >
            <label htmlFor={approveId} className="mt-4 block text-label font-medium">
              Nota (opcional, fica na trilha de decisões)
            </label>
            <textarea
              id={approveId}
              value={approveNote}
              maxLength={1000}
              onChange={(event) => setApproveNote(event.target.value)}
              className={cn(NOTE_BOX, 'mt-1.5')}
            />
          </ConfirmAction>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Detalhes e auditoria                                                       */
/* -------------------------------------------------------------------------- */

function AuditPanel({
  detail,
  decisions,
}: {
  detail: ExceptionDetail;
  decisions: readonly ExceptionDecision[] | null;
}) {
  const { case: item, proposal, state } = detail;
  const sections = caseSections(detail);
  const adherence = record(state.adherence);
  const strategy = record(record(state.goals).strategy);
  const optional = item.reviewUrgency === 'OPTIONAL';

  return (
    <aside
      aria-label="Detalhes e auditoria"
      className="@container rounded-xl border border-border bg-card px-4"
    >
      <Disclosure
        title="Detalhes e auditoria"
        summary="Raciocínio dos agentes e registro do caso"
        className="border-0"
      >
        <div className="grid gap-x-6 @2xl:grid-cols-2 @5xl:grid-cols-4">
          {sections.rationale.length > 0 ? (
            <Disclosure
              title="Por que este protocolo"
              summary={`${sections.rationale.length} ${sections.rationale.length === 1 ? 'ponto' : 'pontos'} da justificativa`}
              defaultOpen
            >
              <ClampedList lines={sections.rationale} visible={2} />
            </Disclosure>
          ) : null}

          {sections.coordinator.length > 0 ? (
            <Disclosure
              title="Parecer do coordenador"
              summary={`${sections.coordinator.length} ${sections.coordinator.length === 1 ? 'ponto' : 'pontos'} a conferir`}
            >
              <BulletList lines={sections.coordinator} />
            </Disclosure>
          ) : null}

          {sections.posture.length > 0 ? (
            <Disclosure
              title="Avaliação postural"
              summary={`${sections.posture.length} ${sections.posture.length === 1 ? 'região' : 'regiões'} · leitura da IA por foto`}
            >
              <PostureList entries={sections.posture} />
              <p className="mt-3 text-xs text-muted-foreground">
                Leitura automática para auditoria, não é diagnóstico.
              </p>
            </Disclosure>
          ) : null}

          {proposal ? (
            <Disclosure
              title="Hipóteses e incerteza"
              summary={`Incerteza ${UNCERTAINTY_LABEL[proposal.uncertainty]}${sections.assumptions.length > 0 ? ` · ${sections.assumptions.length} ${sections.assumptions.length === 1 ? 'hipótese' : 'hipóteses'}` : ''}`}
            >
              {sections.assumptions.length > 0 ? (
                <>
                  <p className="text-xs font-medium text-muted-foreground">Não confirmadas</p>
                  <div className="mt-1.5">
                    <BulletList lines={sections.assumptions} />
                  </div>
                </>
              ) : null}
              <dl className="mt-3 space-y-1.5">
                <div>
                  <dt className="inline font-medium">Incerteza: </dt>
                  <dd className="inline">{UNCERTAINTY_LABEL[proposal.uncertainty]}</dd>
                </div>
                <div>
                  <dt className="inline font-medium">Como saber se funcionou: </dt>
                  <dd className="inline">{proposal.expectedOutcome}</dd>
                </div>
              </dl>
            </Disclosure>
          ) : null}

          {sections.reasons.length > 0 ? (
            <Disclosure title="Por que veio para a fila">
              <ReasonList reasons={sections.reasons} />
            </Disclosure>
          ) : null}

          <Disclosure title="Estado do aluno">
            <dl className="space-y-1.5">
              <div>
                <dt className="inline font-medium">Adesão (28 dias): </dt>
                <dd className="inline">
                  {typeof adherence.rate === 'number'
                    ? `${Math.round(adherence.rate * 100)}% (${String(adherence.done)} de ${String(adherence.planned)} sessões)`
                    : 'sem sessões no período'}
                </dd>
              </div>
              <div>
                <dt className="inline font-medium">Estratégia: </dt>
                <dd className="inline">
                  {typeof strategy.title === 'string' ? strategy.title : 'ainda não definida'}
                </dd>
              </div>
            </dl>
          </Disclosure>

          <Disclosure title="Prazo e registro">
            <dl className="space-y-1.5">
              <div>
                <dt className="inline font-medium">Revisão: </dt>
                <dd className="inline">
                  {optional
                    ? 'opcional, liberada sozinha ao fim do prazo'
                    : 'obrigatória, o aluno só recebe depois que um profissional liberar'}
                </dd>
              </div>
              {optional && item.autoReleaseAt ? (
                <div>
                  <dt className="inline font-medium">Liberação automática: </dt>
                  <dd className="inline">
                    {dateTime.format(new Date(item.autoReleaseAt))} (com esta tela aberta, o envio
                    espera você)
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="inline font-medium">Criado em: </dt>
                <dd className="inline">{dateTime.format(new Date(item.createdAt))}</dd>
              </div>
              {item.resolvedAt ? (
                <div>
                  <dt className="inline font-medium">Encerrado em: </dt>
                  <dd className="inline">{dateTime.format(new Date(item.resolvedAt))}</dd>
                </div>
              ) : null}
              <div>
                <dt className="inline font-medium">Caso: </dt>
                <dd className="inline font-mono text-xs break-all text-muted-foreground">
                  {item.id}
                </dd>
              </div>
            </dl>
          </Disclosure>

          <Disclosure
            title="Trilha de decisões"
            summary={
              decisions && decisions.length > 0
                ? `${decisions.length} ${decisions.length === 1 ? 'registro' : 'registros'}`
                : 'Sem decisões registradas'
            }
          >
            {decisions && decisions.length > 0 ? (
              <ol className="space-y-2">
                {decisions.map((row) => {
                  const line = decisionLine(row);
                  return (
                    <li key={row.proposalId} className="text-xs">
                      <span className="font-medium text-foreground">{line.action}</span>
                      <span className="block text-muted-foreground">
                        {line.outcome} · {dateTime.format(new Date(row.createdAt))}
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-xs text-muted-foreground">Sem decisões registradas.</p>
            )}
          </Disclosure>
        </div>
      </Disclosure>
    </aside>
  );
}
