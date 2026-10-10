import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestAccessLink = vi.fn();
const renewExpiredLink = vi.fn();

vi.mock('@/lib/subscription-api', () => ({
  requestAccessLink: (...args: unknown[]) => requestAccessLink(...args),
  renewExpiredLink: (...args: unknown[]) => renewExpiredLink(...args),
}));

import { AccessLinkForm, RenewLinkButton } from './access-link-form';

beforeEach(() => {
  requestAccessLink.mockReset().mockResolvedValue({ accepted: true });
  renewExpiredLink.mockReset().mockResolvedValue({ accepted: true });
});

describe('AccessLinkForm (/conta sem token)', () => {
  it('formata o celular e envia só os dígitos', async () => {
    const user = userEvent.setup();
    render(<AccessLinkForm />);
    const input = screen.getByLabelText(/Celular cadastrado/);
    await user.type(input, '11987654321');
    expect(input).toHaveValue('(11) 98765-4321');
    await user.click(screen.getByRole('button', { name: /Receber link no WhatsApp/ }));
    await waitFor(() => expect(requestAccessLink).toHaveBeenCalledWith('11987654321'));
  });

  it('a confirmação é sempre a mesma e nunca diz se o número é cliente', async () => {
    const user = userEvent.setup();
    render(<AccessLinkForm />);
    await user.type(screen.getByLabelText(/Celular cadastrado/), '11987654321');
    await user.click(screen.getByRole('button', { name: /Receber link/ }));
    const message = await screen.findByRole('status');
    expect(message).toHaveTextContent(/Se este número tiver uma assinatura/);
    expect(message).not.toHaveTextContent(/não encontramos|não existe|inválido/i);
  });

  it('mostra erro de rede sem confirmar nada', async () => {
    const user = userEvent.setup();
    requestAccessLink.mockRejectedValueOnce(new Error('network'));
    render(<AccessLinkForm />);
    await user.type(screen.getByLabelText(/Celular cadastrado/), '11987654321');
    await user.click(screen.getByRole('button', { name: /Receber link/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Não foi possível enviar/);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('RenewLinkButton (link vencido)', () => {
  it('um toque reenvia o link usando só o código do link vencido', async () => {
    const user = userEvent.setup();
    render(<RenewLinkButton code={'A'.repeat(24)} />);
    await user.click(screen.getByRole('button', { name: /Receber novo link/ }));
    await waitFor(() => expect(renewExpiredLink).toHaveBeenCalledWith('A'.repeat(24)));
    expect(await screen.findByRole('status')).toHaveTextContent(/enviamos um novo/);
  });

  it('erro de rede permite tentar de novo', async () => {
    const user = userEvent.setup();
    renewExpiredLink.mockRejectedValueOnce(new Error('network'));
    render(<RenewLinkButton code={'A'.repeat(24)} />);
    await user.click(screen.getByRole('button', { name: /Receber novo link/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Receber novo link/ })).toBeEnabled();
  });
});
