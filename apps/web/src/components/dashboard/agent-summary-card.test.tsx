import { DEFAULT_AGENT_PERSONA, type BiologicalSex } from '@movivo/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Workspace from './agent-persona-workspace';
import type * as PersonaContext from './agent-persona-context';

const { useAgentPersonaWorkspace } = vi.hoisted(() => ({
  useAgentPersonaWorkspace: vi.fn(),
}));

vi.mock('./agent-persona-workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof Workspace>()),
  useAgentPersonaWorkspace,
}));

// `AgentPersonaProvider` de verdade dispara a busca da persona pela rede — fora do escopo
// deste teste (o formulário em si já é coberto por `ai-persona.test.tsx`). Aqui interessa
// só o comportamento do CARTÃO: resumo do slot e abrir/fechar a edição inline do slot certo.
vi.mock('./agent-persona-context', async (importOriginal) => ({
  ...(await importOriginal<typeof PersonaContext>()),
  AgentPersonaProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./ai-persona', () => ({
  AiPersonaDashboard: () => <div data-testid="persona-form">formulário</div>,
}));

import { AgentPersonaCards } from './agent-summary-card';

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

/**
 * Estado do workspace. `female`/`male` default para um slot carregado quando omitidos —
 * passe `null` explicitamente pra suprimir o cartão daquele slot num teste que só quer
 * falar do outro (os dois cartões renderizam sempre, não há mais "slot ativo" escondendo um).
 */
function workspace({
  female,
  male,
  canWrite = true,
  topics = null,
}: {
  female?: Workspace.AgentSlotSummary | null;
  male?: Workspace.AgentSlotSummary | null;
  canWrite?: boolean;
  topics?: unknown;
} = {}) {
  const slots: Partial<Record<BiologicalSex, Workspace.AgentSlotSummary>> = {};
  if (female !== null) slots.FEMALE = female ?? slot();
  if (male !== null)
    slots.MALE = male ?? slot({ targetSex: 'MALE', agentName: 'Leonardo', version: 4 });
  return {
    canWrite,
    canApprove: false,
    topics,
    topicsLoading: false,
    topicsError: '',
    refreshTopics: vi.fn(),
    activeSex: 'FEMALE' as BiologicalSex,
    selectSlot: vi.fn(),
    slots,
    activeSlot: slots.FEMALE ?? null,
    registerSlot: vi.fn(),
    forgetSlot: vi.fn(),
    refreshSlot: vi.fn(),
  };
}

const renderCards = () => render(<AgentPersonaCards />);

describe('AgentPersonaCards', () => {
  beforeEach(() => discard.mockClear());

  it('sem dados: dois cartões com "—" e "Sem configuração"', () => {
    useAgentPersonaWorkspace.mockReturnValue(workspace({ female: null, male: null }));
    renderCards();
    expect(screen.getAllByText('Sem configuração')).toHaveLength(2);
    expect(screen.getAllByRole('heading', { name: 'Agente' })).toHaveLength(2);
  });

  it('carregando (sem dado ainda): badge "Carregando"', () => {
    useAgentPersonaWorkspace.mockReturnValue(
      workspace({ female: slot({ agentName: null, version: null, loading: true }), male: null }),
    );
    renderCards();
    expect(screen.getByText('Carregando')).toBeVisible();
  });

  it('erro (sem dado ainda): badge "Indisponível"', () => {
    useAgentPersonaWorkspace.mockReturnValue(
      workspace({ female: slot({ agentName: null, version: null, error: 'falhou' }), male: null }),
    );
    renderCards();
    expect(screen.getByText('Indisponível')).toBeVisible();
  });

  it('com dado: badge "Ativo" (sem repetir "Persona feminina/masculina")', () => {
    useAgentPersonaWorkspace.mockReturnValue(
      workspace({ female: slot({ version: 3 }), male: null }),
    );
    renderCards();
    expect(screen.getByText('Ativo')).toBeVisible();
    expect(screen.queryByText(/persona feminina/i)).not.toBeInTheDocument();
  });

  it('não mostra os badges "Coach de treino · WhatsApp"/"Supervisão CREF", "Atualizado em" nem o status de versão ("padrão do código"/"vN · vigente"/"usa a persona X")', () => {
    useAgentPersonaWorkspace.mockReturnValue(
      workspace({
        female: slot({ agentName: 'Mariana', version: 1 }),
        male: slot({
          targetSex: 'MALE',
          agentName: 'Leonardo',
          version: null,
          servedFromSex: 'FEMALE',
          borrowed: true,
        }),
      }),
    );
    renderCards();
    expect(screen.queryByText('Coach de treino · WhatsApp')).not.toBeInTheDocument();
    expect(screen.queryByText('Supervisão CREF')).not.toBeInTheDocument();
    expect(screen.queryByText(/Atualizado em/)).not.toBeInTheDocument();
    expect(screen.queryByText('v1 · vigente')).not.toBeInTheDocument();
    expect(screen.queryByText('padrão do código')).not.toBeInTheDocument();
    expect(screen.queryByText(/usa a persona/)).not.toBeInTheDocument();
  });

  it('renderiza os dois cartões (feminino e masculino) sempre, sem seletor de aba', () => {
    useAgentPersonaWorkspace.mockReturnValue(
      workspace({
        female: slot({ agentName: 'Mariana', version: 1 }),
        male: slot({
          targetSex: 'MALE',
          agentName: 'Leonardo',
          version: null,
          servedFromSex: null,
        }),
      }),
    );
    renderCards();
    expect(screen.getByRole('heading', { name: 'Mariana' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Leonardo' })).toBeVisible();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('lápis abre a edição do slot certo INLINE (nunca modal), e ela começa fechada', async () => {
    const user = userEvent.setup();
    useAgentPersonaWorkspace.mockReturnValue(
      workspace({
        female: slot({ agentName: 'Mariana' }),
        male: slot({ targetSex: 'MALE', agentName: 'Leonardo', version: 4 }),
      }),
    );
    renderCards();

    expect(screen.queryByTestId('persona-form')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Editar Leonardo' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('persona-form')).toBeVisible();

    // "Fechar edição" (o lápis virou X) volta o cartão pro resumo.
    await user.click(screen.getByRole('button', { name: 'Fechar edição' }));
    expect(screen.queryByTestId('persona-form')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar Leonardo' })).toBeVisible();
  });

  it('1 alteração pendente: singular, e descarta o rascunho DAQUELE slot', async () => {
    const user = userEvent.setup();
    useAgentPersonaWorkspace.mockReturnValue(
      workspace({ female: slot({ version: 2, pending: 1 }), male: null }),
    );
    renderCards();
    expect(screen.getByText('1 alteração não publicada')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Descartar alterações' }));
    expect(screen.getByText(/na persona feminina/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(discard).toHaveBeenCalledOnce();
  });

  it('múltiplas alterações pendentes: plural, sem descarte quando canWrite=false', () => {
    useAgentPersonaWorkspace.mockReturnValue(
      workspace({ canWrite: false, female: slot({ version: 2, pending: 2 }), male: null }),
    );
    renderCards();
    expect(screen.getByText('2 alterações não publicadas')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Descartar alterações' })).not.toBeInTheDocument();
  });

  it('cada cartão descarta só o seu próprio rascunho — dois botões de descarte, um por slot', () => {
    useAgentPersonaWorkspace.mockReturnValue(
      workspace({
        female: slot({ pending: 1 }),
        male: slot({ targetSex: 'MALE', agentName: 'Leonardo', version: 4, pending: 2 }),
      }),
    );
    renderCards();
    expect(screen.getAllByRole('button', { name: 'Descartar alterações' })).toHaveLength(2);
    expect(screen.getByText('1 alteração não publicada')).toBeVisible();
    expect(screen.getByText('2 alterações não publicadas')).toBeVisible();
  });

  it('descrição do descarte referencia "configuração padrão" quando a versão do slot é nula', async () => {
    const user = userEvent.setup();
    useAgentPersonaWorkspace.mockReturnValue(
      workspace({
        female: slot({ version: null, servedFromSex: null, pending: 1 }),
        male: null,
      }),
    );
    renderCards();
    await user.click(screen.getByRole('button', { name: 'Descartar alterações' }));
    expect(screen.getByText(/a configuração padrão continua valendo/i)).toBeVisible();
  });
});
