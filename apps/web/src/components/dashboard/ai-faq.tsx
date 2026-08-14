'use client';

import {
  faqCandidateSchema,
  type ConfigSimulationResponse,
  type FaqCandidate,
  type FaqEntriesResponse,
  type FaqEntryVersion,
} from '@movivo/shared';
import {
  CheckCircle2,
  Circle,
  History,
  Lock,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  ControlCenterApiError,
  getFaqEntries,
  publishFaqEntry,
  retireFaqEntry,
  rollbackFaqEntry,
  simulateAgentConfig,
} from '@/lib/control-center-api';

import { ResourceState, SectorHeader, useControlCenterResource } from './control-center-ui';

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-body focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none';
const EMPTY: FaqCandidate = { canonicalQuestion: '', answer: '' };

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

export function AiFaqDashboard({ canWrite = false }: { canWrite?: boolean }) {
  const { data, error, forbidden, loading, refresh } =
    useControlCenterResource<FaqEntriesResponse>(getFaqEntries);
  const [draft, setDraft] = useState<FaqCandidate>(EMPTY);
  const [faqKey, setFaqKey] = useState<string | undefined>();
  const [changeNote, setChangeNote] = useState('');
  const [simulation, setSimulation] = useState<ConfigSimulationResponse['data'] | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [writeError, setWriteError] = useState('');

  const validation = useMemo(() => faqCandidateSchema.safeParse(draft), [draft]);
  const versions = data?.data.versions ?? [];
  const current = versions.filter((version) => version.current);
  const active = current.filter((version) => version.status === 'PUBLISHED');

  const update = (patch: Partial<FaqCandidate>) => {
    setDraft((value) => ({ ...value, ...patch }));
    setSimulation(null);
    setFeedback('');
    setWriteError('');
  };

  const clearForm = () => {
    setDraft(EMPTY);
    setFaqKey(undefined);
    setChangeNote('');
    setSimulation(null);
  };

  const runMutation = useCallback(
    async (action: () => Promise<unknown>, success: string) => {
      setSaving(true);
      setWriteError('');
      try {
        await action();
        clearForm();
        setFeedback(success);
        await refresh();
      } catch (caught) {
        setWriteError(
          caught instanceof ControlCenterApiError
            ? caught.message
            : 'Não foi possível concluir a alteração.',
        );
      } finally {
        setSaving(false);
      }
    },
    [refresh],
  );

  const runSimulation = async () => {
    if (!validation.success) return;
    setSimulating(true);
    setWriteError('');
    setSimulation(null);
    try {
      const response = await simulateAgentConfig({ kind: 'FAQ', candidate: validation.data });
      setSimulation(response.data);
    } catch (caught) {
      setWriteError(
        caught instanceof ControlCenterApiError
          ? caught.message
          : 'Não foi possível executar o simulador.',
      );
    } finally {
      setSimulating(false);
    }
  };

  const edit = (entry: FaqEntryVersion) => {
    setFaqKey(entry.faqKey);
    setDraft({ canonicalQuestion: entry.canonicalQuestion, answer: entry.answer });
    setChangeNote('');
    setSimulation(null);
    setFeedback('');
    document.getElementById('faq-editor')?.scrollIntoView({ behavior: 'smooth' });
  };

  if (!data) {
    return (
      <ResourceState
        loading={loading}
        error={error}
        forbidden={forbidden}
        onRetry={() => void refresh()}
      />
    );
  }

  const canPublish =
    canWrite && validation.success && changeNote.trim().length >= 5 && simulation?.passed === true;

  return (
    <div>
      <SectorHeader
        title="FAQ"
        description="Respostas revisadas para dúvidas recorrentes. O match é exato e normalizado, sem geração por modelo, sempre com respaldo do profissional CREF."
        meta={data.meta}
        refreshing={loading}
        onRefresh={() => void refresh()}
      />

      {feedback ? (
        <p
          role="status"
          className="mt-4 rounded-lg border border-border bg-secondary p-3 text-label"
        >
          {feedback}
        </p>
      ) : null}
      {writeError ? (
        <p role="alert" className="mt-4 rounded-lg border border-coral bg-card p-3 text-label">
          {writeError}
        </p>
      ) : null}
      {!canWrite ? (
        <p className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-secondary p-3 text-label">
          <Lock aria-hidden="true" className="size-4" /> Seu acesso permite consultar as respostas e
          o histórico.
        </p>
      ) : null}

      <section
        className="mt-6 rounded-xl border border-border bg-card p-5"
        aria-labelledby="faq-list-title"
      >
        <h2 id="faq-list-title" className="text-h2 font-bold">
          Respostas vigentes
        </h2>
        {active.length === 0 ? (
          <p className="mt-2 text-label text-muted-foreground">Nenhuma resposta publicada.</p>
        ) : (
          <ul className="mt-4 grid gap-3 lg:grid-cols-2">
            {active.map((entry) => (
              <li key={entry.faqKey} className="rounded-lg border border-border p-4">
                <p className="font-semibold">{entry.canonicalQuestion}</p>
                <p className="mt-2 text-label text-muted-foreground">{entry.answer}</p>
                <p className="mt-3 text-xs text-muted-foreground">
                  v{entry.version} · {dateLabel(entry.createdAt)}
                </p>
                {canWrite ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => edit(entry)}>
                      <Pencil aria-hidden="true" />
                      Editar
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={saving}
                      onClick={() =>
                        void runMutation(
                          () =>
                            retireFaqEntry({
                              faqKey: entry.faqKey,
                              changeNote: 'Retirada pelo painel de FAQ',
                            }),
                          'Resposta retirada. O histórico foi preservado.',
                        )
                      }
                    >
                      <Trash2 aria-hidden="true" />
                      Retirar
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canWrite ? (
        <section
          id="faq-editor"
          className="mt-6 rounded-xl border border-border bg-card p-5"
          aria-labelledby="faq-editor-title"
        >
          <h2 id="faq-editor-title" className="text-h2 font-bold">
            {faqKey ? 'Editar resposta' : 'Nova resposta'}
          </h2>
          <div className="mt-4 grid gap-4">
            <label className="text-label font-semibold">
              Pergunta canônica
              <input
                className={INPUT_CLASS}
                value={draft.canonicalQuestion}
                maxLength={300}
                onChange={(event) => update({ canonicalQuestion: event.target.value })}
              />
            </label>
            <label className="text-label font-semibold">
              Resposta revisada
              <textarea
                className={`${INPUT_CLASS} min-h-32`}
                value={draft.answer}
                maxLength={1200}
                onChange={(event) => update({ answer: event.target.value })}
              />
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                {draft.answer.length}/1200 caracteres
              </span>
            </label>
            <label className="text-label font-semibold">
              Motivo da mudança
              <input
                className={INPUT_CLASS}
                value={changeNote}
                maxLength={500}
                onChange={(event) => setChangeNote(event.target.value)}
              />
            </label>
          </div>

          <div className="mt-5 rounded-lg border border-border bg-secondary p-4">
            <h3 className="font-semibold">Simulador obrigatório</h3>
            <ol className="mt-3 grid gap-2 sm:grid-cols-2">
              {(
                simulation?.checks ?? [
                  { id: 'SCHEMA', title: 'Contrato e proteção contra instruções' },
                  { id: 'GOLDEN_INPUT', title: 'Guardrail antes do FAQ' },
                  { id: 'GOLDEN_OUTPUT', title: 'Linguagem da resposta estática' },
                  { id: 'PROMPT_INTEGRITY', title: 'Match exato normalizado' },
                ]
              ).map((check) => {
                const passed = 'passed' in check ? check.passed : null;
                const Icon = passed === true ? CheckCircle2 : passed === false ? XCircle : Circle;
                return (
                  <li key={check.id} className="flex items-center gap-2 text-label">
                    <Icon
                      aria-hidden="true"
                      className={passed === false ? 'size-4 text-coral' : 'size-4'}
                    />
                    {check.title}
                  </li>
                );
              })}
            </ol>
            <Button
              className="mt-4"
              variant="outline"
              disabled={simulating || !validation.success}
              onClick={() => void runSimulation()}
            >
              {simulating ? 'Executando…' : 'Executar as 4 etapas'}
            </Button>
          </div>

          {!validation.success && (draft.canonicalQuestion || draft.answer) ? (
            <p role="alert" className="mt-3 text-label text-coral">
              Revise a pergunta e a resposta antes de simular.
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              disabled={!canPublish || saving}
              onClick={() =>
                void runMutation(
                  () =>
                    publishFaqEntry({
                      faqKey,
                      ...(validation.success ? validation.data : draft),
                      changeNote,
                    }),
                  faqKey ? 'Nova versão publicada.' : 'Resposta publicada.',
                )
              }
            >
              <Send aria-hidden="true" />
              {saving ? 'Publicando…' : 'Publicar'}
            </Button>
            {faqKey ? (
              <Button variant="outline" onClick={clearForm}>
                Cancelar edição
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section
        className="mt-6 rounded-xl border border-border bg-card p-5"
        aria-labelledby="faq-history-title"
      >
        <h2 id="faq-history-title" className="flex items-center gap-2 text-h2 font-bold">
          <History aria-hidden="true" className="size-5" />
          Histórico imutável
        </h2>
        {versions.length === 0 ? (
          <p className="mt-2 text-label text-muted-foreground">
            O histórico começa na primeira publicação.
          </p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {versions.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div>
                  <p className="text-label font-semibold">
                    v{entry.version}
                    {entry.current ? ' · atual' : ''} · {entry.canonicalQuestion}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {dateLabel(entry.createdAt)} · {entry.createdBy ?? 'autor removido'} ·{' '}
                    {entry.changeNote}
                  </p>
                </div>
                {canWrite && !entry.current ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={saving}
                    onClick={() =>
                      void runMutation(
                        () =>
                          rollbackFaqEntry({
                            faqKey: entry.faqKey,
                            targetVersion: entry.version,
                            changeNote: `Retorno à versão ${entry.version}`,
                          }),
                        `Versão ${entry.version} republicada como nova versão.`,
                      )
                    }
                  >
                    <RotateCcw aria-hidden="true" />
                    Republicar
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
