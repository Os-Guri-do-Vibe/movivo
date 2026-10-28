import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExceptionDetail as ExceptionDetailData } from '@movivo/shared';

import type * as ControlCenterApi from '@/lib/control-center-api';

const { getException, getExceptionDecisions, approveException, claimException } = vi.hoisted(
  () => ({
    getException: vi.fn(),
    getExceptionDecisions: vi.fn(),
    approveException: vi.fn(),
    claimException: vi.fn(),
  }),
);
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getException,
  getExceptionDecisions,
  approveException,
  claimException,
  rejectException: vi.fn(),
  resolveException: vi.fn(),
}));

import { ExceptionDetail } from './exception-detail';

const ID = '11111111-1111-4111-8111-111111111111';

function detail(canResolve: boolean): ExceptionDetailData {
  return {
    case: {
      id: ID,
      kind: 'NO_APPLICABLE_POLICY',
      priority: 'NORMAL',
      status: 'OPEN',
      domain: 'NUTRITION',
      summary: 'A política exige decisão humana para ADJUST_ENERGY_TARGET.',
      createdAt: '2026-11-04T12:00:00.000Z',
      assignedStaffId: null,
      userId: '22222222-2222-4222-8222-222222222222',
      resolution: null,
      resolvedAt: null,
      canResolve,
    },
    student: {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Ana Souza',
      timezone: 'America/Sao_Paulo',
    },
    proposal: {
      id: '33333333-3333-4333-8333-333333333333',
      actionType: 'ADJUST_ENERGY_TARGET',
      action: { type: 'ADJUST_ENERGY_TARGET', deltaKcal: 400 },
      rationale: ['Peso parado há quatro semanas.'],
      evidence: [],
      assumptions: ['Pode ser que a ingestão tenha subido sem ser notada.'],
      uncertainty: 'MEDIUM',
      expectedOutcome: 'O peso volta a se mover.',
      status: 'PENDING',
    },
    decision: {
      id: '44444444-4444-4444-8444-444444444444',
      verdict: 'ESCALATE',
      reasons: ['Acima do limite.'],
      decidedBy: 'POLICY_ENGINE',
    },
    safety: null,
    state: {
      goals: { declared: { primary: 'FAT_LOSS' }, strategy: { title: 'Perda de gordura' } },
      adherence: { rate: 0.8, done: 8, planned: 10 },
    },
  };
}

beforeEach(() => {
  getException.mockReset();
  getExceptionDecisions.mockReset().mockResolvedValue([]);
  approveException.mockReset().mockResolvedValue({ id: ID, status: 'RESOLVED' });
  claimException.mockReset();
});

describe('ExceptionDetail', () => {
  it('mostra a proposta em português, as hipóteses como hipótese e o estado do aluno', async () => {
    getException.mockResolvedValue(detail(true));
    render(<ExceptionDetail id={ID} />);

    // A descrição aparece na proposta e, para quem decide, também no diálogo de confirmação.
    expect(
      (await screen.findAllByText('Aumentar a meta de energia em 400 kcal por dia.')).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('Hipóteses (não confirmadas)')).toBeVisible();
    expect(screen.getByText(/Pode ser que a ingestão tenha subido/)).toBeVisible();
    expect(screen.getByText(/Perder gordura/)).toBeVisible();
    expect(screen.getByText(/80% \(8 de 10 sessões\)/)).toBeVisible();
    expect(screen.getByText(/Por que veio para a fila: Acima do limite\./)).toBeVisible();
  });

  it('quem pode decidir vê as ações; aprovar exige confirmar e chama a API', async () => {
    getException.mockResolvedValue(detail(true));
    render(<ExceptionDetail id={ID} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar proposta' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));

    await waitFor(() => expect(approveException).toHaveBeenCalledWith(ID, undefined));
  });

  it('quem não pode decidir não vê nenhuma ação', async () => {
    getException.mockResolvedValue(detail(false));
    render(<ExceptionDetail id={ID} />);

    await screen.findAllByText('Aumentar a meta de energia em 400 kcal por dia.');
    expect(screen.queryByRole('button', { name: 'Aprovar proposta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assumir' })).not.toBeInTheDocument();
  });
});
