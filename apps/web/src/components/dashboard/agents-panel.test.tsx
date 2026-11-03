import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_PROFILE_STARTERS,
  type AgentCosts,
  type AgentProfilesOverview,
  type AgentsOverview,
} from '@movivo/shared';

import type * as ControlCenterApi from '@/lib/control-center-api';

const { getAgents, getAgentCosts, getAgentProfiles, openAgentProfileDraft, saveTierRoutes } =
  vi.hoisted(() => ({
    getAgents: vi.fn(),
    getAgentCosts: vi.fn(),
    getAgentProfiles: vi.fn(),
    openAgentProfileDraft: vi.fn(),
    saveTierRoutes: vi.fn(),
  }));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getAgents,
  getAgentCosts,
  getAgentProfiles,
  openAgentProfileDraft,
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

const NOW = '2026-10-31T12:00:00.000Z';
const profile = (agent: 'PERSONA_FEMALE' | 'HYROX', status: 'PUBLISHED' | 'DRAFT') => ({
  id: '11111111-1111-4111-8111-111111111111',
  agent,
  version: 2,
  status,
  content: AGENT_PROFILE_STARTERS[agent],
  changeNote: 'Rascunho',
  evalRunIds: [],
  publishedAt: status === 'PUBLISHED' ? NOW : null,
  createdAt: NOW,
});
const profiles: AgentProfilesOverview['data'] = [
  {
    agent: 'PERSONA_FEMALE',
    tasks: ['conversation.answer_question'],
    published: profile('PERSONA_FEMALE', 'PUBLISHED'),
    openDraft: null,
  },
  { agent: 'HYROX', tasks: ['hyrox.build_block'], published: null, openDraft: null },
];

beforeEach(() => {
  getAgentProfiles.mockReset().mockResolvedValue(profiles);
  openAgentProfileDraft.mockReset().mockResolvedValue(profile('HYROX', 'DRAFT'));
  getAgents.mockReset().mockResolvedValue(overview);
  getAgentCosts.mockReset().mockResolvedValue(costs);
  saveTierRoutes.mockReset().mockResolvedValue(overview.tiers);
});

const openTab = (name: string) => userEvent.click(screen.getByRole('tab', { name }));

describe('AgentsPanel', () => {
  it('abre na lista de agentes, com nome, função e os botões de cada linha', async () => {
    render(<AgentsPanel canWriteTiers={false} canWriteProfiles />);

    expect(await screen.findByText('Mariana')).toBeVisible();
    expect(screen.getByText('Conversa com as alunas pelo WhatsApp')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Visualizar Mariana' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Editar Mariana' })).toBeEnabled();
    expect(screen.getByText('v2 publicada')).toBeVisible();
    expect(screen.getByText('Especialista em HYROX')).toBeVisible();
    expect(screen.getByText('Sem ficha')).toBeVisible();
  });

  it('Visualizar mostra a ficha publicada sem abrir rascunho', async () => {
    render(<AgentsPanel canWriteTiers={false} canWriteProfiles />);

    await userEvent.click(await screen.findByRole('button', { name: 'Visualizar Mariana' }));

    const dialog = await screen.findByRole('dialog');
    // a ficha aparece formatada (seções e destaques), não como texto cru em markdown
    expect(await within(dialog).findByRole('heading', { name: 'Quem sou' })).toBeVisible();
    expect(within(dialog).getByText(/persona de inteligência artificial/)).toBeVisible();
    expect(dialog.textContent).not.toMatch(/^## |\*\*/m);
    expect(within(dialog).getByText('Comunicação: responder dúvidas do aluno')).toBeVisible();
    expect(openAgentProfileDraft).not.toHaveBeenCalled();
  });

  it('sem permissão de ADMIN, Editar fica desabilitado', async () => {
    render(<AgentsPanel canWriteTiers={false} canWriteProfiles={false} />);

    expect(await screen.findByRole('button', { name: 'Editar Mariana' })).toBeDisabled();
  });

  it('Editar abre o rascunho do agente e mostra o editor da ficha', async () => {
    getAgentProfiles
      .mockResolvedValueOnce(profiles)
      .mockResolvedValue([profiles[0], { ...profiles[1], openDraft: profile('HYROX', 'DRAFT') }]);
    render(<AgentsPanel canWriteTiers={false} canWriteProfiles />);

    await userEvent.click(
      await screen.findByRole('button', { name: 'Editar Especialista em HYROX' }),
    );

    expect(openAgentProfileDraft).toHaveBeenCalledWith('HYROX');
    expect(await screen.findByLabelText('Ficha (markdown)')).toBeVisible();
  });

  it('Testes: diz em português se cada tarefa foi aprovada ou nunca foi testada', async () => {
    render(<AgentsPanel canWriteTiers={false} />);
    await openTab('Testes');

    expect(await screen.findByText('Revisão semanal')).toBeVisible();
    expect(screen.getByText('Aprovada')).toBeVisible();
    expect(screen.getByText(/Acertou 3 de 3 situações · /)).toBeVisible();
    expect(screen.getByText('Detectar sinais de risco no texto')).toBeVisible();
    expect(screen.getByText('Nunca testada')).toBeVisible();
    expect(screen.queryByText('progress.weekly_review')).not.toBeInTheDocument();
  });

  it('Testes: o teste antigo vira "Testar de novo" e vai para o topo da lista', async () => {
    const [tested, untested] = overview.tasks;
    if (!tested?.lastEval || !untested) throw new Error('fixture sem as duas tarefas');
    const stale = {
      ...overview,
      tasks: [tested, { ...untested, lastEval: { ...tested.lastEval, current: false } }],
    };
    getAgents.mockResolvedValue(stale);
    render(<AgentsPanel canWriteTiers={false} />);
    await openTab('Testes');

    expect(await screen.findByText('Testar de novo')).toBeVisible();
    expect(screen.getByText(/mudou depois do último teste/)).toBeVisible();
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Detectar sinais de risco no texto');
  });

  it('Custos: resume o gasto e mostra uso, falhas e tempo de cada tarefa', async () => {
    render(<AgentsPanel canWriteTiers={false} />);
    await openTab('Custos');

    expect(await screen.findByText('Alunos atendidos')).toBeVisible();
    expect(screen.getByText(/1,50/)).toBeVisible();
    expect(screen.getByText('Revisão semanal')).toBeVisible();
    expect(screen.getByText('4,2 s')).toBeVisible();
    expect(screen.getByText('Ana Souza')).toBeInTheDocument();
  });

  it('Modelos: explica cada tipo em português e só quem pode escrever troca a IA principal', async () => {
    const { unmount } = render(<AgentsPanel canWriteTiers={false} />);
    await openTab('Modelos');
    expect(await screen.findByText('Uso geral')).toBeVisible();
    expect(screen.getByText('Principal')).toBeVisible();
    expect(screen.getByText('Reserva')).toBeVisible();
    expect(screen.getByText(/deepseek-v4-pro/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Tornar .* a IA principal/ })).toBeNull();
    unmount();

    render(<AgentsPanel canWriteTiers />);
    await openTab('Modelos');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Tornar gpt-4.1 a IA principal de Uso geral' }),
    );

    await waitFor(() =>
      expect(saveTierRoutes).toHaveBeenCalledWith('STANDARD', {
        routes: [route('OPENAI', 'gpt-4.1'), route('DEEPSEEK', 'deepseek-v4-pro')],
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'OpenAI · gpt-4.1 agora é a IA principal de “Uso geral”.',
    );
  });
});
