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
});
