'use client';

import {
  methodologyDomainSpec,
  plausibilityIssues,
  type MethodologyParameters,
} from '@movivo/shared';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleDashed,
  History,
  LoaderCircle,
  Pencil,
  Save,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  discardDraft,
  getDocument,
  getVersions,
  MethodologyStudioError,
  openDraft,
  publishDraft,
  saveDraft,
  cancelTest,
  getTestEstimate,
  testDraft,
  type MethodologyChangeView,
  type MethodologyDocumentView,
  type MethodologyTestEstimate,
  type MethodologyTestOutcome,
  type MethodologyVersionSummary,
} from '@/lib/methodology-studio-api';
import { cn } from '@/lib/utils';

import { ConfirmAction } from './confirm-action';
import { TextAreaField, TextField } from './fields';
import { MethodologyField } from './methodology-field';
import {
  DOMAIN_ICONS,
  DocumentStatusBadge,
  OWNER_LABEL,
  PAGE_CONTAINER,
  StatusBadge,
  agentLabelOfTask,
  formatDate,
  readableChanges,
} from './methodology-ui';

type ViewKey = string;
const GUIDANCE: ViewKey = 'orientacoes';
const REVIEW: ViewKey = 'revisar';
const HISTORY: ViewKey = 'versoes';

const STEPS = [
  { title: 'Editar', text: 'Ajuste os valores' },
  { title: 'Testar', text: 'Os agentes conferem' },
  { title: 'Publicar', text: 'Passa a valer' },
] as const;

const brlFormat = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatBrl = (value: number) => brlFormat.format(value);

/** O que o teste vai custar, em linguagem de gente, antes de o profissional confirmar. */
function TestCostInfo({ estimate }: { estimate: MethodologyTestEstimate | null }) {
  if (!estimate) {
    return <p className="text-label text-muted-foreground">Calculando a estimativa de custo…</p>;
  }
  return (
    <div className="space-y-2 text-label">
      <p>
        <span className="font-semibold">Custo estimado:</span>{' '}
        {estimate.estimatedTotalBrl > 0
          ? `cerca de ${formatBrl(estimate.estimatedTotalBrl)}, com base nos últimos testes`
          : 'ainda sem histórico para estimar'}
        {estimate.unknownTasks > 0
          ? ` (${estimate.unknownTasks} agente(s) nunca foram testados e não entram na conta)`
          : ''}
        .
      </p>
      <p>
        <span className="font-semibold">Modelo usado no teste:</span>{' '}
        {estimate.model ?? 'o configurado para cada agente'}, o mais barato disponível. Passar aqui
        é um bom sinal, mas não garante o mesmo resultado nos modelos que os alunos usam.
      </p>
      <p>
        <span className="font-semibold">Limite de segurança:</span>{' '}
        {formatBrl(estimate.suggestedBudgetBrl)}. O teste para sozinho antes de passar disso.
      </p>
      <p className="text-muted-foreground">
        Ele também para na primeira tarefa que reprovar, não refaz o que já passou com este conteúdo
        e você pode cancelar a qualquer momento.
      </p>
    </div>
  );
}

function Stepper({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol
      aria-label="Etapas para publicar"
      className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-lg border border-border bg-card"
    >
      {STEPS.map((step, index) => {
        const number = index + 1;
        const done = number < current;
        const active = number === current;
        return (
          <li
            key={step.title}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex min-w-0 flex-col items-center gap-1.5 px-2 py-3 text-center @lg:flex-row @lg:gap-3 @lg:px-5 @lg:text-left',
              active && 'bg-secondary/60',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-medium',
                done && 'border-verde-pulso bg-verde-pulso text-petroleo',
                active && 'border-foreground bg-foreground text-background',
                !done && !active && 'border-border text-muted-foreground',
              )}
            >
              {done ? <Check className="size-3.5" /> : number}
            </span>
            <span className="min-w-0">
              <span
                className={cn(
                  'block truncate text-label font-medium',
                  !done && !active && 'text-muted-foreground',
                )}
              >
                {step.title}
                {done ? <span className="sr-only"> (concluída)</span> : null}
              </span>
              <span className="hidden truncate text-xs text-muted-foreground @lg:block">
                {step.text}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-border bg-card p-5 @lg:p-6', className)}>
      {children}
    </div>
  );
}

function ChecklistItem({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-label">
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
          ok
            ? 'border-verde-pulso bg-verde-pulso text-petroleo'
            : 'border-border text-muted-foreground',
        )}
      >
        {ok ? <Check className="size-3.5" /> : <CircleDashed className="size-3.5" />}
      </span>
      <span>
        <span className="sr-only">{ok ? 'Feito: ' : 'Pendente: '}</span>
        {children}
      </span>
    </li>
  );
}

/** Estúdio de UM domínio: etapas Editar → Testar → Publicar, uma seção por vez. */
export function MethodologyStudioEditor({ domain, canEdit }: { domain: string; canEdit: boolean }) {
  const spec = useMemo(() => methodologyDomainSpec(domain), [domain]);
  const [doc, setDoc] = useState<MethodologyDocumentView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [versions, setVersions] = useState<MethodologyVersionSummary[]>([]);
  const [diff, setDiff] = useState<MethodologyChangeView[]>([]);
  const [parameters, setParameters] = useState<MethodologyParameters>({});
  const [guidance, setGuidance] = useState<Record<string, string>>({});
  const [justifications, setJustifications] = useState<Record<string, string>>({});
  const [changeNote, setChangeNote] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [outcome, setOutcome] = useState<MethodologyTestOutcome | null>(null);
  const [testNote, setTestNote] = useState<{
    spentBrl: number;
    stoppedReason: string | null;
  } | null>(null);
  const [estimate, setEstimate] = useState<MethodologyTestEstimate | null>(null);
  const [testing, setTesting] = useState(false);
  const [view, setView] = useState<ViewKey>(spec.sections[0]?.key ?? GUIDANCE);
  const errorRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const firstView = spec.sections[0]?.key ?? GUIDANCE;
  const DomainIcon = DOMAIN_ICONS[domain];

  const load = useCallback(
    async (documentId?: string) => {
      setError('');
      const history = await getVersions(domain);
      setVersions(history);
      const open = history.find((v) => v.status === 'DRAFT' || v.status === 'TESTING');
      const current = history.find((v) => v.status === 'PUBLISHED');
      const target = documentId ?? open?.id ?? current?.id;
      if (!target) {
        setDoc(null);
        setLoaded(true);
        return;
      }
      const { document, diff: changes } = await getDocument(target);
      setDoc(document);
      setDiff(changes);
      setParameters(document.parameters);
      setGuidance(document.guidance);
      setJustifications(document.justifications);
      setChangeNote(document.changeNote);
      setDirty(false);
      setLoaded(true);
    },
    [domain],
  );

  useEffect(() => {
    load().catch((e: unknown) => {
      setError(
        e instanceof Error
          ? e.message
          : 'Não foi possível carregar. Atualize a página e tente de novo.',
      );
      setLoaded(true);
    });
  }, [load]);

  // Custo estimado do teste (só consulta o histórico: não chama nenhum modelo).
  const openDocId = doc && (doc.status === 'DRAFT' || doc.status === 'TESTING') ? doc.id : null;
  useEffect(() => {
    setEstimate(null);
    if (!openDocId) return;
    let alive = true;
    getTestEstimate(openDocId)
      .then((value) => alive && setEstimate(value))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [openDocId]);

  // Evita perder o que foi digitado ao fechar a aba ou recarregar sem salvar.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  const editable = canEdit && (doc?.status === 'DRAFT' || doc?.status === 'TESTING');
  const issues = useMemo(() => plausibilityIssues(spec, parameters), [spec, parameters]);
  const pending = useMemo(
    () => issues.filter((issue) => !justifications[issue.path]?.trim()),
    [issues, justifications],
  );
  const pendingBySection = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of pending) {
      const key = issue.path.split('.')[0] ?? '';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [pending]);
  const tested = doc?.status === 'TESTING' && !dirty;
  const step: 1 | 2 | 3 = dirty || pending.length > 0 ? 1 : doc?.status === 'TESTING' ? 3 : 2;
  const changes = useMemo(() => readableChanges(spec, diff), [spec, diff]);

  const views = useMemo(() => {
    const list: { key: ViewKey; title: string }[] = spec.sections.map((s) => ({
      key: s.key,
      title: s.title,
    }));
    if (spec.guidance.length > 0) list.push({ key: GUIDANCE, title: 'Orientações' });
    if (editable) list.push({ key: REVIEW, title: 'Revisar e publicar' });
    list.push({ key: HISTORY, title: 'Versões' });
    return list;
  }, [spec, editable]);
  const closingViews = views
    .filter((v) => !spec.sections.some((s) => s.key === v.key))
    .map((v) => v.key);
  const activeView = views.some((v) => v.key === view) ? view : firstView;
  const activeIndex = views.findIndex((v) => v.key === activeView);
  const previous = views[activeIndex - 1];
  const next = views[activeIndex + 1];

  function go(key: ViewKey) {
    setView(key);
    topRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      if (e instanceof MethodologyStudioError && e.issues.length > 0) {
        setError(`${e.message} ${e.issues.map((i) => i.message).join(' ')}`);
      } else {
        setError(e instanceof Error ? e.message : 'Não foi possível concluir. Tente de novo.');
      }
    } finally {
      setBusy('');
    }
  }

  const setField = (section: string, field: string, value: unknown) => {
    setParameters((prev) => ({ ...prev, [section]: { ...prev[section], [field]: value } }));
    setDirty(true);
    setOutcome(null);
  };

  const save = () =>
    run('Salvando…', async () => {
      if (!doc) return;
      const saved = await saveDraft(doc.id, {
        parameters,
        guidance,
        justifications,
        changeNote: changeNote.trim() || 'Ajustes',
      });
      await load(saved.id);
      setNotice('Rascunho salvo.');
    });

  const startDraft = (fromVersion?: number) =>
    run('Abrindo rascunho…', async () => {
      const created = await openDraft(domain, fromVersion);
      await load(created.id);
      setView(firstView);
      setOutcome(null);
      setNotice(
        fromVersion
          ? `Rascunho criado a partir da versão ${fromVersion}. Nada mudou para os alunos ainda.`
          : 'Rascunho aberto. Nada muda para os alunos até você publicar.',
      );
    });

  const test = (budgetBrl: number) =>
    run('Iniciando o teste com os agentes…', async () => {
      if (!doc) return;
      setTesting(true);
      try {
        const result = await testDraft(doc.id, budgetBrl, (progress) => {
          if (progress.state !== 'RUNNING') return;
          const now = progress.currentTask
            ? ` Agora: ${agentLabelOfTask(progress.currentTask)}.`
            : '';
          setBusy(
            `Testando com os agentes: ${progress.completed} de ${progress.total} concluídos, ${formatBrl(progress.spentBrl)} gastos.${now}`,
          );
        });
        setOutcome(result.outcome);
        setTestNote({ spentBrl: result.spentBrl, stoppedReason: result.stoppedReason });
        await load(doc.id);
        go(REVIEW);
      } finally {
        setTesting(false);
      }
    });

  const cancel = async () => {
    if (!doc) return;
    setBusy('Cancelando… a tarefa em andamento termina e o teste para.');
    try {
      await cancelTest(doc.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível cancelar. Tente de novo.');
    }
  };

  /** Pede a confirmação do gasto antes de qualquer chamada de modelo. */
  const testAction = (props: {
    label: string;
    variant?: 'default' | 'outline';
    className: string;
    disabled: boolean;
  }) => (
    <ConfirmAction
      triggerLabel={props.label}
      title="Testar com os agentes?"
      description="Este teste chama modelos de IA de verdade, e isso gera custo na sua conta do provedor."
      confirmLabel={
        estimate ? `Testar (limite ${formatBrl(estimate.suggestedBudgetBrl)})` : 'Calculando…'
      }
      confirmDisabled={!estimate}
      triggerVariant={props.variant}
      triggerSize="default"
      triggerClassName={props.className}
      disabled={props.disabled}
      onConfirm={async () => {
        if (estimate) void test(estimate.suggestedBudgetBrl);
      }}
    >
      <TestCostInfo estimate={estimate} />
    </ConfirmAction>
  );

  const publish = async () => {
    if (!doc) return;
    const version = doc.version;
    await publishDraft(doc.id);
    setOutcome(null);
    setTestNote(null);
    setError('');
    await load();
    setView(firstView);
    setNotice(`Versão ${version} publicada. Ela já vale para os alunos.`);
  };

  const discard = async () => {
    if (!doc) return;
    await discardDraft(doc.id);
    setOutcome(null);
    setTestNote(null);
    setError('');
    await load();
    setView(firstView);
    setNotice('Rascunho descartado. A versão em vigor continua valendo.');
  };

  function firstPendingView(): ViewKey {
    const first = pending[0]?.path.split('.')[0];
    return first ?? firstView;
  }

  const idle = busy === '';
  const body = !loaded ? null : (
    <>
      {!doc ? (
        <Panel className="mt-8 py-10 text-center">
          <p className="text-body font-semibold tracking-tight">Ainda não há versão publicada</p>
          <p className="mx-auto mt-1 max-w-xl text-label text-muted-foreground">
            Enquanto isso, os agentes usam apenas o texto inicial do sistema.
            {canEdit
              ? ' Comece por um rascunho com valores de exemplo e ajuste cada campo.'
              : ' Peça a um profissional autorizado para publicar esta metodologia.'}
          </p>
          {canEdit ? (
            <Button className="mt-4" disabled={!idle} onClick={() => void startDraft()}>
              <Pencil /> Começar a partir dos exemplos
            </Button>
          ) : null}
        </Panel>
      ) : (
        <>
          {editable ? (
            <div className="mt-8">
              <Stepper current={step} />
            </div>
          ) : (
            <Panel className="mt-8 flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-2xl text-label">
                {canEdit ? (
                  <>
                    <strong>Você está vendo a versão em vigor.</strong> Para alterar, abra um
                    rascunho: os alunos continuam usando esta versão até você publicar outra.
                  </>
                ) : (
                  'Você pode consultar esta metodologia. Somente profissionais autorizados editam e publicam.'
                )}
              </p>
              {canEdit ? (
                <Button disabled={!idle} onClick={() => void startDraft()}>
                  <Pencil /> Editar
                </Button>
              ) : null}
            </Panel>
          )}

          <div className="mt-8 grid gap-6 @4xl:grid-cols-[13.5rem_minmax(0,1fr)] @4xl:gap-10">
            <nav
              aria-label="Partes do documento"
              className="overflow-x-auto border-b border-border @4xl:sticky @4xl:top-24 @4xl:self-start @4xl:overflow-visible @4xl:border-b-0"
            >
              <ul className="flex gap-1 pb-2 @4xl:flex-col @4xl:pb-0">
                {views.map(({ key, title }) => {
                  const current = key === activeView;
                  const count = pendingBySection.get(key) ?? 0;
                  const startsClosing = key === closingViews[0];
                  return (
                    <li
                      key={key}
                      className={cn(
                        'shrink-0',
                        startsClosing && '@4xl:mt-3 @4xl:border-t @4xl:border-border @4xl:pt-4',
                      )}
                    >
                      <button
                        type="button"
                        aria-current={current ? 'true' : undefined}
                        onClick={() => go(key)}
                        className={cn(
                          'flex min-h-10 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-label whitespace-nowrap outline-none motion-safe:transition-colors @4xl:whitespace-normal',
                          'focus-visible:ring-[3px] focus-visible:ring-ring',
                          current
                            ? 'bg-secondary font-medium text-foreground'
                            : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                        )}
                      >
                        {title}
                        {editable && count > 0 ? (
                          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-coral px-1.5 font-mono text-xs font-medium text-petroleo">
                            {count}
                            <span className="sr-only"> pendência(s) de justificativa</span>
                          </span>
                        ) : null}
                        {key === REVIEW && tested ? (
                          <Check aria-label="testada" className="size-4 text-foreground" />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <div key={doc.id} className="min-w-0">
              {spec.sections.map((section) =>
                activeView === section.key ? (
                  <section key={section.key} aria-labelledby={`secao-${section.key}`}>
                    <h2
                      id={`secao-${section.key}`}
                      className="text-h3 font-semibold tracking-tight"
                    >
                      {section.title}
                    </h2>
                    <p className="mt-1 max-w-2xl text-label text-muted-foreground">
                      {section.description}
                    </p>
                    <fieldset
                      disabled={!editable}
                      aria-labelledby={`secao-${section.key}`}
                      className="mt-6 min-w-0 space-y-4 border-0 p-0"
                    >
                      {Object.entries(section.fields).map(([key, field]) => {
                        const path = `${section.key}.${key}`;
                        return (
                          <MethodologyField
                            key={key}
                            id={`campo-${section.key}-${key}`}
                            path={path}
                            field={field}
                            value={parameters[section.key]?.[key]}
                            disabled={!editable}
                            onChange={(value) => setField(section.key, key, value)}
                            outOfRange={issues
                              .filter((i) => i.path === path || i.path.startsWith(`${path}.`))
                              .map((i) => i.path)}
                            justification={(p) => justifications[p] ?? ''}
                            onJustify={(p, text) => {
                              setJustifications((prev) => ({ ...prev, [p]: text }));
                              setDirty(true);
                            }}
                          />
                        );
                      })}
                    </fieldset>
                  </section>
                ) : null,
              )}

              {activeView === GUIDANCE ? (
                <section aria-labelledby="secao-orientacoes">
                  <h2 id="secao-orientacoes" className="text-h3 font-semibold tracking-tight">
                    Orientações
                  </h2>
                  <p className="mt-1 text-label text-muted-foreground">
                    O “como pensar” que não cabe em número. Escreva com as suas palavras: os agentes
                    leem estes textos junto com os valores.
                  </p>
                  <fieldset
                    disabled={!editable}
                    aria-labelledby="secao-orientacoes"
                    className="mt-6 min-w-0 space-y-4 border-0 p-0"
                  >
                    {spec.guidance.map((item) => (
                      <Panel key={item.key}>
                        <label
                          htmlFor={`orientacao-${item.key}`}
                          className="text-body font-semibold tracking-tight"
                        >
                          {item.title}
                        </label>
                        <p className="mt-1 text-label text-muted-foreground">{item.hint}</p>
                        <TextAreaField
                          id={`orientacao-${item.key}`}
                          value={guidance[item.key] ?? ''}
                          disabled={!editable}
                          onChange={(text) => {
                            setGuidance((prev) => ({ ...prev, [item.key]: text }));
                            setDirty(true);
                          }}
                          maxLength={8000}
                          className="mt-3 min-h-32"
                        />
                        <p className="mt-1 text-right text-xs text-muted-foreground">
                          {(guidance[item.key] ?? '').length}/8000
                        </p>
                      </Panel>
                    ))}
                  </fieldset>
                </section>
              ) : null}

              {activeView === REVIEW && editable ? (
                <section aria-labelledby="secao-revisar" className="space-y-4">
                  <div>
                    <h2 id="secao-revisar" className="text-h3 font-semibold tracking-tight">
                      Revisar e publicar
                    </h2>
                    <p className="mt-1 text-label text-muted-foreground">
                      Confira o que mudou, descreva a mudança e deixe os agentes testarem antes de
                      publicar.
                    </p>
                  </div>

                  <Panel>
                    <h3 className="text-body font-semibold tracking-tight">Antes de publicar</h3>
                    <ul className="mt-3 space-y-2">
                      <ChecklistItem ok={!dirty}>Alterações salvas</ChecklistItem>
                      <ChecklistItem ok={pending.length === 0}>
                        {pending.length === 0
                          ? 'Valores fora da faixa usual justificados'
                          : `${pending.length} valor(es) fora da faixa usual ainda sem justificativa`}
                      </ChecklistItem>
                      <ChecklistItem ok={tested}>Testada e aprovada pelos agentes</ChecklistItem>
                    </ul>
                  </Panel>

                  <Panel>
                    <h3 className="text-body font-semibold tracking-tight">O que mudou</h3>
                    <p className="mt-1 text-label text-muted-foreground">
                      Em relação à versão em vigor.
                    </p>
                    {changes.length === 0 ? (
                      <p className="mt-3 text-label text-muted-foreground">
                        Nenhuma alteração ainda.
                      </p>
                    ) : (
                      <ul className="mt-3 divide-y divide-border">
                        {changes.map((change) => (
                          <li key={change.key} className="py-3 first:pt-0 last:pb-0">
                            <p className="text-xs text-muted-foreground">{change.where}</p>
                            {change.detail ? (
                              <p className="text-label font-semibold">{change.detail}</p>
                            ) : null}
                            <p className="mt-0.5 text-label">
                              <span className="sr-only">De </span>
                              <span className="text-muted-foreground line-through">
                                {change.before}
                              </span>
                              <span className="sr-only"> para </span>
                              <ArrowRight
                                aria-hidden="true"
                                className="mx-2 inline size-3.5 align-[-2px] text-muted-foreground"
                              />
                              <strong>{change.after}</strong>
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Panel>

                  <Panel>
                    <label
                      htmlFor="nota-da-mudanca"
                      className="text-body font-semibold tracking-tight"
                    >
                      Descreva a mudança
                    </label>
                    <p className="mt-1 text-label text-muted-foreground">
                      O que mudou e por quê. Fica registrado no histórico de versões.
                    </p>
                    <TextField
                      id="nota-da-mudanca"
                      value={changeNote}
                      onChange={(text) => {
                        setChangeNote(text);
                        setDirty(true);
                      }}
                      maxLength={500}
                      placeholder="Ex.: aumentei o volume dos intermediários após revisão do CREF"
                      className="mt-3"
                    />
                  </Panel>

                  <Panel>
                    <h3 className="text-body font-semibold tracking-tight">Teste com os agentes</h3>
                    <p className="mt-1 text-label text-muted-foreground">
                      Cada agente que usa este conteúdo responde a situações de referência com a sua
                      versão. Se todos continuarem respondendo bem, você pode publicar.
                    </p>

                    {outcome ? (
                      <div
                        className={cn(
                          'mt-5 rounded-lg border p-4',
                          outcome.passed
                            ? 'border-verde-pulso/50 bg-verde-pulso/10'
                            : 'border-coral/60 bg-coral/10',
                        )}
                      >
                        <p className="flex items-center gap-2 text-label font-semibold">
                          {outcome.passed ? (
                            <Check aria-hidden="true" className="size-4" />
                          ) : (
                            <XCircle aria-hidden="true" className="size-4" />
                          )}
                          {outcome.passed
                            ? 'Aprovada nos testes. Você já pode publicar.'
                            : 'Ainda não pode publicar.'}
                        </p>
                        {testNote?.stoppedReason ? (
                          <p className="mt-2 text-label">{testNote.stoppedReason}</p>
                        ) : null}
                        {testNote ? (
                          <p className="mt-2 text-label text-muted-foreground">
                            Gasto neste teste: {formatBrl(testNote.spentBrl)}.
                          </p>
                        ) : null}
                        {outcome.unjustified.length > 0 ? (
                          <p className="mt-2 text-label">
                            Justifique os valores fora da faixa usual:{' '}
                            {outcome.unjustified.map((i) => i.label).join(', ')}.
                          </p>
                        ) : null}
                        {outcome.evaluations.length === 0 && outcome.unjustified.length === 0 ? (
                          <p className="mt-2 text-label">
                            Nenhum agente usa este conteúdo diretamente, então não há o que testar.
                          </p>
                        ) : null}
                        <ul className="mt-3 space-y-3">
                          {outcome.evaluations.map((e) => (
                            <li key={e.taskId}>
                              <p className="flex flex-wrap items-center justify-between gap-2 text-label">
                                <span className="font-semibold">{agentLabelOfTask(e.taskId)}</span>
                                <span>
                                  {e.casesPassed} de {e.casesTotal} situações aprovadas
                                  <span className="sr-only">
                                    {e.passed ? ' (aprovado)' : ' (reprovado)'}
                                  </span>
                                </span>
                              </p>
                              <progress
                                aria-hidden="true"
                                value={e.casesPassed}
                                max={Math.max(e.casesTotal, 1)}
                                className={cn(
                                  'mt-1 block h-2 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-secondary',
                                  e.passed
                                    ? '[&::-moz-progress-bar]:bg-verde-pulso [&::-webkit-progress-value]:bg-verde-pulso'
                                    : '[&::-moz-progress-bar]:bg-coral [&::-webkit-progress-value]:bg-coral',
                                )}
                              />
                              {e.failures.length > 0 ? (
                                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                                  {e.failures.map((failure) => (
                                    <li key={failure}>{failure}</li>
                                  ))}
                                </ul>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : tested ? (
                      <p className="mt-5 flex items-center gap-2 rounded-lg border border-verde-pulso/50 bg-verde-pulso/10 p-4 text-label font-medium">
                        <Check aria-hidden="true" className="size-4" />
                        Este rascunho já foi testado e aprovado.
                      </p>
                    ) : null}

                    {testAction({
                      label: tested ? 'Testar de novo' : 'Testar com os agentes',
                      variant: 'outline',
                      className: 'mt-4 w-full @lg:w-auto',
                      disabled: !idle || dirty || pending.length > 0,
                    })}
                    {dirty ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Salve o rascunho antes de testar.
                      </p>
                    ) : pending.length > 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Justifique os valores fora da faixa usual antes de testar.
                      </p>
                    ) : null}
                  </Panel>
                </section>
              ) : null}

              {activeView === HISTORY ? (
                <section aria-labelledby="secao-versoes">
                  <h2
                    id="secao-versoes"
                    className="flex items-center gap-2 text-h3 font-semibold tracking-tight"
                  >
                    <History aria-hidden="true" className="size-5" /> Versões
                  </h2>
                  <p className="mt-1 text-label text-muted-foreground">
                    {editable
                      ? 'Para restaurar uma versão anterior, publique ou descarte o rascunho atual.'
                      : 'Restaurar cria um novo rascunho a partir da versão escolhida. Nada muda para os alunos até você publicar.'}
                  </p>
                  <ol className="mt-6 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                    {versions.map((v) => (
                      <li key={v.id}>
                        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-2 text-label font-semibold">
                              Versão {v.version}
                              <DocumentStatusBadge status={v.status} />
                            </p>
                            <p className="mt-1 text-label text-muted-foreground">{v.changeNote}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {v.publishedAt
                                ? `Publicada em ${formatDate(v.publishedAt)}`
                                : `Criada em ${formatDate(v.createdAt)}`}
                            </p>
                          </div>
                          {canEdit &&
                          (v.status === 'SUPERSEDED' || v.status === 'PUBLISHED') &&
                          !editable ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!idle}
                              onClick={() => void startDraft(v.version)}
                            >
                              Restaurar
                              <span className="sr-only"> a versão {v.version}</span>
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}

              <div className="mt-8 flex items-center justify-between gap-3">
                {previous ? (
                  <Button variant="ghost" onClick={() => go(previous.key)}>
                    <ArrowLeft /> {previous.title}
                  </Button>
                ) : (
                  <span />
                )}
                {next ? (
                  <Button variant="outline" onClick={() => go(next.key)}>
                    {next.title} <ArrowRight />
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );

  return (
    <section aria-labelledby="studio-title" className={PAGE_CONTAINER}>
      <div ref={topRef} className="scroll-mt-24" />
      <Link
        href="/dashboard/ia/metodologia"
        className="inline-flex min-h-9 items-center gap-1.5 rounded-md text-label text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" /> Todas as metodologias
      </Link>

      <header className="mt-3 flex items-start gap-4 border-b border-border pb-6">
        <span
          aria-hidden="true"
          className="hidden size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary @lg:flex"
        >
          {DomainIcon ? <DomainIcon className="size-5" /> : null}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h1 id="studio-title" className="text-h2 font-semibold tracking-tight @lg:text-h1">
              {spec.title}
            </h1>
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {doc ? (
                <>
                  <span>Versão {doc.version}</span>
                  <DocumentStatusBadge status={doc.status} />
                </>
              ) : null}
              {dirty ? <StatusBadge tone="attention">Alterações não salvas</StatusBadge> : null}
            </p>
          </div>
          <p className="mt-1 max-w-3xl text-label text-muted-foreground">{spec.description}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Responsável:</span>{' '}
            {OWNER_LABEL[spec.owner]}
          </p>
        </div>
      </header>

      <div aria-live="polite">
        {notice ? (
          <p className="mt-6 flex items-center gap-2 rounded-lg border border-verde-pulso/50 bg-verde-pulso/10 p-4 text-label font-medium">
            <Check aria-hidden="true" className="size-4 shrink-0" />
            {notice}
          </p>
        ) : null}
      </div>

      <div ref={errorRef}>
        {error ? (
          <p
            role="alert"
            className="mt-6 rounded-lg border border-coral/60 bg-coral/10 p-4 text-label font-medium"
          >
            {error}
          </p>
        ) : null}
      </div>

      {!loaded && !error ? (
        <div
          aria-hidden="true"
          className="mt-8 h-64 rounded-lg border border-border bg-card motion-safe:animate-pulse"
        />
      ) : null}
      {body}

      {editable && doc ? (
        <div className="sticky bottom-3 z-10 mt-10 rounded-lg border border-border bg-card/95 p-3 shadow-sm backdrop-blur @lg:bottom-4 @lg:px-4">
          <div className="flex flex-col gap-3 @lg:flex-row @lg:items-center @lg:justify-between">
            <p aria-live="polite" className="flex items-center gap-2 text-xs @lg:text-label">
              {!idle ? (
                <>
                  <LoaderCircle
                    aria-hidden="true"
                    className="size-4 shrink-0 motion-safe:animate-spin"
                  />
                  {busy}
                  {testing ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-2 shrink-0"
                      onClick={() => void cancel()}
                    >
                      Cancelar teste
                    </Button>
                  ) : null}
                </>
              ) : dirty ? (
                'Você tem alterações não salvas.'
              ) : pending.length > 0 ? (
                `${pending.length} valor(es) fora da faixa usual precisam de justificativa.`
              ) : doc.status === 'TESTING' ? (
                'Tudo certo! Publique para a versão valer para os alunos.'
              ) : (
                'Rascunho salvo. Falta testar com os agentes.'
              )}
            </p>
            <div className="flex items-center gap-2">
              <ConfirmAction
                triggerLabel="Descartar"
                title="Descartar este rascunho?"
                description="As alterações deste rascunho serão perdidas. A versão em vigor continua valendo para os alunos."
                confirmLabel="Sim, descartar"
                destructive
                triggerVariant="ghost"
                triggerSize="default"
                triggerClassName="shrink-0"
                disabled={!idle}
                onConfirm={discard}
              />
              {dirty ? (
                <Button
                  className="flex-1 @lg:flex-none"
                  disabled={!idle}
                  onClick={() => void save()}
                >
                  <Save /> Salvar rascunho
                </Button>
              ) : pending.length > 0 ? (
                <Button
                  className="flex-1 @lg:flex-none"
                  disabled={!idle}
                  onClick={() => go(firstPendingView())}
                >
                  Ir para as justificativas
                </Button>
              ) : doc.status === 'TESTING' ? (
                <ConfirmAction
                  triggerLabel="Publicar versão"
                  title={`Publicar a versão ${doc.version}?`}
                  description="Ela passa a valer agora para todos os alunos e substitui a versão em vigor. A versão anterior continua no histórico e pode ser restaurada."
                  confirmLabel="Publicar agora"
                  triggerSize="default"
                  triggerClassName="flex-1 @lg:flex-none"
                  disabled={!idle}
                  onConfirm={publish}
                />
              ) : (
                testAction({
                  label: 'Testar com os agentes',
                  className: 'flex-1 @lg:flex-none',
                  disabled: !idle,
                })
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
