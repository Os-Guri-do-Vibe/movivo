import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_PROFILE_STARTERS } from '@movivo/shared';

import type * as ControlCenterApi from '@/lib/control-center-api';

const { updateAgentProfile, testAgentProfile } = vi.hoisted(() => ({
  updateAgentProfile: vi.fn(),
  testAgentProfile: vi.fn(),
}));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  updateAgentProfile,
  testAgentProfile,
}));

import { ProfileEditor } from './agent-profiles';

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

beforeEach(() => {
  updateAgentProfile.mockReset().mockResolvedValue(draft);
  testAgentProfile.mockReset().mockResolvedValue({
    passed: true,
    evaluations: [
      { taskId: 'hyrox.build_block', passed: true, casesPassed: 2, casesTotal: 2, costBrl: 0.4 },
    ],
  });
});

describe('ProfileEditor', () => {
  it('edita o rascunho, salva com o motivo da mudança', async () => {
    render(<ProfileEditor draft={draft} onChanged={async () => {}} />);
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
    render(<ProfileEditor draft={draft} onChanged={async () => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Testar' }));
    expect(
      await screen.findByText(/Aprovado · HYROX: montar o bloco de treino · 2\/2/),
    ).toBeInTheDocument();
  });
});
