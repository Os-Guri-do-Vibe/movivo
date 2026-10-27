import { exampleParameters, methodologyDomainSpec } from '@movivo/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as StudioApi from '@/lib/methodology-studio-api';

const api = vi.hoisted(() => ({
  getVersions: vi.fn(),
  getDocument: vi.fn(),
  openDraft: vi.fn(),
  saveDraft: vi.fn(),
  testDraft: vi.fn(),
  publishDraft: vi.fn(),
  discardDraft: vi.fn(),
}));

vi.mock('@/lib/methodology-studio-api', async (importOriginal) => ({
  ...(await importOriginal<typeof StudioApi>()),
  ...api,
}));

import { MethodologyStudioEditor } from './methodology-studio-editor';

const spec = methodologyDomainSpec('RECOVERY');
const DRAFT_ID = '22222222-2222-4222-8222-222222222222';

function draft(status: 'DRAFT' | 'TESTING', minSleepHours = 6) {
  const parameters = exampleParameters(spec);
  parameters.flags = { ...parameters.flags, minSleepHours };
  return {
    id: DRAFT_ID,
    domain: 'RECOVERY',
    version: 2,
    status,
    parameters,
    guidance: {},
    justifications: {},
    changeNote: 'Rascunho',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getVersions.mockResolvedValue([
    {
      id: DRAFT_ID,
      version: 2,
      status: 'DRAFT',
      changeNote: 'Rascunho',
      publishedAt: null,
      createdAt: '2026-10-27T12:00:00.000Z',
    },
  ]);
});

describe('estúdio de metodologia', () => {
  it('mostra cada campo com dica e faixa usual', async () => {
    api.getDocument.mockResolvedValue({ document: draft('DRAFT'), diff: [] });
    render(<MethodologyStudioEditor domain="RECOVERY" canEdit />);
    expect(await screen.findByText('Sono abaixo de')).toBeInTheDocument();
    expect(screen.getByText(/Média de 3 noites abaixo disso/)).toBeInTheDocument();
    expect(screen.getAllByText('faixa usual 5–7 h').length).toBeGreaterThan(0);
  });

  it('valor fora da faixa usual pede justificativa', async () => {
    api.getDocument.mockResolvedValue({ document: draft('DRAFT', 8), diff: [] });
    render(<MethodologyStudioEditor domain="RECOVERY" canEdit />);
    expect(await screen.findByText(/justifique para poder testar e publicar/)).toBeInTheDocument();
  });

  it('publicar só fica disponível depois de aprovado nos testes', async () => {
    api.getDocument.mockResolvedValueOnce({ document: draft('DRAFT'), diff: [] });
    render(<MethodologyStudioEditor domain="RECOVERY" canEdit />);
    const publish = await screen.findByRole('button', { name: /Publicar/ });
    expect(publish).toBeDisabled();

    api.testDraft.mockResolvedValue({ passed: true, evaluations: [], unjustified: [] });
    api.getDocument.mockResolvedValue({ document: draft('TESTING'), diff: [] });
    await userEvent.click(screen.getByRole('button', { name: /Testar/ }));
    expect(await screen.findByText(/Aprovado nos testes — pode publicar/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Publicar/ })).toBeEnabled());
  });

  it('sem permissão de edição, não oferece ações', async () => {
    api.getDocument.mockResolvedValue({ document: draft('DRAFT'), diff: [] });
    render(<MethodologyStudioEditor domain="RECOVERY" canEdit={false} />);
    await screen.findByText('Sono abaixo de');
    expect(screen.queryByRole('button', { name: /Testar/ })).not.toBeInTheDocument();
  });
});
