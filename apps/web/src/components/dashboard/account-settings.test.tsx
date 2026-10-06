import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getAccountProfile: vi.fn(),
  updateAccountProfile: vi.fn(),
  changeAccountPassword: vi.fn(),
  uploadAccountAvatar: vi.fn(),
}));

vi.mock('@/lib/account-api', () => api);
const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));

import { AccountSettings } from './account-settings';

const PROFILE = {
  name: 'Ana Souza',
  email: 'ana@movivo.app',
  phoneNumber: '+5511988887777',
  avatarUrl: null,
  role: 'ADMIN' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.values(api).forEach((mock) => mock.mockReset());
  api.getAccountProfile.mockResolvedValue(PROFILE);
});

describe('AccountSettings — telefone', () => {
  it('carrega o telefone da conta já com a máscara (DDD) número aplicada', async () => {
    render(<AccountSettings />);
    const input = await screen.findByLabelText('Telefone');
    expect(input).toHaveValue('(11) 98888-7777');
  });

  it('mostra o telefone mascarado com DDI também no card somente leitura', async () => {
    render(<AccountSettings />);
    await screen.findByLabelText('Telefone');
    expect(screen.getByText('+55 (11) 98888-7777')).toBeInTheDocument();
  });

  it('mostra o DDI fixo (+55) ao lado do campo e não repete o texto de ajuda antigo', async () => {
    render(<AccountSettings />);
    await screen.findByLabelText('Telefone');
    expect(screen.getByText('+55')).toBeInTheDocument();
    expect(screen.queryByText(/DDD \+ número, ex\.:/)).not.toBeInTheDocument();
  });

  it('mascara progressivamente enquanto o usuário digita um novo telefone', async () => {
    const user = userEvent.setup();
    render(<AccountSettings />);
    const input = await screen.findByLabelText('Telefone');

    await user.clear(input);
    await user.type(input, '11977776666');

    expect(input).toHaveValue('(11) 97777-6666');
  });

  it('envia o telefone em E.164 ao salvar, mesmo digitado com a máscara', async () => {
    const user = userEvent.setup();
    api.updateAccountProfile.mockResolvedValue({ ...PROFILE, phoneNumber: '+5511977776666' });
    render(<AccountSettings />);
    const input = await screen.findByLabelText('Telefone');

    await user.clear(input);
    await user.type(input, '11977776666');
    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    await waitFor(() =>
      expect(api.updateAccountProfile).toHaveBeenCalledWith({ phoneNumber: '+5511977776666' }),
    );
  });
});

it('pede novo login após trocar senha e revogar as sessões no backend', async () => {
  api.changeAccountPassword.mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<AccountSettings />);
  await user.type(await screen.findByLabelText('Senha atual'), 'Senha-Antiga-123!');
  await user.type(screen.getByLabelText('Nova senha'), 'Senha-Nova-123!');
  await user.type(screen.getByLabelText('Confirmar nova senha'), 'Senha-Nova-123!');
  await user.click(screen.getByRole('button', { name: 'Salvar nova senha' }));
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/entrar?senha=atualizada'));
  expect(api.changeAccountPassword).toHaveBeenCalledWith({
    currentPassword: 'Senha-Antiga-123!',
    newPassword: 'Senha-Nova-123!',
  });
});
