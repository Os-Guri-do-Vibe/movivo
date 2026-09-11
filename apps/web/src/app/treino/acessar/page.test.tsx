import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

import WorkoutAccessPage from './page';

describe('WorkoutAccessPage', () => {
  beforeEach(() => {
    replace.mockReset();
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/treino/acessar#token=token-de-teste');
  });

  it('preserva o token quando o Strict Mode repete o efeito depois de limpar a URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <StrictMode>
        <WorkoutAccessPage />
      </StrictMode>,
    );

    await waitFor(() => expect(window.location.hash).toBe(''));
    await userEvent.click(screen.getByRole('button', { name: /abrir meu treino/i }));

    expect(fetchMock).toHaveBeenCalledWith('/api/workout/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'token-de-teste' }),
    });
    expect(replace).toHaveBeenCalledWith('/treino');
  });

  // Achado 2026-09-10 (pedido do fundador): o token do link do WhatsApp só pode ser
  // trocado UMA vez. Se o aluno abriu o link sem querer, fechou tudo e volta a clicar no
  // MESMO link mais tarde pra fazer o check-in de verdade, a troca falha (token já
  // gasto) — mas o navegador dele já pode ter a sessão de 30 dias da primeira troca.
  describe('link já usado neste navegador (achado 2026-09-10)', () => {
    it('sessão de 30 dias ainda ativa: segue pro treino em vez de bloquear o check-in', async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/workout/access/peek')) return { ok: true, json: async () => ({}) };
        if (url === '/api/workout/access') {
          return { ok: false, json: async () => ({ message: 'Este link expirou ou ja foi utilizado.' }) };
        }
        if (url === '/api/workout/journal') return { ok: true };
        throw new Error(`fetch inesperado: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<WorkoutAccessPage />);
      await userEvent.click(await screen.findByRole('button', { name: /abrir meu treino/i }));

      await waitFor(() => expect(replace).toHaveBeenCalledWith('/treino'));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('sem sessão ativa: mostra o erro real do link já usado', async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/workout/access/peek')) return { ok: true, json: async () => ({}) };
        if (url === '/api/workout/access') {
          return { ok: false, json: async () => ({ message: 'Este link expirou ou ja foi utilizado.' }) };
        }
        if (url === '/api/workout/journal') return { ok: false };
        throw new Error(`fetch inesperado: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<WorkoutAccessPage />);
      await userEvent.click(await screen.findByRole('button', { name: /abrir meu treino/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Este link expirou ou ja foi utilizado.');
      expect(replace).not.toHaveBeenCalled();
    });

    it('sem token na URL mas com sessão ativa: abre o treino direto, sem exigir novo link', async () => {
      window.history.replaceState(null, '', '/treino/acessar');
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/workout/journal') return { ok: true };
        throw new Error(`fetch inesperado: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<WorkoutAccessPage />);
      await userEvent.click(await screen.findByRole('button', { name: /abrir meu treino/i }));

      await waitFor(() => expect(replace).toHaveBeenCalledWith('/treino'));
    });
  });
});
