import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AnamnesisApi from '@/lib/anamnesis-api';
import { AnamnesisApiError, type SessionView } from '@/lib/anamnesis-api';

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
  flow: 'INITIAL',
  currentStep: 1,
  completedSteps: [],
  phoneVerified: false,
  primaryGoal: null,
  consentsPending: false,
  consents: [
    {
      type: 'TERMS_OF_SERVICE',
      version: 'terms-2026-10-v2',
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
  blocks: {},
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
  await user.type(screen.getByLabelText(/qual é a sua altura/i), '178');
  await user.type(screen.getByLabelText(/qual é o seu peso/i), '75');
  await user.type(screen.getByLabelText(/whatsapp/i), '11999999999');
  await user.click(screen.getByText('simular verificação'));
  await user.type(screen.getByLabelText(/e-mail/i), 'fulano@example.com');
  for (const label of ['Aceito.', 'Autorizo.', 'Estou ciente.']) {
    await user.click(screen.getByLabelText(label));
  }
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
}

async function completeParq(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Começar' }));
  for (let index = 0; index < 9; index += 1) {
    await user.click(screen.getByRole('radio', { name: 'Não' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
  }
  for (const declaration of screen.getAllByRole('checkbox')) await user.click(declaration);
  await user.click(screen.getByRole('button', { name: 'Finalizar avaliação' }));
}

/** Aluno que já existia: o cadastro não existe, as etapas 2..N-1 já foram salvas. */
const complementary = (done: number[]): SessionView => ({
  ...SESSION,
  flow: 'COMPLEMENTARY',
  currentStep: 2,
  completedSteps: done,
  phoneVerified: true,
});

beforeEach(() => {
  patchStep.mockReset().mockResolvedValue({ currentStep: 2 });
  recordConsents.mockReset().mockResolvedValue(undefined);
  submitAnamnesis.mockReset();
});

describe('OnboardingWizard — cadastro', () => {
  it('começa na etapa 1 de 8 sem exibir a validade do link', () => {
    render(<OnboardingWizard sessionRef="tok" initial={SESSION} />);
    expect(screen.getByText('Vamos começar por você')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Etapa 1 de 8: Você');
    expect(screen.queryByText(/link fica disponível/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Aceito.')).toBeRequired();
  });

  it('salva o cadastro e abre a etapa de objetivos', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard sessionRef="tok" initial={SESSION} />);
    await completeStep1(user);
    await waitFor(() => expect(recordConsents).toHaveBeenCalled());
    await waitFor(() => expect(patchStep).toHaveBeenCalledWith('tok', 1, expect.any(Object)));
    expect(await screen.findByText('Qual é o seu objetivo?')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      'Etapa 2 de 8: Objetivo',
    );
  });

  it('usa o DDI selecionado no OTP e no PATCH do cadastro', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard sessionRef="tok" initial={SESSION} />);
    await user.type(screen.getByLabelText(/nome completo/i), 'Fulano de Tal');
    await user.click(screen.getByLabelText(/data de nascimento/i));
    await user.click(screen.getByRole('button', { name: 'Ano' }));
    await user.click(screen.getByRole('option', { name: '1990' }));
    await user.click(screen.getByRole('button', { name: 'Mês' }));
    await user.click(screen.getByRole('option', { name: 'Janeiro' }));
    await user.click(screen.getByRole('button', { name: '1 de Janeiro de 1990' }));
    await user.click(screen.getByRole('radio', { name: 'Masculino' }));
    await user.type(screen.getByLabelText(/qual é a sua altura/i), '178');
    await user.type(screen.getByLabelText(/qual é o seu peso/i), '75');
    await user.click(screen.getByRole('button', { name: /Brasil, \+55/i }));
    await user.click(screen.getByRole('option', { name: /Portugal, DDI \+351/i }));
    await user.type(screen.getByLabelText(/whatsapp/i), '912345678');
    expect(screen.getByTestId('otp-phone')).toHaveTextContent('+351912345678');
    await user.click(screen.getByText('simular verificação'));
    await user.type(screen.getByLabelText(/e-mail/i), 'fulano@example.com');
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
        sessionRef="tok"
        initial={{
          ...SESSION,
          phoneVerified: true,
          blocks: { registration: { phoneNumber: '+351912345678' } },
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
        sessionRef="tok"
        initial={{
          ...SESSION,
          phoneVerified: true,
          blocks: { registration: { phoneNumber: '+5511999999999' } },
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Brasil, \+55/i }));
    await user.click(screen.getByRole('option', { name: /Portugal, DDI \+351/i }));
    expect(screen.queryByText('✓ WhatsApp confirmado')).not.toBeInTheDocument();
  });

  it('erro ao salvar mantém os dados do cadastro', async () => {
    const user = userEvent.setup();
    recordConsents.mockRejectedValue(new Error('boom'));
    render(<OnboardingWizard sessionRef="tok" initial={SESSION} />);
    await completeStep1(user);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Vamos começar por você')).toBeInTheDocument();
    expect(screen.getByLabelText(/nome completo/i)).toHaveValue('Fulano de Tal');
  });

  it('outcome presente pula direto para a tela de sucesso', () => {
    render(<OnboardingWizard sessionRef="tok" initial={{ ...SESSION, outcome: 'READY' }} />);
    expect(screen.getByText(/Tudo pronto/)).toBeInTheDocument();
  });
});

describe('OnboardingWizard — retomada', () => {
  it('abre na primeira etapa ainda não salva', () => {
    render(
      <OnboardingWizard
        sessionRef="tok"
        initial={{ ...SESSION, phoneVerified: true, completedSteps: [1, 2, 3] }}
      />,
    );
    expect(screen.getByText('Como é a sua semana?')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      'Etapa 4 de 8: Rotina',
    );
  });

  it('o bloco comum salvo reaparece no formulário', () => {
    render(
      <OnboardingWizard
        sessionRef="tok"
        initial={{
          ...complementary([]),
          blocks: { goals: { goal: { primary: 'FAT_LOSS', secondary: [], emphasis: 'HEALTH' } } },
        }}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Perder gordura' })).toBeChecked();
  });
});

describe('OnboardingWizard — anamnese complementar', () => {
  it('pede o novo aceite dos textos vigentes antes de abrir os objetivos', async () => {
    const user = userEvent.setup();
    render(
      <OnboardingWizard
        sessionRef="tok"
        initial={{ ...complementary([]), consentsPending: true }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Antes de continuar' })).toBeInTheDocument();
    expect(screen.queryByText('Qual é o seu objetivo?')).not.toBeInTheDocument();
    const continuar = screen.getByRole('button', { name: 'Continuar' });
    expect(continuar).toBeDisabled();

    for (const box of screen.getAllByRole('checkbox')) {
      if (box.hasAttribute('required')) await user.click(box);
    }
    await user.click(continuar);

    await waitFor(() => expect(recordConsents).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Qual é o seu objetivo?')).toBeInTheDocument();
  });

  it('pula o cadastro: abre nos objetivos, conta 7 etapas e não oferece voltar', () => {
    render(<OnboardingWizard sessionRef="tok" initial={complementary([])} />);
    expect(screen.getByText('Qual é o seu objetivo?')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      'Etapa 1 de 7: Objetivo',
    );
    expect(screen.queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument();
  });

  it('PAR-Q: salva a etapa 6 e segue para a alimentação', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard sessionRef="tok" initial={complementary([2, 3, 4, 5])} />);
    await completeParq(user);
    await waitFor(() =>
      expect(patchStep).toHaveBeenCalledWith(
        'tok',
        6,
        expect.objectContaining({ declarationsVersion: expect.any(String) }),
      ),
    );
    expect(await screen.findByText('Como é a sua alimentação?')).toBeInTheDocument();
  }, 15_000);

  it('alimentação → corpo (pulado) → envio com a resposta do servidor', async () => {
    const user = userEvent.setup();
    submitAnamnesis.mockResolvedValue({ status: 'SUBMITTED', outcome: 'READY' });
    render(<OnboardingWizard sessionRef="tok" initial={complementary([2, 3, 4, 5, 6])} />);

    await user.type(screen.getByLabelText(/quantas refeições você faz por dia/i), '4');
    await user.click(screen.getByRole('button', { name: 'Almoço' }));
    await user.click(screen.getByRole('radio', { name: 'Normal' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() =>
      expect(patchStep).toHaveBeenCalledWith(
        'tok',
        7,
        expect.objectContaining({ mealsPerDay: 4, usualMeals: ['LUNCH'], hunger: 'NORMAL' }),
      ),
    );

    expect(await screen.findByText('Quer acompanhar suas medidas?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pular esta etapa' }));
    await waitFor(() => expect(submitAnamnesis).toHaveBeenCalledWith('tok'));
    expect(patchStep).not.toHaveBeenCalledWith('tok', 8, expect.anything());
    expect(await screen.findByText(/Tudo pronto/)).toBeInTheDocument();
  });

  it('medidas preenchidas são salvas antes do envio', async () => {
    const user = userEvent.setup();
    submitAnamnesis.mockResolvedValue({ status: 'SUBMITTED', outcome: 'READY' });
    render(<OnboardingWizard sessionRef="tok" initial={complementary([2, 3, 4, 5, 6, 7])} />);
    await screen.findByText('Quer acompanhar suas medidas?');
    await user.type(screen.getByLabelText('Cintura (cm)'), '92');
    await user.click(screen.getByRole('button', { name: 'Salvar e finalizar' }));
    await waitFor(() =>
      expect(patchStep).toHaveBeenCalledWith(
        'tok',
        8,
        expect.objectContaining({
          measurements: [
            expect.objectContaining({ kind: 'WAIST', value: 92, method: 'SELF_TAPE' }),
          ],
        }),
      ),
    );
    await waitFor(() => expect(submitAnamnesis).toHaveBeenCalledWith('tok'));
  });

  it('usa PENDING_REVIEW do servidor sem tentar decidir no cliente', async () => {
    const user = userEvent.setup();
    submitAnamnesis.mockResolvedValue({ status: 'SUBMITTED', outcome: 'PENDING_REVIEW' });
    render(<OnboardingWizard sessionRef="tok" initial={complementary([2, 3, 4, 5, 6, 7])} />);
    await screen.findByText('Quer acompanhar suas medidas?');
    await user.click(screen.getByRole('button', { name: 'Pular esta etapa' }));
    expect(await screen.findByText(/Recebemos suas informações/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Q[1-9]\b|BLOQUEADO/);
  });

  it('409 no envio mostra o motivo real, não "tente de novo"', async () => {
    const user = userEvent.setup();
    submitAnamnesis.mockRejectedValue(
      new AnamnesisApiError(409, ['Já existe um cadastro com este telefone ou e-mail.']),
    );
    render(<OnboardingWizard sessionRef="tok" initial={complementary([2, 3, 4, 5, 6, 7])} />);
    await screen.findByText('Quer acompanhar suas medidas?');
    await user.click(screen.getByRole('button', { name: 'Pular esta etapa' }));
    expect(
      await screen.findByText('Já existe um cadastro com este telefone ou e-mail.'),
    ).toBeInTheDocument();
  });

  it('410 no envio (sessão expirada) orienta a recarregar', async () => {
    const user = userEvent.setup();
    submitAnamnesis.mockRejectedValue(new AnamnesisApiError(410, []));
    render(<OnboardingWizard sessionRef="tok" initial={complementary([2, 3, 4, 5, 6, 7])} />);
    await screen.findByText('Quer acompanhar suas medidas?');
    await user.click(screen.getByRole('button', { name: 'Pular esta etapa' }));
    expect(await screen.findByText(/sessão expirou/i)).toBeInTheDocument();
  });
});
