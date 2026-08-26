import { DEFAULT_AGENT_PERSONA, type BiologicalSex } from '@movivo/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Workspace from './agent-persona-workspace';

const { useAgentPersonaWorkspace } = vi.hoisted(() => ({
  useAgentPersonaWorkspace: vi.fn(),
}));

vi.mock('./agent-persona-workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof Workspace>()),
  useAgentPersonaWorkspace,
}));

import { AgentSummaryCard } from './agent-summary-card';

const meta = {
  generatedAt: '2026-08-21T12:00:00.000Z',
  timezone: 'America/Sao_Paulo' as const,
  dataQuality: [],
};

const discard = vi.fn();

function slot(overrides: Partial<Workspace.AgentSlotSummary> = {}): Workspace.AgentSlotSummary {
  return {
    targetSex: 'FEMALE',
    agentName: DEFAULT_AGENT_PERSONA.agentName,
    version: 1,
    servedFromSex: 'FEMALE',
    borrowed: false,
    pending: 0,
    loading: false,
    error: '',
    generatedAt: meta.generatedAt,
    discard,
    goToStep: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  };
}

/** Estado do workspace com os dois slots registrados, salvo sobrescrita. */
function workspace({
  activeSex = 'FEMALE' as BiologicalSex,
  female,
  male,
  canWrite = true,
  topics = null,
}: {
  activeSex?: BiologicalSex;
  female?: Workspace.AgentSlotSummary | null;
  male?: Workspace.AgentSlotSummary | null;
  canWrite?: boolean;
  topics?: unknown;
} = {}) {
  const slots: Partial<Record<BiologicalSex, Workspace.AgentSlotSummary>> = {};
  if (female !== null) slots.FEMALE = female ?? slot();
  if (male !== null) slots.MALE = male ?? slot({ targetSex: 'MALE', version: 4 });
  return {
    canWrite,
    canApprove: false,
    topics,
    topicsLoading: false,
    topicsError: '',
    refreshTopics: vi.fn(),
    activeSex,
    selectSlot: vi.fn(),
    slots,
    activeSlot: slots[activeSex] ?? null,
    registerSlot: vi.fn(),
    forgetSlot: vi.fn(),
    refreshSlot: vi.fn(),
  };
}

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
    discard.mockClear();
  });

  it('sem dados: "—" no avatar e "Sem configuração"', () => {
    useAgentPersonaWorkspace.mockReturnValue(workspace({ female: null, male: null }));
    renderCard();
    expect(screen.getByText('Sem configuração')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Agente' })).toBeVisible();
  });

  it('carregando (sem dado ainda): badge "Carregando"', () => {
    useAgentPersonaWorkspace.mockReturnValue(
      workspace({ female: slot({ agentName: null, version: null, loading: true }) }),
    );
    renderCard();
    expect(screen.getByText('Carregando')).toBeVisible();
  });

  it('erro (sem dado ainda): badge "Indisponível"', () => {
    useAgentPersonaWorkspace.mockReturnValue(
      workspace({ female: slot({ agentName: null, version: null, error: 'falhou' }) }),
    );
    renderCard();
    expect(screen.getByText('Indisponível')).toBeVisible();
  });

  it('com dado: badge "Ativo", versão do slot ativo e data de atualização', () => {
    useAgentPersonaWorkspace.mockReturnValue(workspace({ female: slot({ version: 3 }) }));
    renderCard();
    expect(screen.getByText('Ativo')).toBeVisible();
    expect(screen.getByText(/Persona feminina · v3 · vigente/)).toBeVisible();
    expect(screen.getByText(/Atualizado em/)).toBeVisible();
  });

  it('conta os dois slots e nomeia o estado de cada um', () => {
    useAgentPersonaWorkspace.mockReturnValue(
      workspace({
        female: slot({ version: 3 }),
        male: slot({ targetSex: 'MALE', version: null, servedFromSex: 'FEMALE', borrowed: true }),
      }),
    );
    renderCard();
    expect(screen.getByText(/1 de 2 personas publicadas/)).toBeVisible();
    expect(screen.getByText(/Persona masculina: usa a persona feminina/)).toBeVisible();
  });

  it('versão nula sem empréstimo: "padrão do código"', () => {
    useAgentPersonaWorkspace.mockReturnValue(
      workspace({
        female: slot({ version: null, servedFromSex: null }),
        male: slot({ targetSex: 'MALE', version: null, servedFromSex: null }),
      }),
    );
    renderCard();
    expect(screen.getByText(/0 de 2 personas publicadas/)).toBeVisible();
    expect(screen.getByText(/Persona feminina · padrão do código/)).toBeVisible();
  });

  it('canWrite=false: mostra "Acesso de leitura" e nunca "Revisar e publicar"', () => {
    useAgentPersonaWorkspace.mockReturnValue(workspace({ canWrite: false }));
    renderCard();
    expect(screen.getByText('Acesso de leitura')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Revisar e publicar' })).not.toBeInTheDocument();
  });

  it('canWrite=true: "Revisar e publicar" e "Ver histórico" acionam onOpenPersona("revisao")', async () => {
    const user = userEvent.setup();
    useAgentPersonaWorkspace.mockReturnValue(workspace());
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Ver histórico' }));
    expect(onOpenPersona).toHaveBeenCalledWith('revisao');
    await user.click(screen.getByRole('button', { name: 'Revisar e publicar' }));
    expect(onOpenPersona).toHaveBeenLastCalledWith('revisao');
  });

  it('1 alteração pendente no slot ativo: singular, e descarta o rascunho DAQUELE slot', async () => {
    const user = userEvent.setup();
    useAgentPersonaWorkspace.mockReturnValue(
      workspace({ female: slot({ version: 2, pending: 1 }) }),
    );
    renderCard();
    expect(screen.getByText('1 alteração não publicada')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Descartar alterações' }));
    expect(screen.getByText(/na persona feminina/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(discard).toHaveBeenCalledOnce();
  });

  it('múltiplas alterações pendentes: plural, sem descarte quando canWrite=false', () => {
    useAgentPersonaWorkspace.mockReturnValue(
      workspace({ canWrite: false, female: slot({ version: 2, pending: 2 }) }),
    );
    renderCard();
    expect(screen.getByText('2 alterações não publicadas')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Descartar alterações' })).not.toBeInTheDocument();
  });

  /*
   * Rascunho do slot ESCONDIDO não pode virar um segundo "Descartar alterações" com o mesmo
   * nome acessível: vira aviso com atalho para a aba onde o descarte tem contexto.
   */
  it('rascunho do outro slot vira aviso com atalho, não um segundo botão de descarte', async () => {
    const user = userEvent.setup();
    useAgentPersonaWorkspace.mockReturnValue(
      workspace({
        female: slot({ pending: 1 }),
        male: slot({ targetSex: 'MALE', version: 4, pending: 2 }),
      }),
    );
    renderCard();

    expect(screen.getAllByRole('button', { name: 'Descartar alterações' })).toHaveLength(1);
    expect(
      screen.getByText('A persona masculina também tem 2 alterações não publicadas.'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Abrir persona masculina' }));
    expect(onOpenPersona).toHaveBeenCalledWith('revisao', 'MALE');
  });

  it('descrição do descarte referencia "configuração padrão" quando a versão do slot é nula', async () => {
    const user = userEvent.setup();
    useAgentPersonaWorkspace.mockReturnValue(
      workspace({ female: slot({ version: null, servedFromSex: null, pending: 1 }) }),
    );
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Descartar alterações' }));
    expect(screen.getByText(/a configuração padrão continua valendo/i)).toBeVisible();
  });

  it('1 tema proibido pendente: singular', () => {
    useAgentPersonaWorkspace.mockReturnValue(
      workspace({
        topics: { versions: [topicVersion()], activeLabels: [], limits: { maxActiveTopics: 12 } },
      }),
    );
    renderCard();
    expect(
      screen.getByText('1 tema proibido aguarda conclusão do fluxo de aprovação'),
    ).toBeVisible();
  });

  it('múltiplos temas proibidos pendentes: plural, ignora versões não-current e RETIRED', () => {
    useAgentPersonaWorkspace.mockReturnValue(
      workspace({
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
      }),
    );
    renderCard();
    expect(
      screen.getByText('2 temas proibidos aguardam conclusão do fluxo de aprovação'),
    ).toBeVisible();
  });
});
