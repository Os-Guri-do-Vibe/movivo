import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AnamnesisApi from '@/lib/anamnesis-api';
import type { SessionView } from '@/lib/anamnesis-api';

const patchStep = vi.fn();
const recordConsents = vi.fn();
const submitAnamnesis = vi.fn();

vi.mock('@/lib/anamnesis-api', async () => {
  const actual = await vi.importActual<typeof AnamnesisApi>('@/lib/anamnesis-api');
  return {
    ...actual,
    patchStep: (...args: unknown[]) => patchStep(...args),
    recordConsents: (...args: unknown[]) => recordConsents(...args),
    submitAnamnesis: (...args: unknown[]) => submitAnamnesis(...args),
  };
});

vi.mock('./phone-otp', () => ({
  PhoneOtp: ({ phoneNumber, onVerified }: { phoneNumber: string; onVerified: () => void }) => (
    <div>
      <span data-testid="otp-phone">{phoneNumber}</span>
      <button type="button" onClick={onVerified}>
        simular verificação
      </button>
    </div>
  ),
}));

import { OnboardingWizard } from './onboarding-wizard';

const SESSION: SessionView = {
  status: 'IN_PROGRESS',
  currentStep: 1,
  phoneVerified: false,
  primaryGoal: null,
  consents: [
    {
      type: 'TERMS_OF_SERVICE',
      version: 'v1',
      title: null,
      body: [],
      label: 'Aceito.',
      required: true,
    },
    {
      type: 'HEALTH_DATA',
      version: 'v1',
      title: 'Saúde',
      body: [],
      label: 'Autorizo.',
      required: true,
    },
    {
      type: 'AI_DISCLOSURE',
      version: 'v1',
      title: 'IA',
      body: [],
      label: 'Estou ciente.',
      required: true,
    },
    {
      type: 'MARKETING',
      version: 'v1',
      title: null,
      body: [],
      label: 'Novidades.',
      required: false,
    },
  ],
  step1: null,
  step2: null,
  healthCompleted: false,
  parqCompleted: false,
  outcome: null,
  expiresAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
};

async function completeStep1(user: UserEvent) {
  await user.type(screen.getByLabelText(/nome completo/i), 'Fulano de Tal');
  await user.click(screen.getByLabelText(/data de nascimento/i));
  await user.click(screen.getByRole('button', { name: 'Ano' }));
  await user.click(screen.getByRole('option', { name: '1990' }));
  await user.click(screen.getByRole('button', { name: 'Mês' }));
  await user.click(screen.getByRole('option', { name: 'Janeiro' }));
  await user.click(screen.getByRole('button', { name: '1 de Janeiro de 1990' }));
  await user.click(screen.getByRole('radio', { name: 'Masculino' }));
  await user.type(screen.getByLabelText(/whatsapp/i), '11999999999');
  await user.click(screen.getByText('simular verificação'));
  for (const label of ['Aceito.', 'Autorizo.', 'Estou ciente.']) {
    await user.click(screen.getByLabelText(label));
  }
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
}

async function completeStep2(user: UserEvent) {
  await user.click(screen.getByRole('radio', { name: 'Hipertrofia' }));
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
  await user.click(screen.getByRole('radio', { name: 'Nunca treinei' }));
  await user.click(
    screen.getByRole('combobox', { name: 'Qual é a sua experiência com musculação?' }),
  );
  await user.click(screen.getByRole('option', { name: /Iniciante/i }));
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
  await user.click(
    screen.getByRole('combobox', { name: 'Quantos dias por semana você consegue treinar?' }),
  );
  await user.click(screen.getByRole('option', { name: '3 dias' }));
  await user.click(screen.getByRole('radio', { name: 'Aproximadamente 45 minutos' }));
  await user.click(screen.getByRole('radio', { name: 'Em casa' }));
  await user.click(screen.getByRole('radio', { name: 'Manhã' }));
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
  await user.click(screen.getByRole('button', { name: 'Continuar para saúde' }));
}

async function completeStep3(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Começar' }));
  for (let index = 0; index < 9; index += 1) {
    await user.click(screen.getByRole('radio', { name: 'Não' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
  }
  for (const declaration of screen.getAllByRole('checkbox')) await user.click(declaration);
  await user.click(screen.getByRole('button', { name: 'Finalizar avaliação' }));
}

beforeEach(() => {
  patchStep.mockReset().mockResolvedValue({ currentStep: 2 });
  recordConsents.mockReset().mockResolvedValue(undefined);
  submitAnamnesis.mockReset();
});

describe('OnboardingWizard', () => {
  it('começa na etapa 1 sem exibir a validade do link', () => {
    render(<OnboardingWizard token="tok" initial={SESSION} />);
    expect(screen.getByText('Vamos começar por você')).toBeInTheDocument();
    expect(screen.queryByText(/link fica disponível/i)).not.toBeInTheDocument();
  });

  it('preenche a etapa 1 e avança para a primeira subtela da etapa 2', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard token="tok" initial={SESSION} />);
    await completeStep1(user);
    await waitFor(() => expect(recordConsents).toHaveBeenCalled());
    await waitFor(() => expect(patchStep).toHaveBeenCalledWith('tok', 1, expect.any(Object)));
    expect(await screen.findByText('Seus objetivos')).toBeInTheDocument();
  });

  it('usa o DDI selecionado no OTP e no PATCH da etapa 1', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard token="tok" initial={SESSION} />);
    await user.type(screen.getByLabelText(/nome completo/i), 'Fulano de Tal');
    await user.click(screen.getByLabelText(/data de nascimento/i));
    await user.click(screen.getByRole('button', { name: 'Ano' }));
    await user.click(screen.getByRole('option', { name: '1990' }));
    await user.click(screen.getByRole('button', { name: 'Mês' }));
    await user.click(screen.getByRole('option', { name: 'Janeiro' }));
    await user.click(screen.getByRole('button', { name: '1 de Janeiro de 1990' }));
    await user.click(screen.getByRole('radio', { name: 'Masculino' }));
    await user.click(screen.getByRole('button', { name: /Brasil, \+55/i }));
    await user.click(screen.getByRole('option', { name: /Portugal, DDI \+351/i }));
    await user.type(screen.getByLabelText(/whatsapp/i), '912345678');
    expect(screen.getByTestId('otp-phone')).toHaveTextContent('+351912345678');
    await user.click(screen.getByText('simular verificação'));
    for (const label of ['Aceito.', 'Autorizo.', 'Estou ciente.']) {
      await user.click(screen.getByLabelText(label));
    }
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() =>
      expect(patchStep).toHaveBeenCalledWith(
        'tok',
        1,
        expect.objectContaining({ phoneNumber: '+351912345678' }),
      ),
    );
  });

  it('restaura país e número E.164 da sessão salva', () => {
    render(
      <OnboardingWizard
        token="tok"
        initial={{
          ...SESSION,
          phoneVerified: true,
          step1: { phoneNumber: '+351912345678' },
        }}
      />,
    );
    expect(screen.getByRole('button', { name: /Portugal, \+351/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/whatsapp/i)).toHaveValue('912 345 678');
    expect(screen.getByText('✓ WhatsApp confirmado')).toBeInTheDocument();
  });

  it('invalida a confirmação local ao trocar de país', async () => {
    const user = userEvent.setup();
    render(
      <OnboardingWizard
        token="tok"
        initial={{
          ...SESSION,
          phoneVerified: true,
          step1: { phoneNumber: '+5511999999999' },
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Brasil, \+55/i }));
    await user.click(screen.getByRole('option', { name: /Portugal, DDI \+351/i }));
    expect(screen.queryByText('✓ WhatsApp confirmado')).not.toBeInTheDocument();
  });

  it('invalida a confirmação ao trocar para país com o mesmo DDI', async () => {
    const user = userEvent.setup();
    render(
      <OnboardingWizard
        token="tok"
        initial={{
          ...SESSION,
          phoneVerified: true,
          step1: { phoneNumber: '+12025550123' },
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Estados Unidos, \+1/i }));
    await user.type(screen.getByRole('searchbox'), 'Canadá');
    await user.click(screen.getByRole('option', { name: /Canadá, DDI \+1/i }));
    expect(screen.queryByText('✓ WhatsApp confirmado')).not.toBeInTheDocument();
  });

  it('outcome presente pula direto para a tela de sucesso', () => {
    render(<OnboardingWizard token="tok" initial={{ ...SESSION, outcome: 'READY' }} />);
    expect(screen.getByText(/Tudo pronto/)).toBeInTheDocument();
  });

  it('não oferece retorno entre macroetapas em sessão retomada sem estado local completo', () => {
    const { unmount } = render(
      <OnboardingWizard token="tok" initial={{ ...SESSION, currentStep: 2 }} />,
    );
    expect(screen.queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument();
    unmount();
    render(<OnboardingWizard token="tok" initial={{ ...SESSION, currentStep: 3 }} />);
    expect(screen.queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument();
  });

  it('salva uma vez por macroetapa e submete a resposta do servidor', async () => {
    const user = userEvent.setup();
    submitAnamnesis.mockResolvedValue({ status: 'SUBMITTED', outcome: 'READY' });
    render(<OnboardingWizard token="tok" initial={SESSION} />);
    await completeStep1(user);
    await screen.findByText('Seus objetivos');
    await completeStep2(user);
    expect(await screen.findByText('Última parte: sua segurança')).toBeInTheDocument();
    expect(patchStep).toHaveBeenCalledWith('tok', 2, expect.any(Object));
    await completeStep3(user);
    await waitFor(() => expect(patchStep).toHaveBeenCalledWith('tok', 3, expect.any(Object)));
    await waitFor(() => expect(submitAnamnesis).toHaveBeenCalledWith('tok'));
    expect(await screen.findByText(/Tudo pronto/)).toBeInTheDocument();
  }, 10_000);

  it('usa PENDING_REVIEW do servidor sem tentar decidir no cliente', async () => {
    const user = userEvent.setup();
    submitAnamnesis.mockResolvedValue({ status: 'SUBMITTED', outcome: 'PENDING_REVIEW' });
    render(
      <OnboardingWizard
        token="tok"
        initial={{ ...SESSION, currentStep: 3, step1: { name: 'Fulano de Tal' } }}
      />,
    );
    await completeStep3(user);
    expect(await screen.findByText(/Recebemos suas informações/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Q[1-9]\b|BLOQUEADO/);
  });

  it('erro ao salvar mantém os dados na etapa 1', async () => {
    const user = userEvent.setup();
    recordConsents.mockRejectedValue(new Error('boom'));
    render(<OnboardingWizard token="tok" initial={SESSION} />);
    await completeStep1(user);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Vamos começar por você')).toBeInTheDocument();
    expect(screen.getByLabelText(/nome completo/i)).toHaveValue('Fulano de Tal');
  });
});
