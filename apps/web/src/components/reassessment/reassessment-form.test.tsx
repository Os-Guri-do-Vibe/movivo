import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getReassessment: vi.fn(),
  submitReassessment: vi.fn(),
  uploadReassessmentPhoto: vi.fn(),
  deleteReassessmentPhoto: vi.fn(),
}));
vi.mock('@/lib/reassessment-api', () => api);
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

import { ReassessmentForm } from './reassessment-form';

const ID = '66666666-6666-4666-8666-666666666666';
const VIEW = {
  id: ID,
  status: 'SENT' as const,
  cycleEndedOn: '2026-11-01',
  firstName: 'Ana',
  photos: { allowed: true, angles: [] as string[] },
  latestMeasurements: [],
};

const pick = (group: string, value: string) =>
  userEvent.click(
    within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name: value }),
  );

beforeEach(() => {
  api.uploadReassessmentPhoto.mockReset().mockResolvedValue(undefined);
  api.deleteReassessmentPhoto.mockReset().mockResolvedValue(undefined);
  api.getReassessment.mockReset().mockResolvedValue(VIEW);
  api.submitReassessment.mockReset().mockResolvedValue(undefined);
});

describe('ReassessmentForm', () => {
  it('sem reavaliação aberta avisa que o WhatsApp chama quando o ciclo terminar', async () => {
    api.getReassessment.mockResolvedValue(null);
    render(<ReassessmentForm />);
    expect(await screen.findByText(/Não há reavaliação aberta/)).toBeInTheDocument();
  });

  it('já respondida não mostra o formulário de novo', async () => {
    api.getReassessment.mockResolvedValue({ ...VIEW, status: 'ANALYZED' });
    render(<ReassessmentForm />);
    expect(await screen.findByText(/já respondeu a reavaliação/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar reavaliação' })).not.toBeInTheDocument();
  });

  it('exige as notas e as respostas de sim ou não antes de enviar', async () => {
    render(<ReassessmentForm />);
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar reavaliação' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Responda as notas/);
    expect(api.submitReassessment).not.toHaveBeenCalled();
  });

  it('valida a faixa das medidas', async () => {
    render(<ReassessmentForm />);
    await userEvent.type(await screen.findByLabelText(/Peso \(kg\)/), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar reavaliação' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Peso: informe um valor entre/);
  });

  it('envia medidas, notas, rotina e saúde no formato esperado', async () => {
    render(<ReassessmentForm />);
    await screen.findByRole('button', { name: 'Enviar reavaliação' });

    await userEvent.type(screen.getByLabelText(/Peso \(kg\)/), '71,5');
    await userEvent.type(screen.getByLabelText(/Cintura \(cm\)/), '82');
    await pick('No geral', '4');
    await pick('O plano alimentar coube na sua rotina', '3');
    await pick('Disposição no dia a dia', '4');
    await pick('Sono', '2');
    await pick('Estresse', '4');
    await pick('Recuperação entre os treinos', '3');
    await userEvent.click(screen.getByRole('radio', { name: 'Fácil demais' }));
    await pick('A sua rotina mudou?', 'Sim');
    for (const day of ['Seg', 'Qua', 'Sex']) {
      await userEvent.click(screen.getByRole('button', { name: day }));
    }
    await userEvent.click(screen.getByRole('button', { name: 'Noite' }));
    await userEvent.type(screen.getByLabelText('Minutos por sessão'), '45');
    await pick('O seu objetivo continua o mesmo?', 'Sim');
    await pick('Teve alguma dor ou lesão nova?', 'Não');
    await pick('Surgiu alguma condição de saúde ou mudança de medicação?', 'Não');
    await userEvent.type(
      screen.getByLabelText('O que atrapalhou ou não funcionou?'),
      'Jantar fora de casa',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Enviar reavaliação' }));

    await waitFor(() => expect(api.submitReassessment).toHaveBeenCalled());
    const [id, answers] = api.submitReassessment.mock.calls[0] ?? [];
    expect(id).toBe(ID);
    expect(answers).toMatchObject({
      measurements: [
        { kind: 'WEIGHT', value: 71.5, method: 'SCALE' },
        { kind: 'WAIST', value: 82, method: 'SELF_TAPE' },
      ],
      phase: {
        overall: 4,
        trainingLoad: 'TOO_EASY',
        foodPlanFit: 3,
        energy: 4,
        sleep: 2,
        stress: 4,
        recovery: 3,
      },
      whatDidNot: 'Jantar fora de casa',
      routine: {
        changed: true,
        daysPerWeek: 3,
        sessionMinutes: 45,
        weekdays: ['MON', 'WED', 'FRI'],
        slot: 'EVENING',
      },
      goals: { stillTheSame: true },
      health: { newPainOrInjury: false, newCondition: false },
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/Recebi tudo/);
  });

  it('envia e remove a foto de uma posição', async () => {
    render(<ReassessmentForm />);
    const input = await screen.findByLabelText('Foto: Frente');
    const file = new File(['x'], 'frente.jpg', { type: 'image/jpeg' });
    await userEvent.upload(input, file);
    await waitFor(() =>
      expect(api.uploadReassessmentPhoto).toHaveBeenCalledWith(ID, 'FRONT', file),
    );
    expect(await screen.findByText('Foto enviada')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(api.deleteReassessmentPhoto).toHaveBeenCalledWith(ID, 'FRONT'));
    expect(await screen.findByLabelText('Foto: Frente')).toBeInTheDocument();
  });

  it('sem autorização das fotos o formulário explica como incluir', async () => {
    api.getReassessment.mockResolvedValue({ ...VIEW, photos: { allowed: false, angles: [] } });
    render(<ReassessmentForm />);
    expect(await screen.findByText(/não autorizou o uso de fotos/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Foto: Frente')).not.toBeInTheDocument();
  });
});
