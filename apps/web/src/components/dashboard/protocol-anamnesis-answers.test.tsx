import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnamnesisAnswers } from '@/lib/dashboard-types';

const api = vi.hoisted(() => ({ getAnamnesisAnswers: vi.fn() }));
vi.mock('@/lib/dashboard-api', () => api);

import { ProtocolAnamnesisAnswers } from './protocol-anamnesis-answers';

const PROTOCOL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const answers: AnamnesisAnswers = {
  userId: 'user-1',
  submittedAt: '2026-08-01T13:00:00.000Z',
  personal: {
    name: 'Rodrigo de Barros',
    birthDate: '1990-01-01',
    biologicalSex: 'MALE',
    heightCm: 178,
    weightKg: 80,
    phoneNumber: '+5511999999999',
    email: 'rodrigo@example.invalid',
  },
  routine: {
    primaryGoal: 'GAIN_MUSCLE',
    emphasis: ['CHEST', 'BACK'],
    hasImportantEvent: false,
    trainingStatus: 'NEVER',
    experience: 'BEGINNER',
    pastActivities: ['NONE'],
    consistencyBarriers: ['LACK_OF_TIME'],
    daysPerWeek: 3,
    preferredDays: ['MON', 'WED', 'FRI'],
    sessionDuration: 'M45_TO_60',
    location: 'HOME',
    preferredPeriod: 'MORNING',
    practicesOtherSport: false,
    hasAvoidedExercise: false,
  },
  health: {
    parq: {
      version: 'parq-2026-07-v1',
      answers: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'].map((questionId) => ({
        questionId,
        answer: false,
      })),
    },
    pain: {
      hasPain: true,
      points: [{ region: 'KNEE', intensity: 4 }],
      hasProfessionalExplanation: false,
      underMedicalFollowUp: false,
      hasAvoidanceRecommendation: false,
    },
    declarations: {
      version: 'v1',
      accepted: ['TRUTHFUL', 'WILL_REPORT_CHANGES'],
      acceptedAt: '2026-08-01T12:59:00.000Z',
    },
  },
};

beforeEach(() => {
  api.getAnamnesisAnswers.mockReset();
});

describe('ProtocolAnamnesisAnswers', () => {
  it('mostra estado de carregamento e depois os blocos de resposta', async () => {
    api.getAnamnesisAnswers.mockResolvedValue(answers);
    render(<ProtocolAnamnesisAnswers protocolId={PROTOCOL_ID} />);
    expect(screen.getByRole('status', { name: 'Carregando respostas da anamnese' })).toBeInTheDocument();
    expect(await screen.findByText('Rodrigo de Barros')).toBeVisible();
    expect(api.getAnamnesisAnswers).toHaveBeenCalledWith('PROTOCOL', PROTOCOL_ID, expect.anything());
  });

  it('mostra cadastro pessoal e objetivos com rótulos legíveis', async () => {
    api.getAnamnesisAnswers.mockResolvedValue(answers);
    render(<ProtocolAnamnesisAnswers protocolId={PROTOCOL_ID} />);
    await screen.findByText('Rodrigo de Barros');
    expect(screen.getByText('Masculino')).toBeVisible();
    expect(screen.getByText('178 cm')).toBeVisible();
    expect(screen.getByText('Hipertrofia')).toBeVisible();
    expect(screen.getByText('Nunca treinei')).toBeVisible();
    expect(screen.getByText('Em casa')).toBeVisible();
    // Data de nascimento com máscara dd/mm/aaaa (não o ISO cru).
    expect(screen.getByText('01/01/1990')).toBeVisible();
    // WhatsApp no formato DDI (DDD) 9xxxx-xxxx (não o E.164 cru).
    expect(screen.getByText('+55 (11) 99999-9999')).toBeVisible();
  });

  it('mostra as 9 perguntas do PAR-Q com o texto completo', async () => {
    api.getAnamnesisAnswers.mockResolvedValue(answers);
    render(<ProtocolAnamnesisAnswers protocolId={PROTOCOL_ID} />);
    await screen.findByText('Rodrigo de Barros');
    const question = screen.getByText(
      'O seu médico já disse que você tem algum problema no coração ou pressão alta?',
    );
    expect(question).toBeVisible();
    const parqSection = question.closest('section') as HTMLElement;
    expect(within(parqSection).getAllByRole('listitem')).toHaveLength(9);
    expect(within(parqSection).getAllByText('Não')).toHaveLength(9);
  });

  it('mostra dor relatada e o TEXTO das declarações aceitas (não as tags)', async () => {
    api.getAnamnesisAnswers.mockResolvedValue(answers);
    render(<ProtocolAnamnesisAnswers protocolId={PROTOCOL_ID} />);
    await screen.findByText('Rodrigo de Barros');
    expect(screen.getByText(/Joelho \(4\/10\)/)).toBeVisible();
    expect(
      screen.getByText(
        'Declaro que as informações que forneci são verdadeiras e estão atualizadas nesta data.',
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Estou ciente de que devo comunicar à MOVIVO qualquer mudança na minha condição de saúde.',
      ),
    ).toBeVisible();
    expect(screen.queryByText('TRUTHFUL')).not.toBeInTheDocument();
    expect(screen.queryByText('WILL_REPORT_CHANGES')).not.toBeInTheDocument();
  });

  it('link "Voltar ao protocolo" leva pro protocolo, não pra anamnese', async () => {
    api.getAnamnesisAnswers.mockResolvedValue(answers);
    render(<ProtocolAnamnesisAnswers protocolId={PROTOCOL_ID} />);
    const back = await screen.findByRole('link', { name: /Voltar ao protocolo/i });
    expect(back).toHaveAttribute('href', `/dashboard/fila/protocol/${PROTOCOL_ID}`);
  });

  it('erro ao carregar mostra alerta com botão de tentar de novo', async () => {
    const user = userEvent.setup();
    api.getAnamnesisAnswers.mockRejectedValueOnce(new Error('falhou'));
    render(<ProtocolAnamnesisAnswers protocolId={PROTOCOL_ID} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('falhou');
    api.getAnamnesisAnswers.mockResolvedValueOnce(answers);
    await user.click(screen.getByRole('button', { name: /Tentar novamente/i }));
    expect(await screen.findByText('Rodrigo de Barros')).toBeVisible();
  });
});
