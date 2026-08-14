import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

const { getFaqEntries, publishFaqEntry, retireFaqEntry, rollbackFaqEntry, simulateAgentConfig } =
  vi.hoisted(() => ({
    getFaqEntries: vi.fn(),
    publishFaqEntry: vi.fn(),
    retireFaqEntry: vi.fn(),
    rollbackFaqEntry: vi.fn(),
    simulateAgentConfig: vi.fn(),
  }));

vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getFaqEntries,
  publishFaqEntry,
  retireFaqEntry,
  rollbackFaqEntry,
  simulateAgentConfig,
}));

import { AiFaqDashboard } from './ai-faq';

const meta = {
  generatedAt: '2026-08-13T12:00:00.000Z',
  timezone: 'America/Sao_Paulo' as const,
  dataQuality: [],
};
const response = {
  data: {
    versions: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        faqKey: '22222222-2222-4222-8222-222222222222',
        canonicalQuestion: 'Como recebo meu plano?',
        answer: 'O plano chega pelo WhatsApp com acompanhamento do profissional CREF.',
        version: 2,
        status: 'PUBLISHED' as const,
        changeNote: 'Texto mais claro',
        createdBy: 'Rodrigo',
        createdAt: '2026-08-13T11:00:00.000Z',
        current: true,
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        faqKey: '22222222-2222-4222-8222-222222222222',
        canonicalQuestion: 'Como recebo meu plano?',
        answer: 'O plano chega pelo WhatsApp.',
        version: 1,
        status: 'PUBLISHED' as const,
        changeNote: 'Versão inicial',
        createdBy: 'Pedro',
        createdAt: '2026-08-12T11:00:00.000Z',
        current: false,
      },
    ],
  },
  meta,
};

beforeEach(() => {
  getFaqEntries.mockReset().mockResolvedValue(response);
  publishFaqEntry.mockReset().mockResolvedValue(response);
  retireFaqEntry.mockReset().mockResolvedValue(response);
  rollbackFaqEntry.mockReset().mockResolvedValue(response);
  simulateAgentConfig.mockReset().mockResolvedValue({
    data: {
      kind: 'FAQ',
      passed: true,
      candidateHash: 'a'.repeat(64),
      checks: [
        { id: 'SCHEMA', title: 'Contrato', passed: true, cases: 1, failures: [] },
        { id: 'GOLDEN_INPUT', title: 'Guardrail', passed: true, cases: 10, failures: [] },
        { id: 'GOLDEN_OUTPUT', title: 'Linguagem', passed: true, cases: 1, failures: [] },
        { id: 'PROMPT_INTEGRITY', title: 'Match', passed: true, cases: 1, failures: [] },
      ],
    },
    meta,
  });
});

describe('AiFaqDashboard', () => {
  it('leitor consulta respostas e histórico sem controles de mutação', async () => {
    render(<AiFaqDashboard />);
    expect(await screen.findByText('Respostas vigentes')).toBeVisible();
    expect(screen.getAllByText('Como recebo meu plano?').length).toBeGreaterThan(0);
    expect(screen.queryByText('Nova resposta')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Republicar' })).toBeNull();
  });

  it('só libera publicação depois das quatro etapas', async () => {
    const user = userEvent.setup();
    render(<AiFaqDashboard canWrite />);
    await screen.findByText('Nova resposta');
    await user.type(screen.getByLabelText('Pergunta canônica'), 'Quando chega o meu plano?');
    await user.type(
      screen.getByLabelText(/Resposta revisada/),
      'O plano chega pelo WhatsApp com acompanhamento do profissional CREF.',
    );
    await user.type(screen.getByLabelText('Motivo da mudança'), 'Nova dúvida recorrente');
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Executar as 4 etapas' }));
    expect(await screen.findByRole('button', { name: 'Publicar' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Publicar' }));
    await waitFor(() =>
      expect(publishFaqEntry).toHaveBeenCalledWith({
        faqKey: undefined,
        canonicalQuestion: 'Quando chega o meu plano?',
        answer: 'O plano chega pelo WhatsApp com acompanhamento do profissional CREF.',
        changeNote: 'Nova dúvida recorrente',
      }),
    );
  });

  it('republica versão histórica como nova versão', async () => {
    const user = userEvent.setup();
    render(<AiFaqDashboard canWrite />);
    await user.click(await screen.findByRole('button', { name: 'Republicar' }));
    await waitFor(() =>
      expect(rollbackFaqEntry).toHaveBeenCalledWith({
        faqKey: '22222222-2222-4222-8222-222222222222',
        targetVersion: 1,
        changeNote: 'Retorno à versão 1',
      }),
    );
  });
});
