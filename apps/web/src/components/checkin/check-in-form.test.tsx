import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getCurrentCheckIn: vi.fn(), answerCheckIn: vi.fn() }));
vi.mock('@/lib/checkin-api', () => api);
vi.mock('@/lib/training-api', () => ({
  TrainingApiError: class extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

import { CheckInForm } from './check-in-form';

const CHECK_IN = {
  id: '55555555-5555-4555-8555-555555555555',
  questions: [
    { key: 'pain', prompt: 'Sentiu alguma dor?', type: 'YES_NO' as const, reason: 'segurança' },
    { key: 'energy', prompt: 'Como está a energia?', type: 'SCALE_1_5' as const, reason: 'base' },
    {
      key: 'barrier',
      prompt: 'O que atrapalhou?',
      type: 'CHOICE' as const,
      options: ['Falta de tempo', 'Cansaço'],
      reason: 'adesão',
    },
    { key: 'weight_kg', prompt: 'Quanto você pesa?', type: 'NUMBER' as const, reason: 'peso' },
  ],
};

beforeEach(() => {
  api.getCurrentCheckIn.mockReset().mockResolvedValue(CHECK_IN);
  api.answerCheckIn.mockReset().mockResolvedValue(undefined);
});

describe('CheckInForm', () => {
  it('envia as respostas de cada tipo de pergunta', async () => {
    render(<CheckInForm />);
    await screen.findByText('Sentiu alguma dor?');
    await userEvent.click(screen.getByRole('radio', { name: 'Não' }));
    await userEvent.click(screen.getAllByRole('radio', { name: '4' })[0] as HTMLElement);
    await userEvent.click(screen.getByRole('radio', { name: 'Cansaço' }));
    await userEvent.type(screen.getByLabelText('Quanto você pesa?'), '81,5');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(api.answerCheckIn).toHaveBeenCalled());
    expect(api.answerCheckIn).toHaveBeenCalledWith(CHECK_IN.id, {
      pain: false,
      energy: 4,
      barrier: 'Cansaço',
      weight_kg: 81.5,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/Obrigado/);
  });

  it('sem check-in aberto avisa que o WhatsApp chama na hora certa', async () => {
    api.getCurrentCheckIn.mockResolvedValue(null);
    render(<CheckInForm />);
    expect(await screen.findByText(/Não há check-in aberto/)).toBeInTheDocument();
  });

  it('erro do servidor aparece e o formulário continua disponível', async () => {
    api.answerCheckIn.mockRejectedValue(new Error('falta responder: pain'));
    render(<CheckInForm />);
    await screen.findByText('Sentiu alguma dor?');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('falta responder: pain');
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled();
  });
});
