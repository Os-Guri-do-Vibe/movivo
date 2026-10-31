import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_PROFILE_STARTERS, type AgentProfilesOverview } from '@movivo/shared';

import type * as ControlCenterApi from '@/lib/control-center-api';

const { getAgentProfiles, updateAgentProfile, testAgentProfile } = vi.hoisted(() => ({
  getAgentProfiles: vi.fn(),
  updateAgentProfile: vi.fn(),
  testAgentProfile: vi.fn(),
}));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getAgentProfiles,
  updateAgentProfile,
  testAgentProfile,
}));

import { AgentProfiles } from './agent-profiles';

const ID = '11111111-1111-4111-8111-111111111111';
const draft = {
  id: ID,
  agent: 'HYROX' as const,
  version: 1,
  status: 'DRAFT' as const,
  content: AGENT_PROFILE_STARTERS.HYROX,
  changeNote: 'Rascunho',
  evalRunIds: [],
  publishedAt: null,
  createdAt: '2026-10-31T12:00:00.000Z',
};
const overview: AgentProfilesOverview['data'] = [
  { agent: 'HYROX', tasks: ['hyrox.build_block'], published: null, openDraft: draft },
];

beforeEach(() => {
  getAgentProfiles.mockReset().mockResolvedValue(overview);
  updateAgentProfile.mockReset().mockResolvedValue(draft);
  testAgentProfile.mockReset().mockResolvedValue({
    passed: true,
    evaluations: [
      { taskId: 'hyrox.build_block', passed: true, casesPassed: 2, casesTotal: 2, costBrl: 0.4 },
    ],
  });
});

describe('AgentProfiles', () => {
  it('sem permissão de ADMIN, só lê', async () => {
    render(<AgentProfiles canWrite={false} />);
    await screen.findByText('HYROX');
    expect(screen.queryByLabelText('Ficha (markdown)')).toBeNull();
    expect(screen.getByText(/Somente contas ADMIN editam/)).toBeInTheDocument();
  });

  it('ADMIN edita o rascunho, salva com o motivo e roda o teste', async () => {
    render(<AgentProfiles canWrite />);
    const textarea = await screen.findByLabelText('Ficha (markdown)');
    await userEvent.type(textarea, '{Enter}- Simulação a cada três semanas.');
    await userEvent.type(screen.getByLabelText('O que mudou e por quê'), 'Ritmo de simulações');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() =>
      expect(updateAgentProfile).toHaveBeenCalledWith(ID, {
        content: `${AGENT_PROFILE_STARTERS.HYROX}\n- Simulação a cada três semanas.`,
        changeNote: 'Ritmo de simulações',
      }),
    );
  });

  it('o teste mostra o resultado de cada tarefa do agente', async () => {
    render(<AgentProfiles canWrite />);
    await userEvent.click(await screen.findByRole('button', { name: 'Testar' }));
    expect(await screen.findByText(/Aprovado · hyrox.build_block · 2\/2/)).toBeInTheDocument();
  });
});
