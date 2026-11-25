import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

const { getKnowledgeDocuments } = vi.hoisted(() => ({ getKnowledgeDocuments: vi.fn() }));

vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getKnowledgeDocuments,
}));

import { KnowledgeHistoryPanel } from './knowledge-history';

const meta = {
  generatedAt: '2026-08-20T12:00:00.000Z',
  timezone: 'America/Sao_Paulo' as const,
  dataQuality: [],
};

const knowledgeResponse = {
  data: {
    documents: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        title: 'Evidência de descanso',
        topic: 'descanso',
        sourceUrl: null,
        originalFilename: 'descanso.md',
        mimeType: 'text/markdown',
        sizeBytes: 120,
        sha256: 'b'.repeat(64),
        status: 'PUBLISHED' as const,
        uploadedBy: 'Admin',
        reviewer: 'RT CREF',
        reviewNote: 'Conteúdo conferido',
        createdAt: '2026-08-15T12:00:00.000Z',
        reviewedAt: '2026-08-16T12:00:00.000Z',
        retainedUntil: '2027-08-16T12:00:00.000Z',
        blobAvailable: true,
        chunkCount: 3,
        statusUpdatedAt: '2026-08-20T10:00:00.000Z',
      },
    ],
    policy: {
      allowedTypes: ['text/plain', 'text/markdown'],
      maxBytes: 524_288,
      quarantineDays: 30,
      approvedOriginalDays: 365,
    },
  },
  meta,
};

beforeEach(() => {
  getKnowledgeDocuments.mockReset();
});

describe('KnowledgeHistoryPanel', () => {
  it('lista os documentos em uma linha do tempo, mais recente primeiro', async () => {
    getKnowledgeDocuments.mockResolvedValue(knowledgeResponse);

    render(<KnowledgeHistoryPanel />);

    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('Evidência de descanso');
  });

  it('sem eventos, mostra o estado vazio', async () => {
    getKnowledgeDocuments.mockResolvedValue({
      ...knowledgeResponse,
      data: { ...knowledgeResponse.data, documents: [] },
    });

    render(<KnowledgeHistoryPanel />);

    expect(await screen.findByText('Ainda não há alterações registradas.')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('sem campos opcionais, cai nos textos e datas de fallback', async () => {
    getKnowledgeDocuments.mockResolvedValue({
      ...knowledgeResponse,
      data: {
        ...knowledgeResponse.data,
        documents: [
          {
            ...knowledgeResponse.data.documents[0],
            uploadedBy: null,
            reviewer: null,
            reviewNote: null,
            reviewedAt: null,
            statusUpdatedAt: null,
          },
        ],
      },
    });
    render(<KnowledgeHistoryPanel />);

    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(1);
    // "Responsável não informado" fica ao lado do ID técnico no mesmo <p> — texto quebrado
    // entre nós, por isso a contagem via textContent em vez de getAllByText.
    expect(document.body.textContent?.match(/Responsável não informado/g)).toHaveLength(1);
    expect(screen.getByText('Arquivo descanso.md')).toBeInTheDocument();
  });

  it('só mostra o link de auditoria completa quando o ator pode ler auditoria', async () => {
    getKnowledgeDocuments.mockResolvedValue(knowledgeResponse);

    const { rerender } = render(<KnowledgeHistoryPanel canReadAudit={false} />);
    await screen.findAllByRole('listitem');
    expect(screen.queryByRole('link', { name: /auditoria completa/i })).not.toBeInTheDocument();

    rerender(<KnowledgeHistoryPanel canReadAudit />);
    expect(await screen.findByRole('link', { name: /auditoria completa/i })).toHaveAttribute(
      'href',
      '/dashboard/sistema/auditoria',
    );
  });
});
