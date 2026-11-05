import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

const { getExceptionAnamnesis } = vi.hoisted(() => ({ getExceptionAnamnesis: vi.fn() }));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getExceptionAnamnesis,
}));

import { AnamnesisAnswersButton, AnamnesisAnswersContent } from './anamnesis-answers';

beforeEach(() => getExceptionAnamnesis.mockReset());

describe('AnamnesisAnswersButton', () => {
  it('só busca as respostas (dado de saúde) quando o profissional abre', async () => {
    getExceptionAnamnesis.mockResolvedValue({
      submittedAt: '2026-11-01T12:00:00.000Z',
      flow: 'INITIAL',
      steps: [
        {
          step: 5,
          title: 'Preferências de treino e saúde geral',
          data: { medications: 'Losartana', preferences: { priority: 'BALANCED' } },
        },
        {
          step: 6,
          title: 'Dores e limitações',
          data: {
            pain: {
              hasPain: true,
              points: [{ region: 'KNEE', intensity: 4 }],
              trend: 'STABLE',
            },
          },
        },
        {
          step: 9,
          title: 'PAR-Q',
          data: {
            parq: { answers: [{ questionId: 'Q1', answer: true }] },
            declarations: ['a', 'b', 'c'],
          },
        },
      ],
    });
    render(<AnamnesisAnswersButton caseId="11111111-1111-4111-8111-111111111111" />);
    expect(getExceptionAnamnesis).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /Ver anamnese/ }));

    expect(await screen.findByText('Losartana')).toBeVisible();
    expect(screen.getByText('Medicamentos em uso')).toBeVisible();
    expect(screen.getByText('Equilibrado')).toBeVisible();
    expect(screen.getByText('Joelho')).toBeVisible();
    expect(screen.getByText('Estável')).toBeVisible();
    expect(screen.getByText('3 declarações aceitas.')).toBeVisible();
    expect(getExceptionAnamnesis).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.anything(),
    );
  });

  it('mostra o esporte externo dentro da semana, com rótulos legíveis', () => {
    render(
      <AnamnesisAnswersContent
        view={{
          submittedAt: null,
          flow: 'INITIAL',
          steps: [
            {
              step: 4,
              title: 'Sua semana',
              data: {
                externalSports: [
                  {
                    sport: 'SWIMMING',
                    label: 'Natação',
                    sessionsPerWeek: 2,
                    minutesPerSession: 60,
                    typicalRpe: 5,
                    fixedDays: ['TUE'],
                  },
                ],
                maxSessionsPerWeek: 3,
              },
            },
          ],
        }}
      />,
    );
    expect(screen.getByRole('region', { name: 'Sua semana' })).toBeVisible();
    expect(screen.getByText('Natação')).toBeVisible();
    expect(screen.getByText('Minutos por sessão')).toBeVisible();
    expect(screen.getByText('Dias fixos')).toBeVisible();
    expect(screen.getByText('Terça')).toBeVisible();
    expect(screen.getByText('Máximo de treinos por semana que topa')).toBeVisible();
  });
});
