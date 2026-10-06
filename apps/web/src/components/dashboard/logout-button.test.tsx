import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));

import { LogoutButton } from './logout-button';

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('LogoutButton', () => {
  it('usa vermelho literal (não o coral da marca) — sinaliza a ação de forma intuitiva', () => {
    render(<LogoutButton />);
    const className = screen.getByRole('button', { name: 'Sair' }).className;
    expect(className).toContain('text-red-600');
    expect(className).not.toContain('text-destructive');
  });

  it('mostra falha sem fingir logout quando a rede falha', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<LogoutButton />);
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }));
    await screen.findByRole('alert');
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sair' })).toBeEnabled();
  });
});

it('sai somente depois da confirmação server-side', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  render(<LogoutButton />);
  await userEvent.click(screen.getByRole('button', { name: 'Sair' }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/entrar'));
});
it('não anuncia logout quando backend falha', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
  render(<LogoutButton />);
  await userEvent.click(screen.getByRole('button', { name: 'Sair' }));
  await screen.findByRole('alert');
  expect(replace).not.toHaveBeenCalled();
});
