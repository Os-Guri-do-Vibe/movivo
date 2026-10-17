'use client';

import { MAX_METHODOLOGY_NOTE_LENGTH } from '@movivo/shared';
import { Eye, GitCompareArrows, Lock, PenLine, Rocket, Save } from 'lucide-react';
import { useDeferredValue, useId, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { countWords, diffLines } from '@/lib/text-diff';
import { cn } from '@/lib/utils';

import { DiffStat, MethodologyDiffView } from './methodology-diff';

export const MIN_METHODOLOGY_LENGTH = 200;

const numberFormat = new Intl.NumberFormat('pt-BR');

type Tab = 'write' | 'changes';

export interface MethodologyEditorProps {
  /** Texto da versão em vigor, base do comparativo. Vazio quando ainda não há metodologia. */
  baseContent: string;
  baseLabel: string | null;
  initialContent: string;
  nextVersion: number;
  /** Quem pode publicar vê "Salvar e publicar"; os demais só salvam rascunho. */
  canPublish: boolean;
  busy: boolean;
  error: string;
  onSave: (input: { content: string; changeNote: string; publish: boolean }) => void;
  onCancel: () => void;
}

export function MethodologyEditor({
  baseContent,
  baseLabel,
  initialContent,
  nextVersion,
  canPublish,
  busy,
  error,
  onSave,
  onCancel,
}: MethodologyEditorProps) {
  const [content, setContent] = useState(initialContent);
  const [changeNote, setChangeNote] = useState('');
  const [tab, setTab] = useState<Tab>('write');
  const ids = { write: useId(), changes: useId(), note: useId() };

  const trimmed = content.trim();
  const deferred = useDeferredValue(content);
  const stats = useMemo(() => {
    const diff = diffLines(baseContent, deferred.trim());
    return { added: diff.added, removed: diff.removed };
  }, [baseContent, deferred]);

  const tooShort = trimmed.length < MIN_METHODOLOGY_LENGTH;
  const unchanged = baseContent !== '' && trimmed === baseContent.trim();
  const blocked = busy || tooShort || unchanged;

  const hint = tooShort
    ? `Faltam ${MIN_METHODOLOGY_LENGTH - trimmed.length} caracteres para o mínimo de ${MIN_METHODOLOGY_LENGTH}.`
    : unchanged
      ? 'Ainda não há nenhuma alteração em relação à versão vigente.'
      : null;

  function submit(event: { preventDefault: () => void }, publish: boolean) {
    event.preventDefault();
    if (blocked) return;
    onSave({ content: trimmed, changeNote: changeNote.trim(), publish });
  }

  return (
    <form
      aria-labelledby={ids.write}
      className="mt-6 overflow-hidden rounded-xl border border-border bg-card"
      onSubmit={(event) => submit(event, false)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-secondary/50 px-5 py-4">
        <div>
          <h3 id={ids.write} className="text-h3 font-bold">
            Nova versão <span className="font-mono">v{nextVersion}</span>
          </h3>
          <p className="mt-0.5 text-label text-muted-foreground">
            {baseLabel
              ? `Parte do texto da ${baseLabel}. Edite à vontade: nada muda para a IA até você publicar.`
              : 'Escreva a primeira metodologia. Nada muda para a IA até você publicar.'}
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Modo do editor"
          className="flex rounded-lg border border-border bg-card p-0.5"
        >
          <Button
            type="button"
            role="tab"
            id={`${ids.write}-tab`}
            aria-selected={tab === 'write'}
            aria-controls={`${ids.write}-panel`}
            size="sm"
            variant={tab === 'write' ? 'secondary' : 'ghost'}
            onClick={() => setTab('write')}
          >
            <PenLine aria-hidden="true" />
            Escrever
          </Button>
          <Button
            type="button"
            role="tab"
            id={`${ids.changes}-tab`}
            aria-selected={tab === 'changes'}
            aria-controls={`${ids.changes}-panel`}
            size="sm"
            variant={tab === 'changes' ? 'secondary' : 'ghost'}
            onClick={() => setTab('changes')}
          >
            <Eye aria-hidden="true" />
            Ver mudanças
            {baseContent ? <DiffStat added={stats.added} removed={stats.removed} /> : null}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 p-5">
        {tab === 'write' ? (
          <div role="tabpanel" id={`${ids.write}-panel`} aria-labelledby={`${ids.write}-tab`}>
            <label htmlFor={`${ids.write}-content`} className="sr-only">
              Conteúdo metodológico
            </label>
            <textarea
              id={`${ids.write}-content`}
              autoFocus
              spellCheck
              required
              className="min-h-[28rem] w-full resize-y rounded-lg border border-input bg-background p-4 font-mono text-[13px] leading-6 focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              aria-describedby={`${ids.write}-help`}
            />
            <div
              id={`${ids.write}-help`}
              className="mt-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-1 text-xs text-muted-foreground"
            >
              <p className="max-w-2xl">
                Sem limite de tamanho. A IA lê este texto inteiro, tanto para montar o protocolo
                quanto para responder o aluno no AI Coach.
              </p>
              <p className="font-mono" aria-live="polite">
                {numberFormat.format(countWords(content))} palavras ·{' '}
                {numberFormat.format(content.length)} caracteres
              </p>
            </div>
          </div>
        ) : (
          <div role="tabpanel" id={`${ids.changes}-panel`} aria-labelledby={`${ids.changes}-tab`}>
            {baseContent ? (
              <>
                <p className="mb-3 flex items-center gap-2 text-label text-muted-foreground">
                  <GitCompareArrows aria-hidden="true" className="size-4" />
                  Comparando com a {baseLabel}. Verde entrou, vermelho saiu.
                </p>
                <MethodologyDiffView before={baseContent} after={trimmed} mode="unified" />
              </>
            ) : (
              <p className="rounded-lg border border-dashed border-border p-8 text-center text-label text-muted-foreground">
                Ainda não há versão vigente para comparar. Tudo o que você escrever será novo.
              </p>
            )}
          </div>
        )}

        <div>
          <label htmlFor={ids.note} className="text-label font-semibold">
            Resumo da alteração{' '}
            <span className="font-normal text-muted-foreground">(opcional)</span>
          </label>
          <input
            id={ids.note}
            type="text"
            maxLength={MAX_METHODOLOGY_NOTE_LENGTH}
            placeholder="Ex.: inclui regra de deload na quarta semana"
            className="mt-1 h-11 w-full rounded-lg border border-input bg-background px-3 text-body focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none"
            value={changeNote}
            onChange={(event) => setChangeNote(event.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Aparece no histórico para facilitar a leitura depois.
          </p>
        </div>

        {error ? (
          <p role="alert" className="rounded-lg border border-coral bg-coral/10 p-3 text-label">
            {error}
          </p>
        ) : null}
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card/95 px-5 py-4 backdrop-blur">
        <p
          className={cn(
            'flex items-center gap-1.5 text-xs',
            hint ? 'font-medium text-foreground' : 'text-muted-foreground',
          )}
          role={hint ? 'status' : undefined}
        >
          <Lock aria-hidden="true" className="size-3.5 shrink-0" />
          {hint ?? 'Salvar como rascunho não altera o que a IA usa hoje.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" variant="outline" disabled={blocked}>
            <Save aria-hidden="true" />
            Salvar rascunho
          </Button>
          {canPublish ? (
            <Button type="button" disabled={blocked} onClick={(event) => submit(event, true)}>
              <Rocket aria-hidden="true" />
              {busy ? 'Publicando…' : 'Salvar e publicar'}
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  );
}
