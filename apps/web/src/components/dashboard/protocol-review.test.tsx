import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProtocolReview as Protocol } from '@movivo/shared';

import type * as ControlCenterApi from '@/lib/control-center-api';

const { getExceptionProtocol, saveExceptionProtocol, requestProtocolAdjustment } = vi.hoisted(
  () => ({
    getExceptionProtocol: vi.fn(),
    saveExceptionProtocol: vi.fn(),
    requestProtocolAdjustment: vi.fn(),
  }),
);
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getExceptionProtocol,
  saveExceptionProtocol,
  requestProtocolAdjustment,
}));

import { ProtocolEditError } from '@/lib/control-center-api';

import { ProtocolReview } from './protocol-review';

const ID = '11111111-1111-4111-8111-111111111111';

const protocol: Protocol = {
  kind: 'TRAINING',
  planId: '22222222-2222-4222-8222-222222222222',
  version: 1,
  status: 'DRAFT',
  editable: true,
  strategy: {
    title: 'Força com consistência',
    modalityFocus: ['STRENGTH'],
    energyStrategy: 'MAINTENANCE',
    studentMessage: 'No seu ritmo.',
  },
  structure: {
    summary: 'Duas sessões de força por semana.',
    modalityPriorities: [{ modality: 'STRENGTH', priority: 1 }],
    phases: [{ name: 'Adaptação', focus: 'Técnica.', weeks: 4, endsWithDeload: false }],
    sessions: [
      {
        key: 'FORCA_A',
        title: 'Força A',
        purpose: 'Base.',
        priority: 'KEY',
        weeklyFrequency: 2,
        estimatedMinutes: 50,
        estimatedRpe: 7,
        content: {
          modality: 'STRENGTH',
          focus: 'Corpo inteiro',
          exercises: [
            {
              exerciseId: 'agachamento',
              name: 'Agachamento',
              sets: 3,
              reps: { min: 8, max: 10 },
              loadStrategy: 'RIR',
              rir: 2,
              restSeconds: 90,
            },
          ],
        },
      },
    ],
  },
  weekPreview: {
    weekStart: '2026-11-02',
    startsOn: '2026-11-04',
    sessions: [
      {
        date: '2026-11-04',
        slot: 'EVENING',
        sessionKey: 'FORCA_A',
        occurrence: 1,
        title: 'Força A',
        modality: 'STRENGTH',
        priority: 'KEY',
      },
    ],
    dropped: [],
  },
  exerciseOptions: [
    { id: 'agachamento', name: 'Agachamento', measurement: 'REPS' },
    { id: 'leg_press', name: 'Leg press', measurement: 'REPS' },
  ],
};

beforeEach(() => {
  getExceptionProtocol.mockReset().mockResolvedValue(protocol);
  saveExceptionProtocol.mockReset().mockResolvedValue(protocol);
  requestProtocolAdjustment.mockReset();
});

describe('ProtocolReview', () => {
  it('mostra a semana simulada e as sessões do protocolo', async () => {
    render(<ProtocolReview caseId={ID} canAct onChanged={vi.fn()} />);
    expect(await screen.findByText(/qua 04\/11 · noite/)).toBeInTheDocument();
    expect(screen.getByText(/Agachamento — 3 × 8–10/)).toBeInTheDocument();
  });

  it('troca o exercício e salva a edição', async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(<ProtocolReview caseId={ID} canAct onChanged={onChanged} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar à mão' }));
    await userEvent.selectOptions(screen.getByLabelText('Exercício'), 'leg_press');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar edição' }));

    await waitFor(() => expect(saveExceptionProtocol).toHaveBeenCalledOnce());
    const [, body] = saveExceptionProtocol.mock.calls[0] ?? [];
    expect(body.kind).toBe('TRAINING');
    expect(body.structure.sessions[0].content.exercises[0]).toMatchObject({
      exerciseId: 'leg_press',
      name: 'Leg press',
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it('mostra cada problema apontado pela conferência do servidor', async () => {
    saveExceptionProtocol.mockRejectedValue(
      new ProtocolEditError(400, 'O protocolo editado não passou na conferência.', [
        '3 sessões por semana passam do que o aluno sustenta (2)',
      ]),
    );
    render(<ProtocolReview caseId={ID} canAct onChanged={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar à mão' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar edição' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/passam do que o aluno sustenta/);
  });

  it('sem poder agir, só lê', async () => {
    render(<ProtocolReview caseId={ID} canAct={false} onChanged={vi.fn()} />);
    await screen.findByText(/Duas sessões de força/);
    expect(screen.queryByRole('button', { name: 'Editar à mão' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pedir ajuste' })).toBeNull();
  });
});
