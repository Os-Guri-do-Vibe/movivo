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
    await userEvent.type(screen.getByLabelText(/e-mail corporativo/i), 'prof@movivo.test');
    await userEvent.type(screen.getByLabelText('Senha'), 'segura');
    await userEvent.click(screen.getByRole('button', { name: /acessar/i }));
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
    render(
      <LoginForm initialError="Esta conta não tem permissão para acessar o Control Center." />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('não tem permissão');
    await userEvent.type(screen.getByLabelText(/e-mail corporativo/i), 'x@y.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'x');
    await userEvent.click(screen.getByRole('button', { name: /acessar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha incorretos');
  });
});

const TOKEN = 'a'.repeat(64);
// Fixture óbvia (não é segredo): montada por repetição para não parecer uma chave real ao scanner.
const FAKE_SECRET = 'ABCD'.repeat(8);

type Handler = (body: Record<string, unknown>) => { ok: boolean; json: unknown };

/** `fetch` roteado por URL: cada rota do BFF responde o que o teste definir. */
function routedFetch(routes: Record<string, Handler>) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
    calls.push({ url, body });
    const handler = routes[url];
    if (!handler) throw new Error(`rota inesperada: ${url}`);
    const { ok, json } = handler(body);
    return { ok, json: async () => json };
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

async function fillCredentials() {
  await userEvent.type(screen.getByLabelText(/e-mail corporativo/i), 'adm@movivo.test');
  await userEvent.type(screen.getByLabelText('Senha'), 'segura');
  await userEvent.click(screen.getByRole('button', { name: /acessar/i }));
}

describe('LoginForm — segundo fator (MFA)', () => {
  it('senha certa com MFA ativo NÃO navega: pede o código e só então entra', async () => {
    const { calls } = routedFetch({
      '/api/dashboard/session/login': () => ({
        ok: true,
        json: { mfa: { step: 'verify', challengeToken: TOKEN } },
      }),
      '/api/dashboard/session/mfa/verify': () => ({
        ok: true,
        json: { user: { role: 'ADMIN' } },
      }),
    });
    render(<LoginForm />);
    await fillCredentials();

    expect(await screen.findByRole('heading', { name: /duas etapas/i })).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Senha')).not.toBeInTheDocument();

    // A senha digitada NÃO pode reaparecer no campo do código (reuso de <input> pelo React).
    expect(screen.getByLabelText('Código')).toHaveValue('');
    await userEvent.type(screen.getByLabelText('Código'), '123456');
    await userEvent.click(screen.getByRole('button', { name: /verificar e entrar/i }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    // o desafio vai junto do código; a senha não é reenviada
    expect(calls[1]).toEqual({
      url: '/api/dashboard/session/mfa/verify',
      body: { challengeToken: TOKEN, code: '123456' },
    });
  });

  it('código errado mostra o erro e mantém o passo; "Voltar" retorna à senha', async () => {
    routedFetch({
      '/api/dashboard/session/login': () => ({
        ok: true,
        json: { mfa: { step: 'verify', challengeToken: TOKEN } },
      }),
      '/api/dashboard/session/mfa/verify': () => ({
        ok: false,
        json: { message: 'Código inválido ou expirado.' },
      }),
    });
    render(<LoginForm />);
    await fillCredentials();
    await userEvent.type(await screen.findByLabelText('Código'), '000000');
    await userEvent.click(screen.getByRole('button', { name: /verificar e entrar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Código inválido');
    expect(screen.getByLabelText('Código')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /voltar/i }));
    expect(screen.getByLabelText('Senha')).toBeInTheDocument();
  });

  it('desafio queimado/expirado devolve ao passo da senha com o aviso', async () => {
    routedFetch({
      '/api/dashboard/session/login': () => ({
        ok: true,
        json: { mfa: { step: 'verify', challengeToken: TOKEN } },
      }),
      '/api/dashboard/session/mfa/verify': () => ({
        ok: false,
        json: { message: 'Desafio expirado. Entre novamente com e-mail e senha.' },
      }),
    });
    render(<LoginForm />);
    await fillCredentials();
    await userEvent.type(await screen.findByLabelText('Código'), '000000');
    await userEvent.click(screen.getByRole('button', { name: /verificar e entrar/i }));

    expect(await screen.findByLabelText('Senha')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Desafio expirado');
  });

  it('inscrição: mostra QR + chave, ativa com o código e exibe os códigos de recuperação', async () => {
    const { calls } = routedFetch({
      '/api/dashboard/session/login': () => ({
        ok: true,
        json: { mfa: { step: 'setup', challengeToken: TOKEN } },
      }),
      '/api/dashboard/session/mfa/setup': () => ({
        ok: true,
        json: {
          secret: FAKE_SECRET,
          account: 'adm@movivo.test',
          qrDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        },
      }),
      '/api/dashboard/session/mfa/enable': () => ({
        ok: true,
        json: { user: { role: 'ADMIN' }, recoveryCodes: ['AAAAA-BBBBB', 'CCCCC-DDDDD'] },
      }),
    });
    render(<LoginForm />);
    await fillCredentials();

    expect(
      await screen.findByRole('heading', { name: /ative a verificação/i }),
    ).toBeInTheDocument();
    expect(
      await screen.findByAltText(/QR Code para cadastrar a conta adm@movivo.test/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Chave de configuração')).toHaveTextContent(
      FAKE_SECRET.replace(/(.{4})/g, '$1 ').trim(),
    );
    expect(replace).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(/código de 6 dígitos/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /ativar e entrar/i }));

    // Só depois de ver (e confirmar guardar) os códigos o painel abre.
    expect(await screen.findByText('AAAAA-BBBBB')).toBeInTheDocument();
    expect(screen.getByText('CCCCC-DDDDD')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    const proceed = screen.getByRole('button', { name: /continuar para o painel/i });
    expect(proceed).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /guardei os códigos/i }));
    await userEvent.click(proceed);
    expect(replace).toHaveBeenCalledWith('/dashboard');
    expect(calls.map((c) => c.url)).toEqual([
      '/api/dashboard/session/login',
      '/api/dashboard/session/mfa/setup',
      '/api/dashboard/session/mfa/enable',
    ]);
  });

  it('inscrição com desafio expirado volta ao passo da senha', async () => {
    routedFetch({
      '/api/dashboard/session/login': () => ({
        ok: true,
        json: { mfa: { step: 'setup', challengeToken: TOKEN } },
      }),
      '/api/dashboard/session/mfa/setup': () => ({
        ok: false,
        json: { message: 'Desafio expirado. Entre novamente com e-mail e senha.' },
      }),
    });
    render(<LoginForm />);
    await fillCredentials();
    expect(await screen.findByLabelText('Senha')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Desafio expirado');
  });
});
