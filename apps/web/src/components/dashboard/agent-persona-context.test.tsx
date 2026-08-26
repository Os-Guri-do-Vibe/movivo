import { DEFAULT_AGENT_PERSONA } from '@movivo/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

const api = vi.hoisted(() => ({
  getAgentPersona: vi.fn(),
  getAgentConfigHistory: vi.fn(),
  getInviolableRules: vi.fn(),
  getForbiddenTopics: vi.fn(),
  publishAgentPersona: vi.fn(),
  simulateAgentConfig: vi.fn(),
}));

vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  ...api,
}));

import { AgentPersonaWorkspaceProvider } from './agent-persona-workspace';
import {
  AgentPersonaProvider,
  describeField,
  stepOfField,
  useAgentPersona,
} from './agent-persona-context';

function ProbeWithoutProvider() {
  useAgentPersona();
  return null;
}

/** Expõe `update`/`publish` para o teste forçar um estado que a UI, com o botão desabilitado, nunca alcançaria. */
function PublishProbe() {
  const { update, publish, form } = useAgentPersona();
  return (
    <div>
      <p>{`agentName=${form?.agentName ?? ''}`}</p>
      <button type="button" onClick={() => update({ agentName: '123' })}>
        forçar nome inválido
      </button>
      <button type="button" onClick={() => void publish()}>
        publicar mesmo assim
      </button>
    </div>
  );
}

/** Expõe `update`/`fieldErrors` para provar que dois erros no MESMO campo aninhado viram uma entrada só. */
function FieldErrorsProbe() {
  const { update, fieldErrors } = useAgentPersona();
  return (
    <div>
      <p>{`errors=${fieldErrors.size}`}</p>
      <button
        type="button"
        onClick={() =>
          update({
            formatting: {
              blockSize: 'INVALIDO',
              allowLists: true,
              boldPolicy: 'INVALIDO',
            } as never,
          })
        }
      >
        invalidar dois campos de formatting
      </button>
    </div>
  );
}

/** Expõe `runSimulation`/`update`/`staleFields` para provar que editar depois de simular marca o campo como obsoleto. */
function StaleFieldsProbe() {
  const { update, runSimulation, simulation, staleFields } = useAgentPersona();
  return (
    <div>
      <p>{`simulation=${simulation ? 'ok' : 'nenhuma'}`}</p>
      <p>{`stale=${staleFields.join(',')}`}</p>
      <button type="button" onClick={() => void runSimulation()}>
        simular
      </button>
      <button type="button" onClick={() => update({ agentSelfIntro: 'nova apresentação' })}>
        editar depois
      </button>
    </div>
  );
}

describe('describeField', () => {
  it('formatação com listas permitidas menciona "com listas"', () => {
    const persona = {
      ...DEFAULT_AGENT_PERSONA,
      formatting: { ...DEFAULT_AGENT_PERSONA.formatting, allowLists: true },
    };

    expect(describeField('formatting', persona)).toContain('com listas');
  });

  it('formatação sem listas menciona "sem listas"', () => {
    const persona = {
      ...DEFAULT_AGENT_PERSONA,
      formatting: { ...DEFAULT_AGENT_PERSONA.formatting, allowLists: false },
    };

    expect(describeField('formatting', persona)).toContain('sem listas');
  });

  it('campo de texto simples devolve o próprio valor', () => {
    expect(describeField('agentName', DEFAULT_AGENT_PERSONA)).toBe(DEFAULT_AGENT_PERSONA.agentName);
  });
});

describe('stepOfField', () => {
  it('encontra a etapa dona de um campo conhecido', () => {
    expect(stepOfField('agentName')).toBeDefined();
  });
});

describe('useAgentPersona', () => {
  it('fora do provider lança erro claro', () => {
    expect(() => render(<ProbeWithoutProvider />)).toThrow(/AgentPersonaProvider/);
  });
});

describe('publish — validação também é checada no lado de dentro, não só no botão', () => {
  beforeEach(() => {
    for (const mock of Object.values(api)) mock.mockReset();
    api.getAgentPersona.mockResolvedValue({
      data: {
        targetSex: 'FEMALE',
        persona: DEFAULT_AGENT_PERSONA,
        version: 1,
        servedFromSex: 'FEMALE',
      },
      meta: {
        generatedAt: '2026-08-21T12:00:00.000Z',
        timezone: 'America/Sao_Paulo',
        dataQuality: [],
      },
    });
    api.getAgentConfigHistory.mockResolvedValue({
      data: { versions: [] },
      meta: {
        generatedAt: '2026-08-21T12:00:00.000Z',
        timezone: 'America/Sao_Paulo',
        dataQuality: [],
      },
    });
    api.getInviolableRules.mockResolvedValue({
      data: { blocks: [] },
      meta: {
        generatedAt: '2026-08-21T12:00:00.000Z',
        timezone: 'America/Sao_Paulo',
        dataQuality: [],
      },
    });
    api.getForbiddenTopics.mockResolvedValue({
      data: { versions: [], activeLabels: [], limits: {} },
      meta: {
        generatedAt: '2026-08-21T12:00:00.000Z',
        timezone: 'America/Sao_Paulo',
        dataQuality: [],
      },
    });
  });

  it('agentName fora do padrão nunca chega a chamar a API de publicação', async () => {
    const user = userEvent.setup();
    render(
      <AgentPersonaWorkspaceProvider canWrite canApprove={false}>
        <AgentPersonaProvider targetSex="FEMALE">
          <PublishProbe />
        </AgentPersonaProvider>
      </AgentPersonaWorkspaceProvider>,
    );
    await screen.findByText(`agentName=${DEFAULT_AGENT_PERSONA.agentName}`);

    await user.click(screen.getByRole('button', { name: 'forçar nome inválido' }));
    await screen.findByText('agentName=123');
    await user.click(screen.getByRole('button', { name: 'publicar mesmo assim' }));

    await waitFor(() => expect(api.publishAgentPersona).not.toHaveBeenCalled());
  });

  it('editar um campo depois de simular com sucesso invalida o teste e marca o campo como obsoleto', async () => {
    const user = userEvent.setup();
    api.simulateAgentConfig.mockResolvedValue({
      data: {
        kind: 'PERSONA',
        passed: true,
        candidateHash: 'a'.repeat(64),
        checks: [],
      },
      meta: {
        generatedAt: '2026-08-21T12:00:00.000Z',
        timezone: 'America/Sao_Paulo',
        dataQuality: [],
      },
    });
    render(
      <AgentPersonaWorkspaceProvider canWrite canApprove={false}>
        <AgentPersonaProvider targetSex="FEMALE">
          <StaleFieldsProbe />
        </AgentPersonaProvider>
      </AgentPersonaWorkspaceProvider>,
    );
    await screen.findByText('simulation=nenhuma');

    await user.click(screen.getByRole('button', { name: 'simular' }));
    await screen.findByText('simulation=ok');

    await user.click(screen.getByRole('button', { name: 'editar depois' }));

    await screen.findByText('simulation=nenhuma');
    await screen.findByText('stale=agentSelfIntro');
  });

  it('editar antes de a persona carregar não quebra: form continua vazio', async () => {
    api.getAgentPersona.mockReturnValue(new Promise(() => undefined));
    render(
      <AgentPersonaWorkspaceProvider canWrite canApprove={false}>
        <AgentPersonaProvider targetSex="FEMALE">
          <PublishProbe />
        </AgentPersonaProvider>
      </AgentPersonaWorkspaceProvider>,
    );
    await screen.findByText('agentName=');

    await userEvent.setup().click(screen.getByRole('button', { name: 'forçar nome inválido' }));

    expect(screen.getByText('agentName=')).toBeInTheDocument();
  });

  it('dois campos inválidos dentro de "formatting" contam como um erro só (mesmo path[0])', async () => {
    const user = userEvent.setup();
    render(
      <AgentPersonaWorkspaceProvider canWrite canApprove={false}>
        <AgentPersonaProvider targetSex="FEMALE">
          <FieldErrorsProbe />
        </AgentPersonaProvider>
      </AgentPersonaWorkspaceProvider>,
    );
    await screen.findByText('errors=0');

    await user.click(screen.getByRole('button', { name: 'invalidar dois campos de formatting' }));

    await screen.findByText('errors=1');
  });
});
