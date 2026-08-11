import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  PhoneOtp: ({ onVerified }: { onVerified: () => void }) => (
    <button type="button" onClick={onVerified}>
      simular verificação
    </button>
  ),
}));

import { OnboardingWizard } from './onboarding-wizard';

const SESSION: SessionView = {
  status: 'IN_PROGRESS',
  currentStep: 1,
  phoneVerified: false,
  primaryGoal: null,
  consents: [
    { type: 'TERMS_OF_SERVICE', version: 'v1', title: null, body: [], label: 'Aceito.', required: true },
    { type: 'HEALTH_DATA', version: 'v1', title: 'Saúde', body: [], label: 'Autorizo.', required: true },
    { type: 'AI_DISCLOSURE', version: 'v1', title: 'IA', body: [], label: 'Estou ciente.', required: true },
    { type: 'MARKETING', version: 'v1', title: null, body: [], label: 'Novidades.', required: false },
  ],
  step1: null,
  step2: null,
  healthCompleted: false,
  parqCompleted: false,
  outcome: null,
  expiresAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
};

function consentLabel(type: string): string {
  const consent = SESSION.consents.find((c) => c.type === type);
  if (!consent) throw new Error(`consent not found: ${type}`);
  return consent.label;
}

beforeEach(() => {
  patchStep.mockReset().mockResolvedValue({ currentStep: 2 });
  recordConsents.mockReset().mockResolvedValue(undefined);
  submitAnamnesis.mockReset();
});

describe('OnboardingWizard', () => {
  it('começa na etapa 1 e mostra o link de retomada', () => {
    render(<OnboardingWizard token="tok" initial={SESSION} />);
    expect(screen.getByText('Cadastro pessoal')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/salvas/i);
  });

  it('preenche a etapa 1, verifica o telefone e avança para a etapa 2', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard token="tok" initial={SESSION} />);

    await user.type(screen.getByLabelText(/nome completo/i), 'Fulano de Tal');
    await user.type(screen.getByLabelText(/data de nascimento/i), '1990-01-01');
    await user.click(screen.getByText('Masculino'));
    await user.type(screen.getByLabelText(/whatsapp/i), '11999999999');
    await user.click(screen.getByText('simular verificação'));

    for (const type of ['TERMS_OF_SERVICE', 'HEALTH_DATA', 'AI_DISCLOSURE']) {
      await user.click(screen.getByLabelText(consentLabel(type)));
    }

    await user.click(screen.getByRole('button', { name: 'CONTINUAR' }));

    await waitFor(() => expect(recordConsents).toHaveBeenCalled());
    await waitFor(() => expect(patchStep).toHaveBeenCalledWith('tok', 1, expect.any(Object)));
    expect(await screen.findByText('Conte um pouco sobre você')).toBeInTheDocument();
  });

  it('outcome presente pula direto para a tela de sucesso', () => {
    render(<OnboardingWizard token="tok" initial={{ ...SESSION, outcome: 'READY' }} />);
    expect(screen.getByText(/Tudo pronto/)).toBeInTheDocument();
  });

  it('completa as 3 etapas e chama submitAnamnesis no final', async () => {
    const user = userEvent.setup();
    submitAnamnesis.mockResolvedValue({ status: 'SUBMITTED', outcome: 'READY' });
    render(<OnboardingWizard token="tok" initial={SESSION} />);

    // Etapa 1
    await user.type(screen.getByLabelText(/nome completo/i), 'Fulano de Tal');
    await user.type(screen.getByLabelText(/data de nascimento/i), '1990-01-01');
    await user.click(screen.getByText('Masculino'));
    await user.type(screen.getByLabelText(/whatsapp/i), '11999999999');
    await user.click(screen.getByText('simular verificação'));
    for (const type of ['TERMS_OF_SERVICE', 'HEALTH_DATA', 'AI_DISCLOSURE']) {
      await user.click(screen.getByLabelText(consentLabel(type)));
    }
    await user.click(screen.getByRole('button', { name: 'CONTINUAR' }));
    await screen.findByText('Conte um pouco sobre você');

    // Etapa 2 — mínimo pra habilitar CONTINUAR
    await user.click(screen.getByRole('radio', { name: 'Ganhar massa muscular' }));
    await user.click(screen.getByRole('radio', { name: 'Nunca treinei' }));
    await user.click(screen.getByRole('radio', { name: /iniciante/i }));
    await user.click(screen.getByRole('radio', { name: '3 dias' }));
    await user.click(screen.getByRole('radio', { name: 'Aproximadamente 45 minutos' }));
    await user.click(screen.getByRole('radio', { name: 'Em casa' }));
    await user.click(screen.getByRole('radio', { name: 'Manhã' }));
    await user.click(screen.getByRole('button', { name: 'CONTINUAR' }));
    await screen.findByText('Avaliação de segurança');
    expect(patchStep).toHaveBeenCalledWith('tok', 2, expect.any(Object));

    // Etapa 3
    for (const noButton of screen.getAllByText('Não')) {
      await user.click(noButton);
    }
    for (const declaration of screen.getAllByRole('checkbox')) {
      await user.click(declaration);
    }
    await user.click(screen.getByRole('button', { name: 'FINALIZAR AVALIAÇÃO' }));

    await waitFor(() => expect(patchStep).toHaveBeenCalledWith('tok', 3, expect.any(Object)));
    await waitFor(() => expect(submitAnamnesis).toHaveBeenCalledWith('tok'));
    expect(await screen.findByText(/Tudo pronto/)).toBeInTheDocument();
  });

  /**
   * TASK-6.12.1 — a variante da tela de sucesso segue o STATUS REAL do servidor. Aqui o
   * usuário responde "Não" em todo o PAR-Q e mesmo assim o servidor devolve
   * PENDING_REVIEW: se alguém trocar o `outcome` do servidor por um cálculo do cliente
   * sobre as respostas, este teste reprova — nenhum outro reprovaria.
   */
  it('renderiza a V2 quando o servidor diz PENDING_REVIEW, mesmo com PAR-Q todo "Não"', async () => {
    const user = userEvent.setup();
    submitAnamnesis.mockResolvedValue({ status: 'SUBMITTED', outcome: 'PENDING_REVIEW' });
    render(
      <OnboardingWizard
        token="tok"
        initial={{ ...SESSION, currentStep: 3, step1: { name: 'Fulano de Tal' } }}
      />,
    );

    for (const noButton of screen.getAllByText('Não')) {
      await user.click(noButton);
    }
    for (const declaration of screen.getAllByRole('checkbox')) {
      await user.click(declaration);
    }
    await user.click(screen.getByRole('button', { name: 'FINALIZAR AVALIAÇÃO' }));

    await waitFor(() => expect(submitAnamnesis).toHaveBeenCalledWith('tok'));
    expect(await screen.findByText(/Recebemos suas informações/)).toBeInTheDocument();
    expect(screen.queryByText(/Tudo pronto/)).not.toBeInTheDocument();
    // O cliente nunca expõe o motivo do bloqueio (Sofia §9.3).
    expect(document.body.textContent).not.toMatch(/Q[1-9]\b|BLOQUEADO/);
  });

  it('erro ao salvar a etapa 1 mostra alerta e não avança', async () => {
    const user = userEvent.setup();
    recordConsents.mockRejectedValue(new Error('boom'));
    render(<OnboardingWizard token="tok" initial={SESSION} />);

    await user.type(screen.getByLabelText(/nome completo/i), 'Fulano de Tal');
    await user.type(screen.getByLabelText(/data de nascimento/i), '1990-01-01');
    await user.click(screen.getByText('Masculino'));
    await user.type(screen.getByLabelText(/whatsapp/i), '11999999999');
    await user.click(screen.getByText('simular verificação'));
    for (const type of ['TERMS_OF_SERVICE', 'HEALTH_DATA', 'AI_DISCLOSURE']) {
      await user.click(screen.getByLabelText(consentLabel(type)));
    }
    await user.click(screen.getByRole('button', { name: 'CONTINUAR' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Cadastro pessoal')).toBeInTheDocument();
  });
});
