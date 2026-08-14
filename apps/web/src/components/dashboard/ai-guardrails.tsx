'use client';

import {
  l1GuardrailCandidateSchema,
  type ConfigSimulationResponse,
  type L1GuardrailCandidate,
  type L1GuardrailVersion,
} from '@movivo/shared';
import { CheckCircle2, Flag, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  ControlCenterApiError,
  getL1Guardrails,
  publishL1Guardrail,
  retireL1Guardrail,
  rollbackL1Guardrail,
  simulateAgentConfig,
} from '@/lib/control-center-api';

import { ResourceState, useControlCenterResource } from './control-center-ui';

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-body focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none';
const EMPTY: L1GuardrailCandidate = { label: '', scope: 'BOTH', phrases: [], action: 'FLAG' };

export function AiGuardrailsPanel({ canWrite = false }: { canWrite?: boolean }) {
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(getL1Guardrails);
  const [draft, setDraft] = useState(EMPTY);
  const [phrasesText, setPhrasesText] = useState('');
  const [ruleKey, setRuleKey] = useState<string>();
  const [changeNote, setChangeNote] = useState('');
  const [simulation, setSimulation] = useState<ConfigSimulationResponse['data'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [writeError, setWriteError] = useState('');

  const candidate = useMemo(
    () => ({
      ...draft,
      phrases: phrasesText
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean),
    }),
    [draft, phrasesText],
  );
  const validation = useMemo(() => l1GuardrailCandidateSchema.safeParse(candidate), [candidate]);
  const versions = data?.data.versions ?? [];
  const active = versions.filter((version) => version.current && version.status === 'PUBLISHED');

  const reset = () => {
    setDraft(EMPTY);
    setPhrasesText('');
    setRuleKey(undefined);
    setChangeNote('');
    setSimulation(null);
  };

  const mutate = useCallback(
    async (action: () => Promise<unknown>, success: string) => {
      setBusy(true);
      setWriteError('');
      try {
        await action();
        reset();
        setFeedback(success);
        await refresh();
      } catch (caught) {
        setWriteError(
          caught instanceof ControlCenterApiError
            ? caught.message
            : 'Não foi possível concluir a alteração.',
        );
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const edit = (rule: L1GuardrailVersion) => {
    setRuleKey(rule.ruleKey);
    setDraft({ label: rule.label, scope: rule.scope, phrases: rule.phrases, action: 'FLAG' });
    setPhrasesText(rule.phrases.join('\n'));
    setChangeNote('');
    setSimulation(null);
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
    <section className="mt-8 border-t border-border pt-8" aria-labelledby="l1-title">
      <h2 id="l1-title" className="flex items-center gap-2 text-h2 font-bold">
        <Flag aria-hidden="true" className="size-5" />
        Guardrails L1 aditivos
      </h2>
      <p className="mt-2 max-w-3xl text-label text-muted-foreground">
        Regras configuráveis que apenas sinalizam conversas para revisão humana. Elas nunca
        interrompem nem substituem as regras L0.
      </p>
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

      <ul className="mt-5 grid gap-3 lg:grid-cols-2">
        {active.map((rule) => (
          <li key={rule.ruleKey} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold">{rule.label}</h3>
              <span className="rounded-full bg-secondary px-2 py-1 text-xs font-semibold">
                FLAG · {rule.scope}
              </span>
            </div>
            <p className="mt-2 text-label text-muted-foreground">{rule.phrases.join(' · ')}</p>
            {canWrite ? (
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => edit(rule)}>
                  <Pencil aria-hidden="true" />
                  Editar
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      () =>
                        retireL1Guardrail({
                          ruleKey: rule.ruleKey,
                          changeNote: 'Retirada pelo painel de guardrails',
                        }),
                      'Guardrail retirado; o histórico foi preservado.',
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
      {active.length === 0 ? (
        <p className="mt-4 text-label text-muted-foreground">Nenhum guardrail L1 publicado.</p>
      ) : null}

      {canWrite ? (
        <div className="mt-6 rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold">{ruleKey ? 'Editar sinalização' : 'Nova sinalização'}</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-label font-semibold">
              Nome
              <input
                className={INPUT_CLASS}
                value={draft.label}
                maxLength={80}
                onChange={(event) => {
                  setDraft((value) => ({ ...value, label: event.target.value }));
                  setSimulation(null);
                }}
              />
            </label>
            <label className="text-label font-semibold">
              Onde avaliar
              <select
                className={INPUT_CLASS}
                value={draft.scope}
                onChange={(event) => {
                  setDraft((value) => ({
                    ...value,
                    scope: event.target.value as L1GuardrailCandidate['scope'],
                  }));
                  setSimulation(null);
                }}
              >
                <option value="INPUT">Mensagem recebida</option>
                <option value="OUTPUT">Resposta enviada</option>
                <option value="BOTH">Ambas</option>
              </select>
            </label>
          </div>
          <label className="mt-4 block text-label font-semibold">
            Frases literais, uma por linha
            <textarea
              className={`${INPUT_CLASS} min-h-28`}
              value={phrasesText}
              onChange={(event) => {
                setPhrasesText(event.target.value);
                setSimulation(null);
              }}
            />
          </label>
          <p className="mt-2 text-xs text-muted-foreground">
            Ação fixa: FLAG para revisão humana. Não existe opção de bloqueio.
          </p>
          <label className="mt-4 block text-label font-semibold">
            Motivo da mudança
            <input
              className={INPUT_CLASS}
              value={changeNote}
              maxLength={500}
              onChange={(event) => setChangeNote(event.target.value)}
            />
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || !validation.success}
              onClick={() =>
                void (async () => {
                  if (!validation.success) return;
                  setBusy(true);
                  setWriteError('');
                  setSimulation(null);
                  try {
                    setSimulation(
                      (await simulateAgentConfig({ kind: 'GUARDRAIL', candidate: validation.data }))
                        .data,
                    );
                  } catch (caught) {
                    setWriteError(
                      caught instanceof ControlCenterApiError
                        ? caught.message
                        : 'Não foi possível executar o simulador.',
                    );
                  } finally {
                    setBusy(false);
                  }
                })()
              }
            >
              Executar as 4 etapas
            </Button>
            <Button
              disabled={!canPublish || busy}
              onClick={() =>
                void mutate(
                  () =>
                    publishL1Guardrail({
                      ruleKey,
                      ...(validation.success ? validation.data : candidate),
                      changeNote,
                    }),
                  'Guardrail L1 publicado.',
                )
              }
            >
              <CheckCircle2 aria-hidden="true" />
              Publicar FLAG
            </Button>
            {ruleKey ? (
              <Button variant="outline" onClick={reset}>
                Cancelar edição
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <details className="mt-6 rounded-xl border border-border bg-card p-5">
        <summary className="cursor-pointer font-semibold">Histórico de versões</summary>
        <ul className="mt-4 grid gap-2">
          {versions.map((rule) => (
            <li
              key={rule.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-label"
            >
              <span>
                {rule.label} · v{rule.version}
                {rule.current ? ' · atual' : ''} · {rule.changeNote}
              </span>
              {canWrite && !rule.current ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      () =>
                        rollbackL1Guardrail({
                          ruleKey: rule.ruleKey,
                          targetVersion: rule.version,
                          changeNote: `Retorno à versão ${rule.version}`,
                        }),
                      `Versão ${rule.version} republicada.`,
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
      </details>
    </section>
  );
}
