import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

const { getKnowledgeDocuments } = vi.hoisted(() => ({ getKnowledgeDocuments: vi.fn() }));

vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getKnowledgeDocuments,
}));

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

beforeEach(() => getKnowledgeDocuments.mockReset().mockResolvedValue(response));

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
});
