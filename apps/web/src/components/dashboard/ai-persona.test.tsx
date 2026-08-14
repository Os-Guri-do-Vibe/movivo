import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_AGENT_PERSONA } from '@movivo/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

const {
  getAgentPersona,
  getAgentConfigHistory,
  getInviolableRules,
  publishAgentPersona,
  rollbackAgentPersona,
  simulateAgentConfig,
} = vi.hoisted(() => ({
  getAgentPersona: vi.fn(),
  getAgentConfigHistory: vi.fn(),
  getInviolableRules: vi.fn(),
  publishAgentPersona: vi.fn(),
  rollbackAgentPersona: vi.fn(),
  simulateAgentConfig: vi.fn(),
}));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getAgentPersona,
  getAgentConfigHistory,
  getInviolableRules,
  publishAgentPersona,
  rollbackAgentPersona,
  simulateAgentConfig,
}));

import { AiPersonaDashboard } from './ai-persona';

const meta = {
  generatedAt: '2026-08-12T12:00:00.000Z',
  timezone: 'America/Sao_Paulo' as const,
  dataQuality: [],
};

const rules = {
  data: {
    blocks: [
      {
        id: 'PERSONA',
        layer: 'L2' as const,
        title: 'Identidade e jeito de falar',
        editable: true,
        rationale: 'Muda apenas a forma da conversa.',
        content: 'Você é a MOVI…',
      },
      {
        id: 'INVIOLABLE_RULES',
        layer: 'L0' as const,
        title: 'Regras que a agente nunca quebra',
        editable: false,
        rationale: 'Exigência regulatória CREF e de segurança clínica.',
        content: 'Regras invioláveis:\n- NUNCA use "diagnóstico".',
      },
    ],
  },
  meta,
};

const history = {
  data: {
    versions: [
      {
        version: 2,
        status: 'PUBLISHED' as const,
        changeNote: 'tom mais direto',
        createdAt: '2026-08-11T12:00:00.000Z',
        createdBy: 'Rodrigo',
        current: true,
        payload: DEFAULT_AGENT_PERSONA,
      },
      {
        version: 1,
        status: 'PUBLISHED' as const,
        changeNote: 'configuração inicial',
        createdAt: '2026-08-10T12:00:00.000Z',
        createdBy: 'Pedro',
        current: false,
        payload: { ...DEFAULT_AGENT_PERSONA, agentName: 'MOVITA' },
      },
    ],
  },
  meta,
};

beforeEach(() => {
  getAgentPersona.mockReset().mockResolvedValue({
    data: { persona: DEFAULT_AGENT_PERSONA, version: 2 },
    meta,
  });
  getAgentConfigHistory.mockReset().mockResolvedValue(history);
  getInviolableRules.mockReset().mockResolvedValue(rules);
  publishAgentPersona.mockReset().mockResolvedValue({
    data: { persona: DEFAULT_AGENT_PERSONA, version: 3 },
    meta,
  });
  rollbackAgentPersona.mockReset().mockResolvedValue({
    data: { persona: DEFAULT_AGENT_PERSONA, version: 4 },
    meta,
  });
  simulateAgentConfig.mockReset().mockResolvedValue({
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
  it('renderiza os 6 campos de espaço fechado e o preview do prompt real', async () => {
    render(<AiPersonaDashboard canWrite />);
    expect(await screen.findByLabelText('Nome da agente')).toHaveValue('MOVI');
    expect(screen.getByLabelText('Como ela se apresenta')).toBeVisible();
    expect(screen.getByRole('group', { name: /Tom de voz/ })).toBeVisible();
    expect(screen.getByLabelText('Uso de emoji')).toHaveValue('MODERADO');
    expect(screen.getByLabelText('Tratamento')).toHaveValue('VOCE');
    expect(screen.getByLabelText('Tamanho máximo da resposta')).toHaveValue(800);
    // O preview traz a persona renderizada + os blocos travados, nunca só um dos dois.
    expect(screen.getByText(/Você é a MOVI/)).toBeVisible();
    expect(screen.getByText(/NUNCA use "diagnóstico"/)).toBeVisible();
  });

  it('atualiza o preview a cada edição e exige nota de mudança antes de publicar', async () => {
    const user = userEvent.setup();
    render(<AiPersonaDashboard canWrite />);
    const name = await screen.findByLabelText('Nome da agente');
    await user.clear(name);
    await user.type(name, 'NOVA');
    expect(screen.getByText(/Você é a NOVA/)).toBeVisible();

    const review = screen.getByRole('button', { name: 'Revisar e publicar' });
    expect(review).toBeDisabled();
    await user.type(screen.getByLabelText('Motivo da mudança'), 'novo nome da agente');
    expect(screen.getByRole('button', { name: 'Revisar e publicar' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Executar as 4 etapas' }));
    expect(await screen.findByRole('button', { name: 'Revisar e publicar' })).toBeEnabled();
  });

  it('mostra o diff campo a campo antes de confirmar e publica com a nota', async () => {
    const user = userEvent.setup();
    render(<AiPersonaDashboard canWrite />);
    const name = await screen.findByLabelText('Nome da agente');
    await user.clear(name);
    await user.type(name, 'NOVA');
    await user.type(screen.getByLabelText('Motivo da mudança'), 'novo nome da agente');
    await user.click(screen.getByRole('button', { name: 'Executar as 4 etapas' }));
    await user.click(screen.getByRole('button', { name: 'Revisar e publicar' }));

    expect(screen.getByText('O que muda nesta publicação')).toBeVisible();
    expect(screen.getByText('MOVI')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Confirmar publicação' }));

    await waitFor(() =>
      expect(publishAgentPersona).toHaveBeenCalledWith({
        payload: { ...DEFAULT_AGENT_PERSONA, agentName: 'NOVA' },
        changeNote: 'novo nome da agente',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('60 segundos');
  });

  it('rollback é 1 clique e publica a versão alvo como nova', async () => {
    const user = userEvent.setup();
    render(<AiPersonaDashboard canWrite />);
    await user.click(await screen.findByRole('button', { name: 'Voltar para esta versão' }));
    await waitFor(() =>
      expect(rollbackAgentPersona).toHaveBeenCalledWith({
        targetVersion: 1,
        changeNote: 'Rollback para a versão 1',
      }),
    );
  });

  it('leitor sem AI_CONFIG_WRITE não vê controle de publicação nem de rollback', async () => {
    render(<AiPersonaDashboard />);
    expect(await screen.findByLabelText('Nome da agente')).toBeDisabled();
    expect(screen.queryByLabelText('Motivo da mudança')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revisar e publicar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Voltar para esta versão' })).toBeNull();
  });

  it('erro de publicação (403 do servidor) aparece sem derrubar o formulário', async () => {
    const user = userEvent.setup();
    const { ControlCenterApiError } = await import('@/lib/control-center-api');
    publishAgentPersona.mockRejectedValue(new ControlCenterApiError(403, 'Sem permissão.'));
    render(<AiPersonaDashboard canWrite />);
    const name = await screen.findByLabelText('Nome da agente');
    await user.clear(name);
    await user.type(name, 'NOVA');
    await user.type(screen.getByLabelText('Motivo da mudança'), 'novo nome da agente');
    await user.click(screen.getByRole('button', { name: 'Executar as 4 etapas' }));
    await user.click(screen.getByRole('button', { name: 'Revisar e publicar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar publicação' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem permissão.');
  });
});
