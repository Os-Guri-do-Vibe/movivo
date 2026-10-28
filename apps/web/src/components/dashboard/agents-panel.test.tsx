import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentCosts, AgentsOverview } from '@movivo/shared';

import type * as ControlCenterApi from '@/lib/control-center-api';

const { getAgents, getAgentCosts, saveTierRoutes } = vi.hoisted(() => ({
  getAgents: vi.fn(),
  getAgentCosts: vi.fn(),
  saveTierRoutes: vi.fn(),
}));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getAgents,
  getAgentCosts,
  saveTierRoutes,
}));

import { AgentsPanel } from './agents-panel';

const route = (vendor: 'DEEPSEEK' | 'OPENAI', model: string) => ({
  vendor,
  model,
  maxOutputTokens: 4000,
  timeoutMs: 45000,
  temperature: 0.4,
  vision: false,
});

const overview: AgentsOverview = {
  tasks: [
    {
      id: 'progress.weekly_review',
      tier: 'REASONING',
      promptVersion: 'abcdef1234567890',
      cases: 3,
      lastEval: {
        passed: true,
        casesPassed: 3,
        casesTotal: 3,
        finishedAt: '2026-11-03T12:00:00.000Z',
        costBrl: 0.02,
        current: true,
      },
    },
    {
      id: 'safety.detect_risk_signals',
      tier: 'FAST',
      promptVersion: '1111111111111111',
      cases: 3,
      lastEval: null,
    },
  ],
  tiers: [
    {
      tier: 'STANDARD',
      source: 'PADRÃO',
      routes: [route('DEEPSEEK', 'deepseek-v4-pro'), route('OPENAI', 'gpt-4.1')],
    },
  ],
};

const costs: AgentCosts = {
  days: 30,
  totalBrl: 1.5,
  students: 3,
  avgPerStudentBrl: 0.5,
  byTask: [
    { taskId: 'progress.weekly_review', calls: 10, failed: 1, costBrl: 1.2, avgLatencyMs: 4200 },
  ],
  byStudent: [
    { userId: '22222222-2222-4222-8222-222222222222', name: 'Ana Souza', calls: 4, costBrl: 0.7 },
  ],
};

beforeEach(() => {
  getAgents.mockReset().mockResolvedValue(overview);
  getAgentCosts.mockReset().mockResolvedValue(costs);
  saveTierRoutes.mockReset().mockResolvedValue(overview.tiers);
});

describe('AgentsPanel', () => {
  it('mostra o resultado do último teste de cada tarefa e a que nunca foi testada', async () => {
    render(<AgentsPanel canWriteTiers={false} />);

    expect((await screen.findAllByText('progress.weekly_review')).length).toBeGreaterThan(0);
    expect(screen.getByText(/3\/3 casos/)).toBeVisible();
    expect(screen.getByText('nunca testada')).toBeVisible();
  });

  it('mostra o custo de IA por tarefa e por aluno', async () => {
    render(<AgentsPanel canWriteTiers={false} />);

    expect(await screen.findByText(/média/)).toHaveTextContent('3 aluno(s)');
    expect(screen.getByText(/10 chamadas · 1 falhas/)).toBeVisible();
  });

  it('só quem pode escrever os níveis vê o botão de promover a rota', async () => {
    const { unmount } = render(<AgentsPanel canWriteTiers={false} />);
    await screen.findByText('deepseek-v4-pro', { exact: false });
    expect(
      screen.queryByRole('button', { name: /Tornar .* a primeira rota/ }),
    ).not.toBeInTheDocument();
    unmount();

    render(<AgentsPanel canWriteTiers />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Tornar gpt-4.1 a primeira rota de STANDARD' }),
    );

    await waitFor(() =>
      expect(saveTierRoutes).toHaveBeenCalledWith('STANDARD', {
        routes: [route('OPENAI', 'gpt-4.1'), route('DEEPSEEK', 'deepseek-v4-pro')],
      }),
    );
  });
});
