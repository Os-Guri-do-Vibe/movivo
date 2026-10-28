'use client';

import {
  methodologyDomainSpec,
  plausibilityIssues,
  type MethodologyParameters,
} from '@movivo/shared';
import { CheckCircle2, FlaskConical, History, Rocket, Save, Trash2, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  discardDraft,
  getDocument,
  getVersions,
  MethodologyStudioError,
  openDraft,
  publishDraft,
  saveDraft,
  testDraft,
  type MethodologyChangeView,
  type MethodologyDocumentView,
  type MethodologyTestOutcome,
  type MethodologyVersionSummary,
} from '@/lib/methodology-studio-api';

import { TextAreaField, TextField } from './fields';
import { MethodologyField } from './methodology-field';

const STATUS_LABEL: Record<MethodologyDocumentView['status'], string> = {
  DRAFT: 'Rascunho',
  TESTING: 'Aprovado nos testes',
  PUBLISHED: 'Publicada',
  SUPERSEDED: 'Substituída',
  DISCARDED: 'Descartada',
};

function describe(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Estúdio de UM domínio: rascunho, campos com dicas, teste contra os casos e publicação. */
export function MethodologyStudioEditor({ domain, canEdit }: { domain: string; canEdit: boolean }) {
  const spec = useMemo(() => methodologyDomainSpec(domain), [domain]);
  const [doc, setDoc] = useState<MethodologyDocumentView | null>(null);
  const [versions, setVersions] = useState<MethodologyVersionSummary[]>([]);
  const [diff, setDiff] = useState<MethodologyChangeView[]>([]);
  const [parameters, setParameters] = useState<MethodologyParameters>({});
  const [guidance, setGuidance] = useState<Record<string, string>>({});
  const [justifications, setJustifications] = useState<Record<string, string>>({});
  const [changeNote, setChangeNote] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<MethodologyTestOutcome | null>(null);

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
    },
    [domain],
  );

  useEffect(() => {
    load().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : 'Não foi possível carregar.'),
    );
  }, [load]);

  const editable = canEdit && (doc?.status === 'DRAFT' || doc?.status === 'TESTING');
  const issues = useMemo(() => plausibilityIssues(spec, parameters), [spec, parameters]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      if (e instanceof MethodologyStudioError && e.issues.length > 0) {
        setError(`${e.message}: ${e.issues.map((i) => `${i.path} — ${i.message}`).join('; ')}`);
      } else {
        setError(e instanceof Error ? e.message : 'Não foi possível concluir.');
      }
    } finally {
      setBusy(false);
    }
  }

  const setField = (section: string, field: string, value: unknown) => {
    setParameters((prev) => ({ ...prev, [section]: { ...prev[section], [field]: value } }));
    setDirty(true);
    setOutcome(null);
  };

  const save = () =>
    run(async () => {
      if (!doc) return;
      const saved = await saveDraft(doc.id, {
        parameters,
        guidance,
        justifications,
        changeNote: changeNote.trim() || 'Ajustes',
      });
      await load(saved.id);
    });

  return (
    <section aria-labelledby="studio-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 id="studio-title" className="text-h2 font-bold">
            {spec.title}
          </h1>
          <p className="mt-1 max-w-2xl text-label text-muted-foreground">{spec.description}</p>
          {doc ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Versão {doc.version} · {STATUS_LABEL[doc.status]}
              {dirty ? ' · alterações não salvas' : ''}
            </p>
          ) : null}
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {!editable ? (
              <Button
                disabled={busy}
                onClick={() => run(async () => load((await openDraft(domain)).id))}
              >
                Abrir rascunho
              </Button>
            ) : (
              <>
                <Button variant="outline" disabled={busy || !dirty} onClick={save}>
                  <Save /> Salvar rascunho
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || dirty}
                  onClick={() =>
                    run(async () => {
                      if (!doc) return;
                      setOutcome(await testDraft(doc.id));
                      await load(doc.id);
                    })
                  }
                >
                  <FlaskConical /> Testar
                </Button>
                <Button
                  disabled={busy || dirty || doc?.status !== 'TESTING'}
                  onClick={() =>
                    run(async () => {
                      if (!doc) return;
                      await publishDraft(doc.id);
                      setOutcome(null);
                      await load();
                    })
                  }
                >
                  <Rocket /> Publicar
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      if (!doc) return;
                      await discardDraft(doc.id);
                      await load();
                    })
                  }
                >
                  <Trash2 /> Descartar
                </Button>
              </>
            )}
          </div>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-coral bg-coral/10 p-4 text-label font-medium"
        >
          {error}
        </p>
      ) : null}

      {outcome ? (
        <div
          className={
            outcome.passed
              ? 'mt-5 rounded-xl border border-verde-pulso/50 bg-verde-pulso/10 p-4 text-label'
              : 'mt-5 rounded-xl border border-coral bg-coral/10 p-4 text-label'
          }
        >
          <p className="inline-flex items-center gap-2 font-semibold">
            {outcome.passed ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
            {outcome.passed ? 'Aprovado nos testes — pode publicar.' : 'Ainda não pode publicar.'}
          </p>
          {outcome.unjustified.length > 0 ? (
            <p className="mt-2">
              Justifique os valores fora da faixa usual:{' '}
              {outcome.unjustified.map((i) => i.label).join(', ')}.
            </p>
          ) : null}
          {outcome.evaluations.length === 0 && outcome.unjustified.length === 0 ? (
            <p className="mt-2 text-xs">Nenhuma tarefa de agente usa este domínio ainda.</p>
          ) : null}
          <ul className="mt-2 space-y-1 text-xs">
            {outcome.evaluations.map((e) => (
              <li key={e.taskId}>
                {e.passed ? '✓' : '✗'} {e.taskId}: {e.casesPassed}/{e.casesTotal} casos
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!doc ? (
        <p className="mt-6 rounded-xl border border-dashed border-border p-6 text-center text-label text-muted-foreground">
          Nada publicado ainda. Abra um rascunho para começar a partir dos exemplos.
        </p>
      ) : (
        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_18rem]">
          <div className="space-y-8">
            {spec.sections.map((section) => (
              <fieldset key={section.key} disabled={!editable} className="space-y-3">
                <legend className="text-h3 font-bold">{section.title}</legend>
                <p className="text-xs text-muted-foreground">{section.description}</p>
                {Object.entries(section.fields).map(([key, field]) => {
                  const prefix = `${section.key}.${key}`;
                  return (
                    <MethodologyField
                      key={key}
                      id={`campo-${section.key}-${key}`}
                      field={field}
                      value={parameters[section.key]?.[key]}
                      disabled={!editable}
                      onChange={(value) => setField(section.key, key, value)}
                      outOfRange={issues
                        .filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`))
                        .map((i) => i.path)}
                      justification={(path) => justifications[path] ?? ''}
                      onJustify={(path, text) => {
                        setJustifications((prev) => ({ ...prev, [path]: text }));
                        setDirty(true);
                      }}
                    />
                  );
                })}
              </fieldset>
            ))}

            <fieldset disabled={!editable} className="space-y-3">
              <legend className="text-h3 font-bold">Orientações</legend>
              {spec.guidance.map((item) => (
                <div key={item.key} className="rounded-lg border border-border bg-card p-4">
                  <p className="text-label font-semibold">{item.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p>
                  <TextAreaField
                    value={guidance[item.key] ?? ''}
                    onChange={(text) => {
                      setGuidance((prev) => ({ ...prev, [item.key]: text }));
                      setDirty(true);
                    }}
                    maxLength={8000}
                    className="mt-2"
                  />
                </div>
              ))}
            </fieldset>

            {editable ? (
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-label font-semibold">Nota da mudança</p>
                <TextField
                  value={changeNote}
                  onChange={(text) => {
                    setChangeNote(text);
                    setDirty(true);
                  }}
                  maxLength={500}
                  placeholder="O que mudou e por quê"
                  className="mt-2"
                />
              </div>
            ) : null}
          </div>

          <aside className="space-y-6">
            <div>
              <h2 className="text-label font-semibold">Mudanças em relação à publicada</h2>
              {diff.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">Nenhuma.</p>
              ) : (
                <ul className="mt-2 space-y-2 text-xs">
                  {diff.map((change) => (
                    <li key={change.path}>
                      <span className="font-medium">{change.label}</span>
                      <span className="block break-all text-muted-foreground">
                        {describe(change.before)} → {describe(change.after)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h2 className="inline-flex items-center gap-2 text-label font-semibold">
                <History className="size-4" /> Versões
              </h2>
              <ul className="mt-2 space-y-2 text-xs">
                {versions.map((v) => (
                  <li key={v.id} className="flex items-start justify-between gap-2">
                    <span>
                      v{v.version} · {STATUS_LABEL[v.status]}
                      <span className="block text-muted-foreground">{v.changeNote}</span>
                    </span>
                    {canEdit &&
                    (v.status === 'SUPERSEDED' || v.status === 'PUBLISHED') &&
                    !editable ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          run(async () => load((await openDraft(domain, v.version)).id))
                        }
                      >
                        Restaurar
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
