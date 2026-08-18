import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

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

import { Step1Registration, type Step1Data } from './step1-registration';
import type { ConsentItemView } from '@/lib/anamnesis-api';

const CONSENTS: ConsentItemView[] = [
  {
    type: 'TERMS_OF_SERVICE',
    version: 'v1',
    title: null,
    body: [],
    label: 'Aceito os termos.',
    required: true,
  },
  {
    type: 'MARKETING',
    version: 'v1',
    title: null,
    body: [],
    label: 'Quero novidades.',
    required: false,
  },
];

const VALID_DATA: Step1Data = {
  name: 'Fulano de Tal',
  birthDate: '1990-01-01',
  biologicalSex: 'MALE',
  heightCm: '178',
  weightKg: '75',
  phoneCountryIso: 'BR',
  phoneMasked: '(11) 99999-9999',
  email: '',
};

function renderStep1(overrides: Partial<Parameters<typeof Step1Registration>[0]> = {}) {
  const props = {
    data: VALID_DATA,
    onChange: vi.fn(),
    consents: CONSENTS,
    acceptedConsents: new Set(['TERMS_OF_SERVICE']),
    onToggleConsent: vi.fn(),
    phoneVerified: true,
    onPhoneVerified: vi.fn(),
    token: 'tok',
    onContinue: vi.fn(),
    saving: false,
    ...overrides,
  };
  render(<Step1Registration {...props} />);
  return props;
}

describe('Step1Registration', () => {
  it('usa a mesma tipografia e o mesmo espaçamento das demais perguntas no legend', () => {
    renderStep1();
    const legend = screen.getByText('Qual é o seu sexo biológico?');
    expect(legend.tagName).toBe('LEGEND');
    expect(legend).toHaveClass('text-body', 'font-semibold', 'text-foreground');
    expect(legend.nextElementSibling).toHaveClass('mt-2');
  });

  it('altura e peso usam os mesmos componentes de campo (label + TextInput)', () => {
    renderStep1();
    const height = screen.getByLabelText(/qual é a sua altura/i);
    const weight = screen.getByLabelText(/qual é o seu peso/i);
    expect(height).toHaveClass('h-[52px]', 'rounded-xl', 'border', 'border-input');
    expect(weight).toHaveClass('h-[52px]', 'rounded-xl', 'border', 'border-input');
  });

  it('Continuar fica desabilitado com altura ou peso fora da faixa plausível', () => {
    renderStep1({ data: { ...VALID_DATA, heightCm: '60' } });
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('mostra a mensagem exata de bloqueio para menores de 18', () => {
    renderStep1({ data: { ...VALID_DATA, birthDate: '2015-01-01' } });
    expect(
      screen.getByText('No momento, a Movivo está disponível apenas para maiores de 18 anos.'),
    ).toBeInTheDocument();
  });

  it('Continuar fica desabilitado com consentimento obrigatório pendente', () => {
    renderStep1({ acceptedConsents: new Set() });
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('Continuar habilita quando tudo está completo e chama onContinue', async () => {
    const user = userEvent.setup();
    const props = renderStep1();
    const button = screen.getByRole('button', { name: 'Continuar' });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(props.onContinue).toHaveBeenCalled();
  });

  it('sem verificação de telefone, CONTINUAR fica desabilitado', () => {
    renderStep1({ phoneVerified: false });
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('envia ao OTP o E.164 do país selecionado', () => {
    renderStep1({
      phoneVerified: false,
      data: { ...VALID_DATA, phoneCountryIso: 'PT', phoneMasked: '912 345 678' },
    });
    expect(screen.getByTestId('otp-phone')).toHaveTextContent('+351912345678');
  });

  it('troca país e número mascarado de forma atômica', async () => {
    const user = userEvent.setup();
    const props = renderStep1();
    await user.click(screen.getByRole('button', { name: /Brasil, \+55/i }));
    await user.click(screen.getByRole('option', { name: /Portugal, DDI \+351/i }));
    expect(props.onChange).toHaveBeenCalledWith({
      ...VALID_DATA,
      phoneCountryIso: 'PT',
      phoneMasked: '119999999',
    });
  });

  it('exibe o aviso operacional do WhatsApp (não é checkbox)', () => {
    renderStep1();
    const title = screen.getByText('Como a MOVIVO fala com você');
    expect(title).toBeInTheDocument();
    expect(title.parentElement).toHaveClass('border-coral', 'bg-coral/10');
    expect(title.parentElement).not.toHaveClass('border-border', 'bg-secondary');
    expect(screen.queryByLabelText(/mensagens operacionais/i)).not.toBeInTheDocument();
  });
});
