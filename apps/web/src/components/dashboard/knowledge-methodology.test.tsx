import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

const {
  createMethodologyVersion,
  getMethodology,
  publishMethodologyVersion,
  reviewMethodologyVersion,
  rollbackMethodologyVersion,
  submitMethodologyVersion,
} = vi.hoisted(() => ({
  createMethodologyVersion: vi.fn(),
  getMethodology: vi.fn(),
  publishMethodologyVersion: vi.fn(),
  reviewMethodologyVersion: vi.fn(),
  rollbackMethodologyVersion: vi.fn(),
  submitMethodologyVersion: vi.fn(),
}));

vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  createMethodologyVersion,
  getMethodology,
  publishMethodologyVersion,
  reviewMethodologyVersion,
  rollbackMethodologyVersion,
  submitMethodologyVersion,
}));

import { KnowledgeMethodologyPanel } from './knowledge-methodology';

const CONTENT = `${'Diretriz metodológica validada pelo profissional CREF. '.repeat(6)}\nProgressão conservadora e revisão humana.`;
const SUMMARY =
  'Resumo metodológico validado pelo profissional CREF para explicar decisões do protocolo com linguagem simples, sem criar prescrição nova e sem substituir a supervisão humana. '.repeat(
    2,
  );
const meta = {
  generatedAt: '2026-08-20T12:00:00.000Z',
  timezone: 'America/Sao_Paulo' as const,
  dataQuality: [],
};
const response = {
  data: {
    versions: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        version: 1,
        status: 'PUBLISHED' as const,
        content: CONTENT,
        summary: SUMMARY.trim(),
        sha256: 'a'.repeat(64),
        changeNote: 'Versão inicial migrada.',
        createdBy: 'Rodrigo',
        reviewedBy: 'Profissional CREF',
        createdAt: '2026-08-18T12:00:00.000Z',
        reviewedAt: '2026-08-18T13:00:00.000Z',
        publishedAt: '2026-08-18T14:00:00.000Z',
        statusChangedAt: '2026-08-18T14:00:00.000Z',
        current: true,
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        version: 2,
        status: 'DRAFT' as const,
        content: `${CONTENT}\nRascunho.`,
        summary: SUMMARY,
        sha256: 'b'.repeat(64),
        changeNote: 'Inclui nova progressão.',
        createdBy: 'Admin',
        reviewedBy: null,
        createdAt: '2026-08-19T12:00:00.000Z',
        reviewedAt: null,
        publishedAt: null,
        statusChangedAt: '2026-08-19T12:00:00.000Z',
        current: false,
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        version: 3,
        status: 'IN_REVIEW' as const,
        content: `${CONTENT}\nEm revisão.`,
        summary: SUMMARY,
        sha256: 'c'.repeat(64),
        changeNote: 'Ajusta deload programado.',
        createdBy: 'Admin',
        reviewedBy: null,
        createdAt: '2026-08-20T10:00:00.000Z',
        reviewedAt: null,
        publishedAt: null,
        statusChangedAt: '2026-08-20T11:00:00.000Z',
        current: false,
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        version: 4,
        status: 'APPROVED' as const,
        content: `${CONTENT}\nAprovada.`,
        summary: SUMMARY,
        sha256: 'd'.repeat(64),
        changeNote: 'Parecer CREF concluído.',
        createdBy: 'Admin',
        reviewedBy: 'Profissional CREF',
        createdAt: '2026-08-20T09:00:00.000Z',
        reviewedAt: '2026-08-20T11:30:00.000Z',
        publishedAt: null,
        statusChangedAt: '2026-08-20T11:30:00.000Z',
        current: false,
      },
      {
        id: '55555555-5555-4555-8555-555555555555',
        version: 0,
        status: 'ARCHIVED' as const,
        content: `${CONTENT}\nArquivada.`,
        summary: SUMMARY,
        sha256: 'e'.repeat(64),
        changeNote: 'Versão anterior.',
        createdBy: 'Admin',
        reviewedBy: 'Profissional CREF',
        createdAt: '2026-08-17T09:00:00.000Z',
        reviewedAt: '2026-08-17T10:00:00.000Z',
        publishedAt: '2026-08-17T11:00:00.000Z',
        statusChangedAt: '2026-08-18T14:00:00.000Z',
        current: false,
      },
    ],
  },
  meta,
};

beforeEach(() => {
  getMethodology.mockReset().mockResolvedValue(response);
  for (const mutation of [
    createMethodologyVersion,
    publishMethodologyVersion,
    reviewMethodologyVersion,
    rollbackMethodologyVersion,
    submitMethodologyVersion,
  ]) {
    mutation.mockReset().mockResolvedValue(response);
  }
});

describe('KnowledgeMethodologyPanel', () => {
  it('mostra a versão vigente sem criar outro h1', async () => {
    render(<KnowledgeMethodologyPanel />);
    expect(
      await screen.findByRole('heading', { name: 'Metodologia oficial', level: 2 }),
    ).toBeVisible();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getAllByText('v1')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Criar nova versão' })).not.toBeInTheDocument();
  });

  it('salva uma cópia editável como rascunho sem publicar', async () => {
    const user = userEvent.setup();
    render(<KnowledgeMethodologyPanel canEdit />);
    await user.click(await screen.findByRole('button', { name: 'Criar nova versão' }));
    await user.type(screen.getByLabelText('Motivo da mudança'), 'Ajuste metodológico auditável.');
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() =>
      expect(createMethodologyVersion).toHaveBeenCalledWith({
        content: CONTENT,
        summary: SUMMARY.trim(),
        changeNote: 'Ajuste metodológico auditável.',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('ainda não afeta a IA');
  });

  it('mantém aprovação e publicação como confirmações separadas', async () => {
    const user = userEvent.setup();
    render(<KnowledgeMethodologyPanel canApprove />);

    await user.click(await screen.findByRole('button', { name: 'Aprovar' }));
    expect(screen.getByRole('button', { name: 'Confirmar transição' })).toBeDisabled();
    await user.type(
      screen.getByLabelText('Justificativa obrigatória'),
      'Parecer técnico favorável.',
    );
    await user.click(screen.getByRole('button', { name: 'Confirmar transição' }));
    await waitFor(() =>
      expect(reviewMethodologyVersion).toHaveBeenCalledWith(
        '33333333-3333-4333-8333-333333333333',
        { decision: 'APPROVED', note: 'Parecer técnico favorável.' },
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('publicação ainda exige');

    await user.click(screen.getByRole('button', { name: 'Publicar' }));
    await user.type(
      screen.getByLabelText('Justificativa obrigatória'),
      'Publicação autorizada pelo CREF.',
    );
    await user.click(screen.getByRole('button', { name: 'Confirmar transição' }));
    await waitFor(() =>
      expect(publishMethodologyVersion).toHaveBeenCalledWith(
        '44444444-4444-4444-8444-444444444444',
        'Publicação autorizada pelo CREF.',
      ),
    );
  });

  it('compara a versão vigente com outra e destaca as linhas alteradas', async () => {
    const user = userEvent.setup();
    render(<KnowledgeMethodologyPanel />);
    const compareButtons = await screen.findAllByRole('button', { name: 'Comparar' });
    // versions[1] é a v2 (DRAFT), com uma linha extra ("Rascunho.") em relação à v1 vigente.
    const compareV2 = compareButtons[1];
    expect(compareV2).toBeDefined();
    await user.click(compareV2 as HTMLElement);

    expect(
      await screen.findByRole('heading', { name: 'Comparação com a versão vigente' }),
    ).toBeVisible();
    expect(screen.getByText('1 linha(s) alterada(s)')).toBeVisible();
  });

  it('rollback de versão arquivada cria proposta apenas para quem pode editar', async () => {
    const user = userEvent.setup();
    render(<KnowledgeMethodologyPanel canEdit />);
    await user.click(await screen.findByRole('button', { name: 'Restaurar' }));
    await user.type(
      screen.getByLabelText('Justificativa obrigatória'),
      'Reavaliar versão anterior.',
    );
    await user.click(screen.getByRole('button', { name: 'Confirmar transição' }));
    await waitFor(() =>
      expect(rollbackMethodologyVersion).toHaveBeenCalledWith(
        '55555555-5555-4555-8555-555555555555',
        'Reavaliar versão anterior.',
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('nova versão auditável');
  });
});
