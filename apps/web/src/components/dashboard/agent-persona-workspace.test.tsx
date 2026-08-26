import type { BiologicalSex } from '@movivo/shared';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

const api = vi.hoisted(() => ({
  getForbiddenTopics: vi.fn(),
}));

vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  ...api,
}));

import {
  AgentPersonaWorkspaceProvider,
  slotSlug,
  useAgentPersonaWorkspace,
} from './agent-persona-workspace';

/** Referência estável: registrar o MESMO objeto duas vezes prova a idempotência do registro. */
const FEMALE_SUMMARY = {
  targetSex: 'FEMALE' as const,
  agentName: 'Marina',
  version: 1,
  servedFromSex: 'FEMALE' as const,
  borrowed: false,
  pending: 0,
  loading: false,
  error: '',
  generatedAt: null,
  discard: () => undefined,
  goToStep: () => undefined,
  refresh: async () => undefined,
};

function Probe() {
  const workspace = useAgentPersonaWorkspace();
  return (
    <div>
      <p>{`canWrite=${String(workspace.canWrite)}`}</p>
      <p>{`canApprove=${String(workspace.canApprove)}`}</p>
      <p>{`slots=${Object.keys(workspace.slots).length}`}</p>
      <button type="button" onClick={() => workspace.registerSlot(FEMALE_SUMMARY)}>
        registrar feminina
      </button>
      <button type="button" onClick={() => workspace.forgetSlot('FEMALE')}>
        esquecer feminina
      </button>
      <button type="button" onClick={() => workspace.refreshSlot('FEMALE')}>
        recarregar feminina
      </button>
    </div>
  );
}

describe('agent-persona-workspace', () => {
  beforeEach(() => {
    api.getForbiddenTopics.mockResolvedValue({ data: [] });
    window.history.replaceState(null, '', '/dashboard/ia/agente');
  });

  it('slotSlug: slot desconhecido devolve string vazia', () => {
    expect(slotSlug('OUTRO' as BiologicalSex)).toBe('');
  });

  it('useAgentPersonaWorkspace fora do provider lança erro claro', () => {
    expect(() => render(<Probe />)).toThrow(/AgentPersonaWorkspaceProvider/);
  });

  it('canWrite/canApprove usam o default false quando omitidos', () => {
    render(
      <AgentPersonaWorkspaceProvider>
        <Probe />
      </AgentPersonaWorkspaceProvider>,
    );

    expect(screen.getByText('canWrite=false')).toBeInTheDocument();
    expect(screen.getByText('canApprove=false')).toBeInTheDocument();
  });

  it('esquecer um slot nunca registrado não muda o estado', async () => {
    render(
      <AgentPersonaWorkspaceProvider>
        <Probe />
      </AgentPersonaWorkspaceProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'esquecer feminina' }));

    expect(screen.getByText('slots=0')).toBeInTheDocument();
  });

  it('registrar e depois esquecer um slot atualiza a contagem', async () => {
    render(
      <AgentPersonaWorkspaceProvider>
        <Probe />
      </AgentPersonaWorkspaceProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'registrar feminina' }));
    expect(screen.getByText('slots=1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'esquecer feminina' }));
    expect(screen.getByText('slots=0')).toBeInTheDocument();
  });

  it('registrar a MESMA referência duas vezes é idempotente (não gera outro render)', async () => {
    render(
      <AgentPersonaWorkspaceProvider>
        <Probe />
      </AgentPersonaWorkspaceProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'registrar feminina' }));
    expect(screen.getByText('slots=1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'registrar feminina' }));
    expect(screen.getByText('slots=1')).toBeInTheDocument();
  });

  it('refreshSlot chama o refresh do slot registrado', async () => {
    render(
      <AgentPersonaWorkspaceProvider>
        <Probe />
      </AgentPersonaWorkspaceProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'registrar feminina' }));

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'recarregar feminina' }));
    });
  });
});
