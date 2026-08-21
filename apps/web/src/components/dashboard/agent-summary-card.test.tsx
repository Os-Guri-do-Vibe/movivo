import { DEFAULT_AGENT_PERSONA } from '@movivo/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useAgentPersona } = vi.hoisted(() => ({ useAgentPersona: vi.fn() }));

vi.mock('./agent-persona-context', () => ({ useAgentPersona }));

import { AgentSummaryCard } from './agent-summary-card';

const meta = {
  generatedAt: '2026-08-21T12:00:00.000Z',
  timezone: 'America/Sao_Paulo' as const,
  dataQuality: [],
};

const BASE = {
  current: DEFAULT_AGENT_PERSONA,
  changedFields: [] as string[],
  canWrite: true,
  discard: vi.fn(),
  loading: false,
  error: '',
};

function topicVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    topicKey: 'exemplo',
    label: 'Tema de exemplo',
    phrases: ['exemplo'],
    action: 'BLOCK' as const,
    version: 1,
    status: 'DRAFT' as const,
    changeNote: 'proposta inicial',
    createdBy: null,
    approvedBy: null,
    createdAt: '2026-08-21T12:00:00.000Z',
    current: true,
    ...overrides,
  };
}

const onOpenPersona = vi.fn();
const renderCard = () => render(<AgentSummaryCard onOpenPersona={onOpenPersona} />);

describe('AgentSummaryCard', () => {
  beforeEach(() => {
    onOpenPersona.mockClear();
    BASE.discard.mockClear();
  });

  it('sem dados: "—" no avatar e "Sem configuração"', () => {
    useAgentPersona.mockReturnValue({ ...BASE, current: null, data: null });
    renderCard();
    expect(screen.getByText('Sem configuração')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Agente' })).toBeVisible();
  });

  it('carregando (sem dado ainda): badge "Carregando"', () => {
    useAgentPersona.mockReturnValue({ ...BASE, current: null, data: null, loading: true });
    renderCard();
    expect(screen.getByText('Carregando')).toBeVisible();
  });

  it('erro (sem dado ainda): badge "Indisponível"', () => {
    useAgentPersona.mockReturnValue({
      ...BASE,
      current: null,
      data: null,
      error: 'falhou',
    });
    renderCard();
    expect(screen.getByText('Indisponível')).toBeVisible();
  });

  it('com dado: badge "Ativo", versão vigente e data de atualização', () => {
    useAgentPersona.mockReturnValue({
      ...BASE,
      data: { persona: DEFAULT_AGENT_PERSONA, version: 3, topics: null, meta },
    });
    renderCard();
    expect(screen.getByText('Ativo')).toBeVisible();
    expect(screen.getByText('v3 · vigente')).toBeVisible();
    expect(screen.getByText(/Atualizado em/)).toBeVisible();
  });

  it('versão nula: "Padrão do código"', () => {
    useAgentPersona.mockReturnValue({
      ...BASE,
      data: { persona: DEFAULT_AGENT_PERSONA, version: null, topics: null, meta },
    });
    renderCard();
    expect(screen.getByText('Padrão do código')).toBeVisible();
  });

  it('canWrite=false: mostra "Acesso de leitura" e nunca "Revisar e publicar"', () => {
    useAgentPersona.mockReturnValue({
      ...BASE,
      canWrite: false,
      data: { persona: DEFAULT_AGENT_PERSONA, version: 1, topics: null, meta },
    });
    renderCard();
    expect(screen.getByText('Acesso de leitura')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Revisar e publicar' })).not.toBeInTheDocument();
  });

  it('canWrite=true: "Revisar e publicar" e "Ver histórico" acionam onOpenPersona("revisao")', async () => {
    const user = userEvent.setup();
    useAgentPersona.mockReturnValue({
      ...BASE,
      data: { persona: DEFAULT_AGENT_PERSONA, version: 1, topics: null, meta },
    });
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Ver histórico' }));
    expect(onOpenPersona).toHaveBeenCalledWith('revisao');
    await user.click(screen.getByRole('button', { name: 'Revisar e publicar' }));
    expect(onOpenPersona).toHaveBeenLastCalledWith('revisao');
  });

  it('1 alteração pendente: singular, e permite descartar quando canWrite', async () => {
    const user = userEvent.setup();
    useAgentPersona.mockReturnValue({
      ...BASE,
      changedFields: ['agentName'],
      data: { persona: DEFAULT_AGENT_PERSONA, version: 2, topics: null, meta },
    });
    renderCard();
    expect(screen.getByText('1 alteração não publicada')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Descartar alterações' }));
    await user.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(BASE.discard).toHaveBeenCalledOnce();
  });

  it('múltiplas alterações pendentes: plural, sem descarte quando canWrite=false', () => {
    useAgentPersona.mockReturnValue({
      ...BASE,
      canWrite: false,
      changedFields: ['agentName', 'agentSelfIntro'],
      data: { persona: DEFAULT_AGENT_PERSONA, version: 2, topics: null, meta },
    });
    renderCard();
    expect(screen.getByText('2 alterações não publicadas')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Descartar alterações' })).not.toBeInTheDocument();
  });

  it('descrição do descarte referencia "configuração padrão" quando a versão vigente é nula', async () => {
    const user = userEvent.setup();
    useAgentPersona.mockReturnValue({
      ...BASE,
      changedFields: ['agentName'],
      data: { persona: DEFAULT_AGENT_PERSONA, version: null, topics: null, meta },
    });
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Descartar alterações' }));
    expect(screen.getByText(/a configuração padrão continua valendo/i)).toBeVisible();
  });

  it('1 tema proibido pendente: singular', () => {
    useAgentPersona.mockReturnValue({
      ...BASE,
      data: {
        persona: DEFAULT_AGENT_PERSONA,
        version: 1,
        topics: { versions: [topicVersion()], activeLabels: [], limits: { maxActiveTopics: 12 } },
        meta,
      },
    });
    renderCard();
    expect(
      screen.getByText('1 tema proibido aguarda conclusão do fluxo de aprovação'),
    ).toBeVisible();
  });

  it('múltiplos temas proibidos pendentes: plural, ignora versões não-current e RETIRED', () => {
    useAgentPersona.mockReturnValue({
      ...BASE,
      data: {
        persona: DEFAULT_AGENT_PERSONA,
        version: 1,
        topics: {
          versions: [
            topicVersion({ topicKey: 'a', status: 'PENDING_APPROVAL' }),
            topicVersion({ topicKey: 'b', status: 'DRAFT' }),
            topicVersion({ topicKey: 'c', status: 'DRAFT', current: false }),
            topicVersion({ topicKey: 'd', status: 'RETIRED' }),
          ],
          activeLabels: [],
          limits: { maxActiveTopics: 12 },
        },
        meta,
      },
    });
    renderCard();
    expect(
      screen.getByText('2 temas proibidos aguardam conclusão do fluxo de aprovação'),
    ).toBeVisible();
  });
});
