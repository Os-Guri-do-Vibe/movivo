import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

let pathname = '/dashboard/ia/base-conhecimento/documentos';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

const { getKnowledgeDocuments, getMethodology } = vi.hoisted(() => ({
  getKnowledgeDocuments: vi.fn(),
  getMethodology: vi.fn(),
}));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getKnowledgeDocuments,
  getMethodology,
}));

import { KnowledgeBaseShell } from './knowledge-base-shell';

const meta = {
  generatedAt: '2026-08-20T12:00:00.000Z',
  timezone: 'America/Sao_Paulo' as const,
  dataQuality: [],
};

beforeEach(() => {
  pathname = '/dashboard/ia/base-conhecimento/documentos';
  getKnowledgeDocuments.mockReset().mockResolvedValue({
    data: {
      documents: [{ status: 'PUBLISHED' }, { status: 'READY_FOR_REVIEW' }, { status: 'FAILED' }],
      policy: {
        allowedTypes: ['text/plain'],
        maxBytes: 524288,
        quarantineDays: 30,
        approvedOriginalDays: 365,
      },
    },
    meta,
  });
  getMethodology.mockReset().mockResolvedValue({
    data: {
      versions: [{ id: 'methodology', version: 7, status: 'PUBLISHED', current: true }],
    },
    meta,
  });
});

describe('KnowledgeBaseShell', () => {
  it('mantém um único h1 e navegação por URLs reais', async () => {
    render(
      <KnowledgeBaseShell>
        <h2>Documentos e evidências</h2>
      </KnowledgeBaseShell>,
    );

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Base de Conhecimento' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Documentos' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Metodologia' })).toHaveAttribute(
      'href',
      '/dashboard/ia/base-conhecimento',
    );
    expect(screen.getByRole('link', { name: 'Segurança' })).toHaveAttribute(
      'href',
      '/dashboard/ia/base-conhecimento/seguranca',
    );
    expect(await screen.findByText('v7')).toBeVisible();
    expect(screen.getByText('Falhas no processamento').nextElementSibling).toHaveTextContent('1');
  });

  it('expõe degradação parcial sem esconder o conteúdo da seção', async () => {
    getMethodology.mockRejectedValueOnce(new Error('endpoint em implantação'));
    render(
      <KnowledgeBaseShell>
        <h2>Conteúdo preservado</h2>
      </KnowledgeBaseShell>,
    );
    expect(screen.getByRole('heading', { name: 'Conteúdo preservado' })).toBeVisible();
    expect(await screen.findByRole('status')).toHaveTextContent('Parte do resumo');
  });
});
