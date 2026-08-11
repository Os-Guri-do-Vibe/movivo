import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./phone-otp', () => ({
  PhoneOtp: ({ onVerified }: { onVerified: () => void }) => (
    <button type="button" onClick={onVerified}>
      simular verificação
    </button>
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
  it('mostra a mensagem exata de bloqueio para menores de 18', () => {
    renderStep1({ data: { ...VALID_DATA, birthDate: '2015-01-01' } });
    expect(
      screen.getByText('No momento, a Movivo está disponível apenas para maiores de 18 anos.'),
    ).toBeInTheDocument();
  });

  it('CONTINUAR fica desabilitado com consentimento obrigatório pendente', () => {
    renderStep1({ acceptedConsents: new Set() });
    expect(screen.getByRole('button', { name: 'CONTINUAR' })).toBeDisabled();
  });

  it('CONTINUAR habilita quando tudo está completo e chama onContinue', async () => {
    const user = userEvent.setup();
    const props = renderStep1();
    const button = screen.getByRole('button', { name: 'CONTINUAR' });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(props.onContinue).toHaveBeenCalled();
  });

  it('sem verificação de telefone, CONTINUAR fica desabilitado', () => {
    renderStep1({ phoneVerified: false });
    expect(screen.getByRole('button', { name: 'CONTINUAR' })).toBeDisabled();
  });

  it('exibe o aviso operacional do WhatsApp (não é checkbox)', () => {
    renderStep1();
    expect(screen.getByText('Como a MOVIVO fala com você')).toBeInTheDocument();
    expect(screen.queryByLabelText(/mensagens operacionais/i)).not.toBeInTheDocument();
  });
});
