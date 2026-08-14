import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

const {
  getKnowledgeDocumentContent,
  getKnowledgeDocuments,
  reviewKnowledgeDocument,
  uploadKnowledgeDocument,
} = vi.hoisted(() => ({
  getKnowledgeDocumentContent: vi.fn(),
  getKnowledgeDocuments: vi.fn(),
  reviewKnowledgeDocument: vi.fn(),
  uploadKnowledgeDocument: vi.fn(),
}));

vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getKnowledgeDocumentContent,
  getKnowledgeDocuments,
  reviewKnowledgeDocument,
  uploadKnowledgeDocument,
}));

import { ControlCenterApiError } from '@/lib/control-center-api';

import { AiKnowledgeDashboard } from './ai-knowledge';

const response = {
  data: {
    documents: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Guia de descanso',
        topic: 'descanso',
        sourceUrl: null,
        originalFilename: 'guia.md',
        mimeType: 'text/markdown',
        sizeBytes: 120,
        sha256: 'a'.repeat(64),
        status: 'PENDING' as const,
        uploadedBy: 'Rodrigo',
        reviewer: null,
        reviewNote: null,
        createdAt: '2026-08-14T12:00:00.000Z',
        reviewedAt: null,
        retainedUntil: '2026-09-13T12:00:00.000Z',
        blobAvailable: true,
        chunkCount: 0,
      },
    ],
    policy: {
      allowedTypes: ['text/plain', 'text/markdown'],
      maxBytes: 524288,
      quarantineDays: 30,
      approvedOriginalDays: 365,
    },
  },
  meta: {
    generatedAt: '2026-08-14T12:00:00.000Z',
    timezone: 'America/Sao_Paulo' as const,
    dataQuality: [],
  },
};

const [document] = response.data.documents;
if (!document) throw new Error('fixture sem documento');

beforeEach(() => {
  getKnowledgeDocuments.mockReset().mockResolvedValue(response);
  getKnowledgeDocumentContent.mockReset().mockResolvedValue({
    data: { id: document.id, content: 'texto original em quarentena' },
    meta: response.meta,
  });
  reviewKnowledgeDocument.mockReset().mockResolvedValue(response);
  uploadKnowledgeDocument.mockReset().mockResolvedValue(response);
});

describe('AiKnowledgeDashboard', () => {
  it('leitor ve metadados sem controles de upload ou aprovacao', async () => {
    render(<AiKnowledgeDashboard />);
    expect(await screen.findByText('Guia de descanso')).toBeVisible();
    expect(screen.queryByText('Enviar para quarentena')).toBeNull();
    expect(screen.queryByText('Fila de revisao CREF')).toBeNull();
  });

  it('separa envio e aprovacao por capability', async () => {
    const { unmount } = render(<AiKnowledgeDashboard canUpload />);
    expect(await screen.findByText('Enviar para quarentena')).toBeVisible();
    expect(screen.queryByText('Fila de revisao CREF')).toBeNull();
    unmount();

    render(<AiKnowledgeDashboard canApprove />);
    expect(await screen.findByText('Fila de revisao CREF')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Aprovar e indexar' })).toBeVisible();
    expect(screen.queryByText('Enviar para quarentena')).toBeNull();
  });

  it('em 403 explica o bloqueio sem oferecer nova tentativa', async () => {
    getKnowledgeDocuments
      .mockReset()
      .mockRejectedValue(new ControlCenterApiError(403, 'Sem acesso ao corpus.'));
    render(<AiKnowledgeDashboard />);
    expect(
      await screen.findByRole('heading', { name: 'Este setor não faz parte do seu acesso' }),
    ).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('só libera o envio quando o rascunho está completo', async () => {
    const user = userEvent.setup();
    render(<AiKnowledgeDashboard canUpload />);
    const enviar = await screen.findByRole('button', { name: 'Enviar arquivo' });
    expect(enviar).toBeDisabled();

    await user.type(screen.getByLabelText(/Titulo/), 'Guia de descanso');
    await user.type(screen.getByLabelText(/Topico/), 'descanso');
    expect(enviar).toBeDisabled();

    await user.upload(
      screen.getByLabelText(/Arquivo/),
      new File(['conteudo do guia'], 'guia.md', { type: 'text/markdown' }),
    );
    await waitFor(() => expect(enviar).toBeEnabled());

    await user.click(enviar);
    await waitFor(() =>
      expect(uploadKnowledgeDocument).toHaveBeenCalledWith(
        expect.objectContaining({ originalFilename: 'guia.md', mimeType: 'text/markdown' }),
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('quarentena');
  });

  it('revisor abre o original em quarentena e consegue fechá-lo', async () => {
    const user = userEvent.setup();
    render(<AiKnowledgeDashboard canApprove />);
    await user.click(await screen.findByRole('button', { name: 'Ver conteudo' }));
    expect(await screen.findByText('texto original em quarentena')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByText('texto original em quarentena')).not.toBeInTheDocument();
  });

  it('recusa registrada mantém o histórico e confirma na tela', async () => {
    const user = userEvent.setup();
    render(<AiKnowledgeDashboard canApprove />);
    await user.click(await screen.findByRole('button', { name: 'Recusar' }));
    await waitFor(() =>
      expect(reviewKnowledgeDocument).toHaveBeenCalledWith(
        expect.objectContaining({ decision: 'REJECTED' }),
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('historico foi preservado');
  });

  it('falha de aprovação vira alerta com a mensagem do servidor', async () => {
    const user = userEvent.setup();
    reviewKnowledgeDocument.mockRejectedValueOnce(
      new ControlCenterApiError(409, 'Documento já revisado por outra pessoa.'),
    );
    render(<AiKnowledgeDashboard canApprove />);
    await user.click(await screen.findByRole('button', { name: 'Aprovar e indexar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Documento já revisado por outra pessoa.',
    );
  });
});
