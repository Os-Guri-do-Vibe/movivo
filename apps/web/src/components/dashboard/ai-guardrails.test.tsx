import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

const {
  getL1Guardrails,
  publishL1Guardrail,
  retireL1Guardrail,
  rollbackL1Guardrail,
  simulateAgentConfig,
} = vi.hoisted(() => ({
  getL1Guardrails: vi.fn(),
  publishL1Guardrail: vi.fn(),
  retireL1Guardrail: vi.fn(),
  rollbackL1Guardrail: vi.fn(),
  simulateAgentConfig: vi.fn(),
}));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getL1Guardrails,
  publishL1Guardrail,
  retireL1Guardrail,
  rollbackL1Guardrail,
  simulateAgentConfig,
}));

import { AiGuardrailsPanel } from './ai-guardrails';

const response = {
  data: { versions: [] },
  meta: {
    generatedAt: '2026-08-13T12:00:00.000Z',
    timezone: 'America/Sao_Paulo' as const,
    dataQuality: [],
  },
};

beforeEach(() => {
  getL1Guardrails.mockReset().mockResolvedValue(response);
  publishL1Guardrail.mockReset().mockResolvedValue(response);
  retireL1Guardrail.mockReset().mockResolvedValue(response);
  rollbackL1Guardrail.mockReset().mockResolvedValue(response);
  simulateAgentConfig.mockReset().mockResolvedValue({
    data: {
      kind: 'GUARDRAIL',
      passed: true,
      candidateHash: 'b'.repeat(64),
      checks: [
        { id: 'SCHEMA', title: 'Contrato', passed: true, cases: 1, failures: [] },
        { id: 'GOLDEN_INPUT', title: 'Entrada', passed: true, cases: 10, failures: [] },
        { id: 'GOLDEN_OUTPUT', title: 'Saída', passed: true, cases: 8, failures: [] },
        { id: 'PROMPT_INTEGRITY', title: 'Ação', passed: true, cases: 1, failures: [] },
      ],
    },
    meta: response.meta,
  });
});

describe('AiGuardrailsPanel', () => {
  it('leitor vê a camada L1 sem controles de escrita', async () => {
    render(<AiGuardrailsPanel />);
    expect(await screen.findByText('Guardrails L1 aditivos')).toBeVisible();
    expect(screen.queryByLabelText('Nome')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publicar FLAG' })).toBeNull();
  });

  it('expõe apenas FLAG e exige o simulador antes de publicar', async () => {
    const user = userEvent.setup();
    render(<AiGuardrailsPanel canWrite />);
    await user.type(await screen.findByLabelText('Nome'), 'Revisar aumento de carga');
    await user.type(screen.getByLabelText('Frases literais, uma por linha'), 'dobrar a carga');
    await user.type(screen.getByLabelText('Motivo da mudança'), 'Nova revisão operacional');
    expect(screen.queryByRole('option', { name: /BLOCK/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Publicar FLAG' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Executar as 4 etapas' }));
    expect(await screen.findByRole('button', { name: 'Publicar FLAG' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Publicar FLAG' }));
    await waitFor(() =>
      expect(publishL1Guardrail).toHaveBeenCalledWith({
        ruleKey: undefined,
        label: 'Revisar aumento de carga',
        scope: 'BOTH',
        phrases: ['dobrar a carga'],
        action: 'FLAG',
        changeNote: 'Nova revisão operacional',
      }),
    );
  });
});
