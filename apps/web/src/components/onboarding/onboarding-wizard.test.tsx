import { render, screen, waitFor, within } from '@testing-library/react';
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
  bodyPhotosConsent: {
    type: 'BODY_PHOTOS',
    version: 'consent-body-photos-2026-10-v1',
    title: 'Sobre as fotos do seu corpo',
    body: [],
    label: 'Autorizo as fotos.',
    required: false,
  },
  bodyPhotosConsentAccepted: false,
  photos: [],
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
  it('começa na etapa 1 de 9 sem exibir a validade do link', () => {
    render(<OnboardingWizard sessionRef="tok" initial={SESSION} />);
    expect(screen.getByText('Vamos começar por você')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Etapa 1 de 9: Você');
    expect(screen.queryByText(/link fica disponível/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Aceito.')).toBeRequired();
  });

  it('salva o cadastro e abre a etapa de objetivos', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard sessionRef="tok" initial={SESSION} />);
    await completeStep1(user);
    await waitFor(() => expect(recordConsents).toHaveBeenCalled());
    await waitFor(() => expect(patchStep).toHaveBeenCalledWith('tok', 1, expect.any(Object)));
    expect(await screen.findByText('Seus objetivos')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      'Etapa 2 de 9: Objetivo',
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
    expect(screen.getByRole('heading', { name: 'Sua semana' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      'Etapa 4 de 9: Semana',
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
    expect(
      screen.getByRole('combobox', { name: 'Qual é o seu objetivo principal?' }),
    ).toHaveTextContent('Emagrecimento');
  });

  it('texto sigiloso em branco: mantém o salvo ao retomar e só apaga o que foi visto nesta aba', async () => {
    const user = userEvent.setup();
    render(
      <OnboardingWizard
        sessionRef="tok"
        initial={{
          ...complementary([2]),
          blocks: { goals: { goal: { primary: 'FAT_LOSS', secondary: [], emphasis: 'HEALTH' } } },
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(patchStep).toHaveBeenCalledTimes(1));
    expect(patchStep.mock.calls[0]?.[2]).not.toHaveProperty('motivation');

    await user.click(await screen.findByRole('button', { name: 'Voltar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(patchStep).toHaveBeenCalledTimes(2));
    expect(patchStep.mock.calls[1]?.[2]).toMatchObject({ motivation: '' });
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
    expect(screen.queryByText('Seus objetivos')).not.toBeInTheDocument();
    const continuar = screen.getByRole('button', { name: 'Continuar' });
    expect(continuar).toBeDisabled();

    for (const box of screen.getAllByRole('checkbox')) {
      if (box.hasAttribute('required')) await user.click(box);
    }
    await user.click(continuar);

    await waitFor(() => expect(recordConsents).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Seus objetivos')).toBeInTheDocument();
  });

  it('retomada em etapa adiantada também fica atrás do novo aceite', () => {
    render(
      <OnboardingWizard
        sessionRef="tok"
        initial={{ ...complementary([2, 3]), consentsPending: true }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Antes de continuar' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sua semana' })).not.toBeInTheDocument();
  });

  it('semana de sessão antiga herda o esporte externo da etapa 3 e salva tudo na etapa 4', async () => {
    const user = userEvent.setup();
    render(
      <OnboardingWizard
        sessionRef="tok"
        initial={{
          ...complementary([2, 3]),
          blocks: {
            modalities: {
              modalities: [
                {
                  modality: 'RUNNING',
                  level: 'NONE',
                  wantsToStart: true,
                  venue: 'OUTDOOR',
                },
              ],
              externalSports: [
                {
                  sport: 'SWIMMING',
                  label: 'Natação',
                  sessionsPerWeek: 2,
                  minutesPerSession: 60,
                  typicalRpe: 5,
                  fixedDays: [],
                },
              ],
            },
          },
        }}
      />,
    );
    expect(
      screen.getByText(/a MOVIVO decide quantos treinos de corrida fazem sentido/),
    ).toBeInTheDocument();
    // O esporte salvo na etapa 3 antiga reaparece já respondido, no topo da semana.
    expect(
      within(screen.getByRole('group', { name: /pratica algum esporte por fora/ })).getByRole(
        'radio',
        { name: 'Sim' },
      ),
    ).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Qual esporte?' })).toHaveTextContent('Natação');
    await user.click(screen.getByRole('combobox', { name: 'Em quais dias você pode treinar?' }));
    await user.click(screen.getByRole('option', { name: 'Segunda-feira' }));
    await user.click(screen.getByRole('option', { name: 'Quinta-feira' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('radio', { name: 'Manhã' }));
    await user.click(screen.getByRole('radio', { name: 'Cerca de 45 minutos' }));
    await user.click(
      within(
        screen.getByRole('group', {
          name: 'Esses dias e horários mudam de uma semana para outra, por escala, plantão ou viagem?',
        }),
      ).getByRole('radio', { name: 'Não' }),
    );
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() =>
      expect(patchStep).toHaveBeenCalledWith('tok', 4, {
        externalSports: [
          {
            sport: 'SWIMMING',
            label: 'Natação',
            sessionsPerWeek: 2,
            minutesPerSession: 60,
            typicalRpe: 5,
            fixedDays: [],
          },
        ],
        windows: [
          { weekday: 'MON', slot: 'MORNING', maxMinutes: 45 },
          { weekday: 'THU', slot: 'MORNING', maxMinutes: 45 },
        ],
        variesWeekly: false,
        lifeContext: {},
      }),
    );
  });

  it('pula o cadastro: abre nos objetivos, conta 8 etapas e não oferece voltar', () => {
    render(<OnboardingWizard sessionRef="tok" initial={complementary([])} />);
    expect(screen.getByText('Seus objetivos')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      'Etapa 1 de 8: Objetivo',
    );
    expect(screen.queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument();
  });

  it('dores: tela própria; "Não" salva a etapa 6 e segue para a alimentação', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard sessionRef="tok" initial={complementary([2, 3, 4, 5])} />);
    expect(await screen.findByText('Dores e limitações')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Não' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() =>
      expect(patchStep).toHaveBeenCalledWith('tok', 6, { pain: { hasPain: false, points: [] } }),
    );
    expect(await screen.findByText('Como é a sua alimentação?')).toBeInTheDocument();
  });

  it('alimentação → corpo (pulado) → PAR-Q por último → envio com a resposta do servidor', async () => {
    const user = userEvent.setup();
    submitAnamnesis.mockResolvedValue({ status: 'SUBMITTED', outcome: 'READY' });
    render(<OnboardingWizard sessionRef="tok" initial={complementary([2, 3, 4, 5, 6])} />);

    await user.click(screen.getByRole('radio', { name: /^Cozinho o básico/ }));
    await user.type(screen.getByLabelText(/refeições por semana você faz fora/i), '3');
    await user.type(screen.getByLabelText(/gastar por mês com a sua alimentação/i), '120000');
    await user.click(screen.getByRole('button', { name: 'Almoço' }));
    const allergy = screen.getByRole('group', {
      name: 'Você tem alguma alergia ou intolerância alimentar?',
    });
    await user.click(within(allergy).getByRole('radio', { name: 'Não' }));
    await user.click(screen.getByRole('radio', { name: 'Normal' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() =>
      expect(patchStep).toHaveBeenCalledWith(
        'tok',
        7,
        expect.objectContaining({
          mealsPerDay: 1,
          usualMeals: ['LUNCH'],
          hunger: 'NORMAL',
          cookingCapacity: 'BASIC',
          mealsOutsideHomePerWeek: 3,
          foodBudgetMonthlyBrl: 1200,
        }),
      ),
    );

    expect(await screen.findByText('Quer registrar o seu ponto de partida?')).toBeInTheDocument();
    // Etapa opcional: "Continuar" já vem habilitado e, sem medidas, só segue (nada é salvo).
    expect(screen.queryByRole('button', { name: 'Pular esta etapa' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(patchStep).not.toHaveBeenCalledWith('tok', 8, expect.anything());
    // O PAR-Q é a última parte: só depois dele a anamnese é enviada.
    expect(await screen.findByText('Última parte: sua segurança')).toBeInTheDocument();
    expect(submitAnamnesis).not.toHaveBeenCalled();
    await completeParq(user);
    await waitFor(() =>
      expect(patchStep).toHaveBeenCalledWith(
        'tok',
        9,
        expect.objectContaining({ declarationsVersion: expect.any(String) }),
      ),
    );
    await waitFor(() => expect(submitAnamnesis).toHaveBeenCalledWith('tok'));
    expect(await screen.findByText(/Tudo pronto/)).toBeInTheDocument();
  }, 20_000);

  it('medidas preenchidas são salvas antes do PAR-Q', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard sessionRef="tok" initial={complementary([2, 3, 4, 5, 6, 7])} />);
    await screen.findByText('Quer registrar o seu ponto de partida?');
    await user.type(screen.getByLabelText('Cintura'), '92');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
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
    expect(await screen.findByText('Última parte: sua segurança')).toBeInTheDocument();
    expect(submitAnamnesis).not.toHaveBeenCalled();
  });

  it('usa PENDING_REVIEW do servidor sem tentar decidir no cliente', async () => {
    const user = userEvent.setup();
    submitAnamnesis.mockResolvedValue({ status: 'SUBMITTED', outcome: 'PENDING_REVIEW' });
    render(<OnboardingWizard sessionRef="tok" initial={complementary([2, 3, 4, 5, 6, 7, 8])} />);
    await completeParq(user);
    expect(await screen.findByText(/Recebemos suas informações/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Q[1-9]\b|BLOQUEADO/);
  }, 20_000);

  it('409 no envio mostra o motivo real, não "tente de novo"', async () => {
    const user = userEvent.setup();
    submitAnamnesis.mockRejectedValue(
      new AnamnesisApiError(409, ['Já existe um cadastro com este telefone ou e-mail.']),
    );
    render(<OnboardingWizard sessionRef="tok" initial={complementary([2, 3, 4, 5, 6, 7, 8])} />);
    await completeParq(user);
    expect(
      await screen.findByText('Já existe um cadastro com este telefone ou e-mail.'),
    ).toBeInTheDocument();
  }, 20_000);

  it('410 no envio (sessão expirada) orienta a recarregar', async () => {
    const user = userEvent.setup();
    submitAnamnesis.mockRejectedValue(new AnamnesisApiError(410, []));
    render(<OnboardingWizard sessionRef="tok" initial={complementary([2, 3, 4, 5, 6, 7, 8])} />);
    await completeParq(user);
    expect(await screen.findByText(/sessão expirou/i)).toBeInTheDocument();
  }, 20_000);
});
