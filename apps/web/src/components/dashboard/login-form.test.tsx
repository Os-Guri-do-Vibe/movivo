import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { replace, capture } = vi.hoisted(() => ({
  replace: vi.fn(),
  capture: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
vi.mock('@/lib/dashboard-api', () => ({ captureDashboardEvent: capture }));

import { LoginForm } from './login-form';

beforeEach(() => {
  replace.mockReset();
  capture.mockReset();
  vi.restoreAllMocks();
});

describe('LoginForm', () => {
  it('envia credenciais ao BFF e navega sem receber token no cliente', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ user: { role: 'PROFESSIONAL' } }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/e-mail profissional/i), 'prof@movivo.test');
    await userEvent.type(screen.getByLabelText('Senha'), 'segura');
    await userEvent.click(screen.getByRole('button', { name: /entrar com segurança/i }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toEqual({ email: 'prof@movivo.test', password: 'segura' });
    expect(
      JSON.stringify(await (fetchMock.mock.results[0]?.value as Promise<unknown>)),
    ).not.toContain('accessToken');
  });

  it('exibe falha genérica e o bloqueio de papel em região acessível', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'E-mail ou senha incorretos.' }),
      }),
    );
    render(<LoginForm initialError="Esta conta não tem permissão para acessar a área CREF." />);
    expect(screen.getByRole('alert')).toHaveTextContent('não tem permissão');
    await userEvent.type(screen.getByLabelText(/e-mail profissional/i), 'x@y.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'x');
    await userEvent.click(screen.getByRole('button', { name: /entrar com segurança/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha incorretos');
  });
});
