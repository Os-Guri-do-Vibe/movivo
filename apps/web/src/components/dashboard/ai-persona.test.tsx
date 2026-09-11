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
});

describe('AiPersonaDashboard', () => {
  it('organiza a configuração em cinco etapas e preserva o rascunho', async () => {
    const user = userEvent.setup();
    renderPersona();

    const name = await screen.findByLabelText('Nome da agente');
    await user.clear(name);
    await user.type(name, 'NOVA');
    await user.click(screen.getByRole('button', { name: 'Jeito de falar' }));

    expect(screen.getByRole('combobox', { name: 'Tom de voz' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Persona e comportamento' })).toBeVisible();
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
    await user.click(screen.getByRole('button', { name: 'Salvar e ativar' }));

    await waitFor(() =>
      expect(api.publishAgentPersona).toHaveBeenCalledWith({
        targetSex: 'FEMALE',
        payload: { ...DEFAULT_AGENT_PERSONA, agentSelfIntro: `“${intro}”` },
        changeNote: 'Configuração salva e ativada pelo painel.',
      }),
    );
  });

  it('remove os cards de limites travados e o link para a Base, mantém temas proibidos', async () => {
    renderPersona();
    await goToStep('Limites');

    expect(screen.queryByText('Regras que a agente nunca quebra')).not.toBeInTheDocument();
    expect(screen.queryByText('Perímetro: só se fala de treino')).not.toBeInTheDocument();
    expect(screen.queryByText('Fonte de conhecimento')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Abrir Base de Conhecimento' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Temas proibidos' })).toBeVisible();
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

  it('publica direto com a nota de alteração fixa do painel', async () => {
    const user = userEvent.setup();
    renderPersona();
    const name = await screen.findByLabelText('Nome da agente');
    await user.clear(name);
    await user.type(name, 'NOVA');
    await user.click(screen.getByRole('button', { name: 'Revisar e publicar' }));

    await user.click(screen.getByRole('button', { name: 'Salvar e ativar' }));

    await waitFor(() =>
      expect(api.publishAgentPersona).toHaveBeenCalledWith({
        targetSex: 'FEMALE',
        payload: { ...DEFAULT_AGENT_PERSONA, agentName: 'NOVA' },
        changeNote: 'Configuração salva e ativada pelo painel.',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('60 segundos');
  });

  it('nome inválido: "Salvar e ativar" não chama a publicação', async () => {
    const user = userEvent.setup();
    renderPersona();
    const name = await screen.findByLabelText('Nome da agente');
    await user.clear(name);
    await user.type(name, 'X');
    await user.click(screen.getByRole('button', { name: 'Revisar e publicar' }));
    await user.click(screen.getByRole('button', { name: 'Salvar e ativar' }));
    expect(api.publishAgentPersona).not.toHaveBeenCalled();
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
    await user.click(screen.getByRole('button', { name: 'Salvar e ativar' }));

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
    await user.click(screen.getByRole('button', { name: 'Salvar e ativar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível concluir a publicação.',
    );
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
    expect(screen.getByRole('button', { name: 'Salvar e ativar' })).toBeDisabled();
  });
});
