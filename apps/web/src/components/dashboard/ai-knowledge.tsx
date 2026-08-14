'use client';

import type { KnowledgeDocumentsResponse, UploadKnowledgeDocumentInput } from '@movivo/shared';
import { CheckCircle2, FileSearch, Lock, Upload, XCircle } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  ControlCenterApiError,
  getKnowledgeDocuments,
  getKnowledgeDocumentContent,
  reviewKnowledgeDocument,
  uploadKnowledgeDocument,
} from '@/lib/control-center-api';

import { ResourceState, SectorHeader, useControlCenterResource } from './control-center-ui';

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-body focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none';

export function AiKnowledgeDashboard({
  canUpload = false,
  canApprove = false,
}: {
  canUpload?: boolean;
  canApprove?: boolean;
}) {
  const { data, error, forbidden, loading, refresh } =
    useControlCenterResource<KnowledgeDocumentsResponse>(getKnowledgeDocuments);
  const [draft, setDraft] = useState<Partial<UploadKnowledgeDocumentInput>>({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [writeError, setWriteError] = useState('');
  const [preview, setPreview] = useState<{ id: string; content: string } | null>(null);

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

  const run = async (action: () => Promise<unknown>, success: string) => {
    setSaving(true);
    setWriteError('');
    try {
      await action();
      setFeedback(success);
      await refresh();
    } catch (caught) {
      setWriteError(
        caught instanceof ControlCenterApiError
          ? caught.message
          : 'Nao foi possivel concluir a acao.',
      );
    } finally {
      setSaving(false);
    }
  };

  const pending = data.data.documents.filter((document) => document.status === 'PENDING');
  const validDraft =
    draft.title && draft.topic && draft.originalFilename && draft.mimeType && draft.content;

  return (
    <div>
      <SectorHeader
        title="Conhecimento (RAG)"
        description="Documentos entram em quarentena e so chegam a agente depois da revisao do profissional CREF. Cada resposta guarda o documento e o trecho que a sustentaram."
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

      <section
        className="mt-6 rounded-xl border border-border bg-card p-5"
        aria-labelledby="knowledge-policy"
      >
        <h2 id="knowledge-policy" className="text-h2 font-bold">
          Politica de entrada e retencao
        </h2>
        <p className="mt-2 text-label text-muted-foreground">
          .txt e .md, ate {Math.round(data.data.policy.maxBytes / 1024)} KiB. O original fica{' '}
          {data.data.policy.quarantineDays} dias em quarentena e, quando aprovado,{' '}
          {data.data.policy.approvedOriginalDays} dias. Metadados e revisoes permanecem imutaveis.
        </p>
      </section>

      {canUpload ? (
        <section
          className="mt-6 rounded-xl border border-border bg-card p-5"
          aria-labelledby="knowledge-upload"
        >
          <h2 id="knowledge-upload" className="flex items-center gap-2 text-h2 font-bold">
            <Upload aria-hidden="true" className="size-5" />
            Enviar para quarentena
          </h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-label font-semibold">
              Titulo
              <input
                className={INPUT_CLASS}
                maxLength={200}
                onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))}
              />
            </label>
            <label className="text-label font-semibold">
              Topico
              <input
                className={INPUT_CLASS}
                maxLength={60}
                onChange={(event) => setDraft((value) => ({ ...value, topic: event.target.value }))}
              />
            </label>
            <label className="text-label font-semibold md:col-span-2">
              URL da fonte (opcional)
              <input
                className={INPUT_CLASS}
                type="url"
                onChange={(event) =>
                  setDraft((value) => ({ ...value, sourceUrl: event.target.value || undefined }))
                }
              />
            </label>
            <label className="text-label font-semibold md:col-span-2">
              Arquivo
              <input
                className={INPUT_CLASS}
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void file.text().then((content) =>
                    setDraft((value) => ({
                      ...value,
                      originalFilename: file.name,
                      mimeType: file.name.toLowerCase().endsWith('.md')
                        ? 'text/markdown'
                        : 'text/plain',
                      content,
                    })),
                  );
                }}
              />
            </label>
          </div>
          <Button
            className="mt-4"
            disabled={!validDraft || saving}
            onClick={() =>
              void run(
                () => uploadKnowledgeDocument(draft as UploadKnowledgeDocumentInput),
                'Arquivo aceito na quarentena e enviado para revisao CREF.',
              )
            }
          >
            Enviar arquivo
          </Button>
        </section>
      ) : null}

      {canApprove ? (
        <section
          className="mt-6 rounded-xl border border-border bg-card p-5"
          aria-labelledby="knowledge-review"
        >
          <h2 id="knowledge-review" className="flex items-center gap-2 text-h2 font-bold">
            <FileSearch aria-hidden="true" className="size-5" />
            Fila de revisao CREF
          </h2>
          {pending.length === 0 ? (
            <p className="mt-2 text-label text-muted-foreground">
              Nenhum documento aguardando revisao.
            </p>
          ) : (
            <ul className="mt-4 grid gap-3">
              {pending.map((document) => (
                <li key={document.id} className="rounded-lg border border-border p-4">
                  <p className="font-semibold">{document.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {document.originalFilename} · {document.sizeBytes} bytes · SHA-256{' '}
                    {document.sha256.slice(0, 12)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={saving}
                      onClick={() =>
                        void getKnowledgeDocumentContent(document.id)
                          .then((response) => setPreview(response.data))
                          .catch((caught: unknown) =>
                            setWriteError(
                              caught instanceof ControlCenterApiError
                                ? caught.message
                                : 'Nao foi possivel abrir o original.',
                            ),
                          )
                      }
                    >
                      <FileSearch aria-hidden="true" />
                      Ver conteudo
                    </Button>
                    <Button
                      disabled={saving}
                      onClick={() =>
                        void run(
                          () =>
                            reviewKnowledgeDocument({
                              documentId: document.id,
                              decision: 'APPROVED',
                              note: 'Conteudo revisado e aprovado pelo profissional CREF',
                            }),
                          'Documento aprovado e indexado.',
                        )
                      }
                    >
                      <CheckCircle2 aria-hidden="true" />
                      Aprovar e indexar
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={saving}
                      onClick={() =>
                        void run(
                          () =>
                            reviewKnowledgeDocument({
                              documentId: document.id,
                              decision: 'REJECTED',
                              note: 'Conteudo recusado pelo profissional CREF',
                            }),
                          'Documento recusado; o historico foi preservado.',
                        )
                      }
                    >
                      <XCircle aria-hidden="true" />
                      Recusar
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {preview ? (
            <div className="mt-4 rounded-lg border border-border bg-secondary p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">Original em quarentena</h3>
                <Button variant="outline" size="sm" onClick={() => setPreview(null)}>
                  Fechar
                </Button>
              </div>
              <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-label">
                {preview.content}
              </pre>
            </div>
          ) : null}
        </section>
      ) : null}

      {!canUpload && !canApprove ? (
        <p className="mt-6 flex items-center gap-2 rounded-lg border border-border bg-secondary p-3 text-label">
          <Lock aria-hidden="true" className="size-4" />
          Seu acesso permite consultar o corpus e o historico.
        </p>
      ) : null}

      <section
        className="mt-6 rounded-xl border border-border bg-card p-5"
        aria-labelledby="knowledge-history"
      >
        <h2 id="knowledge-history" className="text-h2 font-bold">
          Documentos e proveniencia
        </h2>
        <ul className="mt-4 grid gap-3">
          {data.data.documents.map((document) => (
            <li key={document.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{document.title}</p>
                <span className="rounded-full bg-secondary px-2 py-1 text-xs">
                  {document.status}
                </span>
              </div>
              <p className="mt-1 text-label text-muted-foreground">
                {document.topic} · {document.chunkCount} trechos · ID {document.id.slice(0, 8)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Original{' '}
                {document.blobAvailable
                  ? `retido ate ${document.retainedUntil ? new Date(document.retainedUntil).toLocaleDateString('pt-BR') : 'a data definida'}`
                  : 'eliminado pela politica de retencao'}
                .
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
