import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AnamnesisApi from '@/lib/anamnesis-api';

const sendPhoneCode = vi.fn();
const verifyPhoneCode = vi.fn();

vi.mock('@/lib/anamnesis-api', async () => {
  const actual = await vi.importActual<typeof AnamnesisApi>('@/lib/anamnesis-api');
  return {
    ...actual,
    sendPhoneCode: (...args: unknown[]) => sendPhoneCode(...args),
    verifyPhoneCode: (...args: unknown[]) => verifyPhoneCode(...args),
  };
});

import { PhoneOtp } from './phone-otp';
import { AnamnesisApiError } from '@/lib/anamnesis-api';

const FUTURE = new Date(Date.now() + 60_000).toISOString();

beforeEach(() => {
  sendPhoneCode.mockReset();
  verifyPhoneCode.mockReset();
  sendPhoneCode.mockResolvedValue({ sent: true, resendAvailableAt: FUTURE, expiresAt: FUTURE });
});

describe('PhoneOtp', () => {
  it('envia o código automaticamente ao montar', async () => {
    render(<PhoneOtp token="tok" phoneNumber="+5511999999999" onVerified={vi.fn()} />);
    await waitFor(() => expect(sendPhoneCode).toHaveBeenCalledWith('tok', '+5511999999999'));
  });

  it('verifica automaticamente ao completar os 6 dígitos e chama onVerified', async () => {
    const user = userEvent.setup();
    const onVerified = vi.fn();
    verifyPhoneCode.mockResolvedValue({ phoneVerified: true });
    render(<PhoneOtp token="tok" phoneNumber="+5511999999999" onVerified={onVerified} />);
    await waitFor(() => expect(sendPhoneCode).toHaveBeenCalled());

    await user.type(screen.getByLabelText(/código de verificação/i), '123456');

    await waitFor(() => expect(verifyPhoneCode).toHaveBeenCalledWith('tok', '123456'));
    await waitFor(() => expect(onVerified).toHaveBeenCalled());
  });

  it('código incorreto mostra erro e limpa o campo', async () => {
    const user = userEvent.setup();
    verifyPhoneCode.mockRejectedValue(new AnamnesisApiError(400, []));
    render(<PhoneOtp token="tok" phoneNumber="+5511999999999" onVerified={vi.fn()} />);
    await waitFor(() => expect(sendPhoneCode).toHaveBeenCalled());

    await user.type(screen.getByLabelText(/código de verificação/i), '000000');

    expect(await screen.findByRole('alert')).toHaveTextContent(/código incorreto/i);
  });

  it('código expirado (410) mostra mensagem específica', async () => {
    const user = userEvent.setup();
    verifyPhoneCode.mockRejectedValue(new AnamnesisApiError(410, []));
    render(<PhoneOtp token="tok" phoneNumber="+5511999999999" onVerified={vi.fn()} />);
    await waitFor(() => expect(sendPhoneCode).toHaveBeenCalled());

    await user.type(screen.getByLabelText(/código de verificação/i), '111111');

    expect(await screen.findByRole('alert')).toHaveTextContent(/expirou/i);
  });
});
