import { CREF_HANDOFF_SUFFIX, DEFAULT_AGENT_PERSONA, type BiologicalSex } from '@movivo/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ControlCenterApiError } from '@/lib/control-center-api';
import type * as ControlCenterApi from '@/lib/control-center-api';

const api = vi.hoisted(() => ({
  approveForbiddenTopic: vi.fn(),
  getAgentPersona: vi.fn(),
  getAgentConfigHistory: vi.fn(),
  getForbiddenTopics: vi.fn(),
  getInviolableRules: vi.fn(),
  proposeForbiddenTopic: vi.fn(),
  publishAgentPersona: vi.fn(),
  retireForbiddenTopic: vi.fn(),
  rollbackAgentPersona: vi.fn(),
  simulateAgentConfig: vi.fn(),
  submitForbiddenTopic: vi.fn(),
}));

vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  ...api,
}));

import { AgentPersonaProvider } from './agent-persona-context';
import { AgentPersonaWorkspaceProvider } from './agent-persona-workspace';
import { AiPersonaDashboard } from './ai-persona';

const meta = {
  generatedAt: '2026-08-21T12:00:00.000Z',
  timezone: 'America/Sao_Paulo' as const,
  dataQuality: [],
};

const rules = {
  data: {
    blocks: [
      {
        id: 'INVIOLABLE_RULES',
        layer: 'L0' as const,
        title: 'Regras que a agente nunca quebra',
        editable: false,
        rationale: 'Proteção clínica, regulatória e de escopo.',
        content: 'Nunca diagnostica nem promete resultado.',
      },
    ],
  },
  meta,
};

const history = {
  data: {
    versions: [
      {
        targetSex: 'FEMALE' as const,
        version: 2,
        status: 'PUBLISHED' as const,
        changeNote: 'tom mais direto',
        createdAt: '2026-08-20T12:00:00.000Z',
        createdBy: 'Rodrigo',
        current: true,
        payload: DEFAULT_AGENT_PERSONA,
      },
      {
        targetSex: 'FEMALE' as const,
        version: 1,
        status: 'PUBLISHED' as const,
        changeNote: 'configuração inicial',
        createdAt: '2026-08-19T12:00:00.000Z',
        createdBy: 'Pedro',
        current: false,
        payload: { ...DEFAULT_AGENT_PERSONA, agentName: 'MOVITA' },
      },
    ],
  },
  meta,
};

const topics = {
  data: {
    versions: [],
    activeLabels: [],
    limits: { maxActiveTopics: 12, maxPhrasesPerTopic: 20, maxPhraseLength: 300 },
  },
  meta,
};

function renderPersona(
  options: { canWrite?: boolean; canApprove?: boolean; targetSex?: BiologicalSex } = {},
) {
  const { canWrite = true, canApprove = false, targetSex = 'FEMALE' } = options;
  return render(
    <AgentPersonaWorkspaceProvider canWrite={canWrite} canApprove={canApprove}>
      <AgentPersonaProvider targetSex={targetSex}>
        <AiPersonaDashboard />
      </AgentPersonaProvider>
    </AgentPersonaWorkspaceProvider>,
  );
}

async function goToStep(name: string) {
  await userEvent.setup().click(await screen.findByRole('button', { name }));
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  api.getAgentPersona.mockResolvedValue({
    data: {
      targetSex: 'FEMALE',
      persona: DEFAULT_AGENT_PERSONA,
      version: 2,
      servedFromSex: 'FEMALE',
    },
    meta,
  });
  api.getAgentConfigHistory.mockResolvedValue(history);
  api.getForbiddenTopics.mockResolvedValue(topics);
  api.getInviolableRules.mockResolvedValue(rules);
  api.publishAgentPersona.mockResolvedValue({
    data: {
      targetSex: 'FEMALE',
      persona: DEFAULT_AGENT_PERSONA,
      version: 3,
      servedFromSex: 'FEMALE',
    },
    meta,
  });
  api.rollbackAgentPersona.mockResolvedValue({
    data: {
      targetSex: 'FEMALE',
      persona: DEFAULT_AGENT_PERSONA,
      version: 4,
      servedFromSex: 'FEMALE',
    },
    meta,
  });
  api.simulateAgentConfig.mockResolvedValue({
    data: {
      kind: 'PERSONA',
      passed: true,
      candidateHash: 'a'.repeat(64),
      checks: [
        { id: 'SCHEMA', title: 'Contrato fechado', passed: true, cases: 1, failures: [] },
        { id: 'GOLDEN_INPUT', title: 'Golden de entrada', passed: true, cases: 14, failures: [] },
        { id: 'GOLDEN_OUTPUT', title: 'Golden de saída', passed: true, cases: 8, failures: [] },
        { id: 'PROMPT_INTEGRITY', title: 'Integridade L0', passed: true, cases: 9, failures: [] },
      ],
    },
    meta,
  });
});

describe('AiPersonaDashboard', () => {
  it('organiza a configuração em cinco etapas e preserva o rascunho', async () => {
    const user = userEvent.setup();
    renderPersona();

    const name = await screen.findByLabelText('Nome da agente');
    await user.clear(name);
    await user.type(name, 'NOVA');
    await user.click(screen.getByRole('button', { name: 'Jeito de falar' }));

    expect(screen.getByRole('group', { name: 'Tom de voz' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Persona e comportamento' })).toBeVisible();
    expect(screen.getByRole('switch', { name: 'Permitir listas curtas' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Identidade' }));
    expect(screen.getByLabelText('Nome da agente')).toHaveValue('NOVA');
    expect(screen.queryByLabelText('Tratamento')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Tamanho máximo da resposta')).not.toBeInTheDocument();
  });

  it('aceita apresentação com emoji, aspas e whitespace trazido pelo clipboard', async () => {
    const intro =
      'Olá! Eu sou o Leonardo, seu coach da Movivo. Muito prazer em te conhecer! 😊 Pode me chamar de Léo. Estou aqui para te acompanhar e ajudar nessa jornada.';
    const user = userEvent.setup();
    renderPersona();

    const field = await screen.findByLabelText('Como ela se apresenta');
    fireEvent.change(field, { target: { value: `\n  “${intro}”\u00a0\n` } });

    expect(screen.queryByText(/apresentação inválida/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revisar e publicar' }));
    await user.click(screen.getByRole('button', { name: 'Executar teste' }));

    await waitFor(() =>
      expect(api.simulateAgentConfig).toHaveBeenCalledWith({
        kind: 'PERSONA',
        candidate: { ...DEFAULT_AGENT_PERSONA, agentSelfIntro: `“${intro}”` },
      }),
    );
  });

  it('mostra limites travados, temas proibidos e um único link para a Base', async () => {
    renderPersona();
    await goToStep('Limites');

    expect(screen.getByText('Regras que a agente nunca quebra')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Temas proibidos' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Abrir Base de Conhecimento' })).toHaveAttribute(
      'href',
      '/dashboard/ia/base-conhecimento',
    );
    expect(screen.queryByRole('tab', { name: /Conhecimento/ })).not.toBeInTheDocument();
  });

  it('preserva a proposta de tema ao navegar entre etapas', async () => {
    const user = userEvent.setup();
    renderPersona();
    await goToStep('Limites');
    await user.type(screen.getByLabelText('Nome do tema'), 'Promoções de concorrentes');

    await user.click(screen.getByRole('button', { name: 'Identidade' }));
    await user.click(screen.getByRole('button', { name: 'Limites' }));

    expect(screen.getByLabelText('Nome do tema')).toHaveValue('Promoções de concorrentes');
  });

  it('mantém a passagem determinística com o trecho CREF fixo', async () => {
    renderPersona();
    await goToStep('Passagem para o profissional');

    expect(screen.getByLabelText('Mensagem de passagem')).toHaveValue(
      DEFAULT_AGENT_PERSONA.humanHandoffMessage,
    );
    expect(screen.getByText(/Trecho fixo:/)).toBeVisible();
    expect(screen.getAllByText(new RegExp(CREF_HANDOFF_SUFFIX)).length).toBeGreaterThan(0);
  });

  it('simula o payload atual antes de publicar com rastreabilidade', async () => {
    const user = userEvent.setup();
    renderPersona();
    const name = await screen.findByLabelText('Nome da agente');
    await user.clear(name);
    await user.type(name, 'NOVA');
    await user.click(screen.getByRole('button', { name: 'Revisar e publicar' }));
    await user.type(screen.getByLabelText('Motivo da alteração'), 'novo nome da agente');

    expect(screen.getByRole('button', { name: 'Publicar configuração' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Executar teste' }));
    expect(await screen.findByText('Integridade L0')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Publicar configuração' }));

    await waitFor(() =>
      expect(api.publishAgentPersona).toHaveBeenCalledWith({
        targetSex: 'FEMALE',
        payload: { ...DEFAULT_AGENT_PERSONA, agentName: 'NOVA' },
        changeNote: 'novo nome da agente',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('60 segundos');
  });

  it('nome inválido: "Executar teste" não chama o simulador', async () => {
    const user = userEvent.setup();
    renderPersona();
    const name = await screen.findByLabelText('Nome da agente');
    await user.clear(name);
    await user.type(name, 'X');
    await user.click(screen.getByRole('button', { name: 'Revisar e publicar' }));
    await user.click(screen.getByRole('button', { name: 'Executar teste' }));
    expect(api.simulateAgentConfig).not.toHaveBeenCalled();
  });

  it('erro conhecido da API ao publicar mostra a mensagem específica do servidor', async () => {
    const user = userEvent.setup();
    api.publishAgentPersona.mockRejectedValueOnce(
      new ControlCenterApiError(422, 'motivo da alteração inválido'),
    );
    renderPersona();
    const name = await screen.findByLabelText('Nome da agente');
    await user.clear(name);
    await user.type(name, 'NOVA');
    await user.click(screen.getByRole('button', { name: 'Revisar e publicar' }));
    await user.type(screen.getByLabelText('Motivo da alteração'), 'novo nome da agente');
    await user.click(screen.getByRole('button', { name: 'Executar teste' }));
    await screen.findByText('Integridade L0');
    await user.click(screen.getByRole('button', { name: 'Publicar configuração' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('motivo da alteração inválido');
  });

  it('erro inesperado ao publicar mostra a mensagem genérica', async () => {
    const user = userEvent.setup();
    api.publishAgentPersona.mockRejectedValueOnce(new Error('conexão perdida'));
    renderPersona();
    const name = await screen.findByLabelText('Nome da agente');
    await user.clear(name);
    await user.type(name, 'NOVA');
    await user.click(screen.getByRole('button', { name: 'Revisar e publicar' }));
    await user.type(screen.getByLabelText('Motivo da alteração'), 'novo nome da agente');
    await user.click(screen.getByRole('button', { name: 'Executar teste' }));
    await screen.findByText('Integridade L0');
    await user.click(screen.getByRole('button', { name: 'Publicar configuração' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível concluir a publicação.',
    );
  });

  it('erro ao executar o simulador mostra a mensagem de falha', async () => {
    const user = userEvent.setup();
    api.simulateAgentConfig.mockRejectedValueOnce(
      new ControlCenterApiError(503, 'simulador fora do ar'),
    );
    renderPersona();
    const name = await screen.findByLabelText('Nome da agente');
    await user.clear(name);
    await user.type(name, 'NOVA');
    await user.click(screen.getByRole('button', { name: 'Revisar e publicar' }));
    await user.click(screen.getByRole('button', { name: 'Executar teste' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('simulador fora do ar');
  });

  it('restaura uma versão antiga como nova versão auditável', async () => {
    const user = userEvent.setup();
    renderPersona();
    await user.click(await screen.findByRole('button', { name: 'Revisar e publicar' }));
    await user.click(screen.getByRole('button', { name: 'Restaurar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar restauração' }));

    await waitFor(() =>
      expect(api.rollbackAgentPersona).toHaveBeenCalledWith({
        targetSex: 'FEMALE',
        targetVersion: 1,
        changeNote: 'Rollback para a versão 1',
      }),
    );
  });

  /*
   * "Versão 1" existe nos DOIS slots e não é a mesma persona (`UNIQUE(target_sex, version)`).
   * Um rollback que esquecesse o slot reverteria o público errado — e nada na tela avisaria.
   */
  it('rollback e publicação viajam com o slot do formulário, não com o slot padrão', async () => {
    const user = userEvent.setup();
    api.getAgentPersona.mockResolvedValue({
      data: {
        targetSex: 'MALE',
        persona: DEFAULT_AGENT_PERSONA,
        version: 2,
        servedFromSex: 'MALE',
      },
      meta,
    });
    api.getAgentConfigHistory.mockResolvedValue({
      data: { versions: history.data.versions.map((v) => ({ ...v, targetSex: 'MALE' as const })) },
      meta,
    });
    renderPersona({ targetSex: 'MALE' });

    expect(await screen.findByRole('heading', { name: 'Persona masculina' })).toBeVisible();
    expect(api.getAgentPersona).toHaveBeenCalledWith('MALE', expect.anything());
    expect(api.getAgentConfigHistory).toHaveBeenCalledWith('MALE', expect.anything());
    expect(api.getInviolableRules).toHaveBeenCalledWith('MALE', expect.anything());

    await user.click(screen.getByRole('button', { name: 'Revisar e publicar' }));
    await user.click(screen.getByRole('button', { name: 'Restaurar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar restauração' }));

    await waitFor(() =>
      expect(api.rollbackAgentPersona).toHaveBeenCalledWith({
        targetSex: 'MALE',
        targetVersion: 1,
        changeNote: 'Rollback para a versão 1',
      }),
    );
  });

  it('avisa quando o público ainda é atendido pela persona do outro slot', async () => {
    api.getAgentPersona.mockResolvedValue({
      data: {
        targetSex: 'MALE',
        persona: DEFAULT_AGENT_PERSONA,
        version: null,
        servedFromSex: 'FEMALE',
      },
      meta,
    });
    renderPersona({ targetSex: 'MALE' });

    expect(
      await screen.findByText(/Ainda não há persona publicada para este público/),
    ).toBeVisible();
    expect(screen.getByText(/recebe a persona feminina/)).toBeVisible();
  });

  it('não mostra o aviso de empréstimo quando o slot tem persona própria', async () => {
    renderPersona();
    await screen.findByLabelText('Nome da agente');
    expect(
      screen.queryByText(/Ainda não há persona publicada para este público/),
    ).not.toBeInTheDocument();
  });

  it('desabilita a edição para acesso somente leitura', async () => {
    renderPersona({ canWrite: false });
    expect(await screen.findByLabelText('Nome da agente')).toBeDisabled();
    await goToStep('Revisar e publicar');
    expect(screen.getByLabelText('Motivo da alteração')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Executar teste' })).toBeDisabled();
  });
});
