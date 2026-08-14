import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

const { getInviolableRules, getL1Guardrails } = vi.hoisted(() => ({
  getInviolableRules: vi.fn(),
  getL1Guardrails: vi.fn(),
}));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getInviolableRules,
  getL1Guardrails,
}));

import { AiRulesDashboard } from './ai-rules';

const response = {
  data: {
    blocks: [
      {
        id: 'PERSONA',
        layer: 'L2' as const,
        title: 'Identidade e jeito de falar',
        editable: true,
        rationale: 'Muda apenas a forma da conversa, nunca o conteúdo técnico.',
        content: 'Você é a MOVI…',
      },
      {
        id: 'SCOPE_PERIMETER',
        layer: 'L0' as const,
        title: 'Perímetro: só se fala de treino',
        editable: false,
        rationale: 'Ampliar o escopo é decisão de produto com revisão do profissional CREF.',
        content: 'PERÍMETRO (regra de primeira classe): você só conversa sobre o TREINO.',
      },
      {
        id: 'INVIOLABLE_RULES',
        layer: 'L0' as const,
        title: 'Regras que a agente nunca quebra',
        editable: false,
        rationale: 'São exigências regulatórias e de segurança, validadas pelo jurídico.',
        content: 'Regras invioláveis:\n- NUNCA use "diagnóstico".',
      },
    ],
  },
  meta: {
    generatedAt: '2026-08-12T12:00:00.000Z',
    timezone: 'America/Sao_Paulo' as const,
    dataQuality: [],
  },
};

beforeEach(() => {
  getInviolableRules.mockReset().mockResolvedValue(response);
  getL1Guardrails.mockReset().mockResolvedValue({ data: { versions: [] }, meta: response.meta });
});

describe('AiRulesDashboard', () => {
  it('lista os blocos L0 com cadeado, conteúdo e justificativa de negócio', async () => {
    render(<AiRulesDashboard />);
    expect(
      await screen.findByRole('heading', { name: /Perímetro: só se fala de treino/ }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: /Regras que a agente nunca quebra/ })).toBeVisible();
    expect(screen.getAllByLabelText('Travado em código')).toHaveLength(2);
    expect(screen.getByText(/exigências regulatórias e de segurança/)).toBeVisible();
    expect(screen.getByText(/NUNCA use "diagnóstico"/)).toBeVisible();
  });

  it('não exibe o bloco editável nem nenhum controle de edição — nem desabilitado', async () => {
    const { container } = render(<AiRulesDashboard />);
    await screen.findByRole('heading', { name: /Regras que a agente nunca quebra/ });
    expect(screen.queryByText('Identidade e jeito de falar')).toBeNull();
    expect(container.querySelectorAll('input, select, textarea')).toHaveLength(0);
    // O único botão da tela é o "Atualizar" do cabeçalho de setor.
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Atualizar',
    ]);
  });
});
