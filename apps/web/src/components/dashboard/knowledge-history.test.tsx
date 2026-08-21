import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

const { getKnowledgeDocuments, getMethodology } = vi.hoisted(() => ({
  getKnowledgeDocuments: vi.fn(),
  getMethodology: vi.fn(),
}));

vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getKnowledgeDocuments,
  getMethodology,
}));

import { KnowledgeHistoryPanel } from './knowledge-history';

const meta = {
  generatedAt: '2026-08-20T12:00:00.000Z',
  timezone: 'America/Sao_Paulo' as const,
  dataQuality: [],
};

const methodologyResponse = {
  data: {
    versions: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        version: 1,
        status: 'PUBLISHED' as const,
        content: 'x'.repeat(200),
        sha256: 'a'.repeat(64),
        changeNote: 'Versão inicial migrada.',
        createdBy: 'Rodrigo',
        reviewedBy: 'Profissional CREF',
        createdAt: '2026-08-18T12:00:00.000Z',
        reviewedAt: '2026-08-18T13:00:00.000Z',
        publishedAt: '2026-08-18T14:00:00.000Z',
        statusChangedAt: '2026-08-19T09:00:00.000Z',
        current: true,
      },
    ],
    currentVersionId: '11111111-1111-4111-8111-111111111111',
  },
  meta,
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
  getMethodology.mockReset();
});

describe('KnowledgeHistoryPanel', () => {
  it('mescla metodologia e documentos em uma linha do tempo, mais recente primeiro', async () => {
    getKnowledgeDocuments.mockResolvedValue(knowledgeResponse);
    getMethodology.mockResolvedValue(methodologyResponse);

    render(<KnowledgeHistoryPanel />);

    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    // O evento de documento (2026-08-20) é mais recente que o da metodologia (2026-08-19).
    expect(items[0]).toHaveTextContent('Evidência de descanso');
    expect(items[1]).toHaveTextContent('Versão 1');
  });

  it('sem eventos, mostra o estado vazio', async () => {
    getKnowledgeDocuments.mockResolvedValue({
      ...knowledgeResponse,
      data: { ...knowledgeResponse.data, documents: [] },
    });
    getMethodology.mockResolvedValue({
      ...methodologyResponse,
      data: { ...methodologyResponse.data, versions: [] },
    });

    render(<KnowledgeHistoryPanel />);

    expect(await screen.findByText('Ainda não há alterações registradas.')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('só mostra o link de auditoria completa quando o ator pode ler auditoria', async () => {
    getKnowledgeDocuments.mockResolvedValue(knowledgeResponse);
    getMethodology.mockResolvedValue(methodologyResponse);

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
