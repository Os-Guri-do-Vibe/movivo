import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type * as CheckinWeeklyApi from '@/lib/checkin-weekly-api';
import { CheckinWeeklyApiError, submitCheckinWeekly } from '@/lib/checkin-weekly-api';
import { WeeklyCheckinClient } from './weekly-checkin-client';

vi.mock('@/lib/checkin-weekly-api', async (importOriginal) => ({
  ...(await importOriginal<typeof CheckinWeeklyApi>()),
  submitCheckinWeekly: vi.fn(),
}));

// A cobertura do fluxo real de 8 perguntas já está em `weekly-checkin-form.test.tsx` —
// aqui isolamos a lógica do wrapper (estado de envio, tratamento de erro por status).
vi.mock('./weekly-checkin-form', () => ({
  WeeklyCheckinForm: ({ onSubmit }: { onSubmit: (payload: unknown) => void }) => (
    <button onClick={() => onSubmit({ sleepQuality: 'BOA' })}>Enviar (mock)</button>
  ),
}));

const TOKEN = 'a'.repeat(64);

function submitMock() {
  return submitCheckinWeekly as unknown as ReturnType<typeof vi.fn>;
}

describe('WeeklyCheckinClient', () => {
  it('envio com sucesso: mostra a tela de agradecimento com o primeiro nome', async () => {
    submitMock().mockResolvedValueOnce({ status: 'SUBMITTED' });
    const user = userEvent.setup();
    render(<WeeklyCheckinClient token={TOKEN} firstName="Maria Silva" />);
    await user.click(screen.getByRole('button', { name: 'Enviar (mock)' }));
    expect(await screen.findByText(/Recebemos suas respostas, Maria Silva!/)).toBeInTheDocument();
  });

  it('sem nome cadastrado: tela de agradecimento usa "você"', async () => {
    submitMock().mockResolvedValueOnce({ status: 'SUBMITTED' });
    const user = userEvent.setup();
    render(<WeeklyCheckinClient token={TOKEN} firstName={null} />);
    await user.click(screen.getByRole('button', { name: 'Enviar (mock)' }));
    expect(await screen.findByText(/Recebemos suas respostas, você!/)).toBeInTheDocument();
  });

  it('check-in expirado (410): mostra mensagem de link vencido', async () => {
    submitMock().mockRejectedValueOnce(new CheckinWeeklyApiError(410, []));
    const user = userEvent.setup();
    render(<WeeklyCheckinClient token={TOKEN} firstName="Maria" />);
    await user.click(screen.getByRole('button', { name: 'Enviar (mock)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Este check-in expirou/);
  });

  it('check-in já enviado (409): mostra mensagem pra recarregar', async () => {
    submitMock().mockRejectedValueOnce(new CheckinWeeklyApiError(409, []));
    const user = userEvent.setup();
    render(<WeeklyCheckinClient token={TOKEN} firstName="Maria" />);
    await user.click(screen.getByRole('button', { name: 'Enviar (mock)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/já tinha sido enviado/);
  });

  it('corpo fora do schema (400) com issue: mostra a primeira mensagem de validação', async () => {
    submitMock().mockRejectedValueOnce(new CheckinWeeklyApiError(400, ['sleepQuality inválido']));
    const user = userEvent.setup();
    render(<WeeklyCheckinClient token={TOKEN} firstName="Maria" />);
    await user.click(screen.getByRole('button', { name: 'Enviar (mock)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('sleepQuality inválido');
  });

  it('400 sem issues: cai na mensagem genérica', async () => {
    submitMock().mockRejectedValueOnce(new CheckinWeeklyApiError(400, []));
    const user = userEvent.setup();
    render(<WeeklyCheckinClient token={TOKEN} firstName="Maria" />);
    await user.click(screen.getByRole('button', { name: 'Enviar (mock)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não conseguimos enviar suas respostas.',
    );
  });

  it('erro inesperado (não é CheckinWeeklyApiError): cai na mensagem genérica', async () => {
    submitMock().mockRejectedValueOnce(new Error('falha de rede'));
    const user = userEvent.setup();
    render(<WeeklyCheckinClient token={TOKEN} firstName="Maria" />);
    await user.click(screen.getByRole('button', { name: 'Enviar (mock)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não conseguimos enviar suas respostas.',
    );
  });
});
