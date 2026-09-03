import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));

import { LogoutButton } from './logout-button';

describe('LogoutButton', () => {
  it('usa vermelho literal (não o coral da marca) — sinaliza a ação de forma intuitiva', () => {
    render(<LogoutButton />);
    const className = screen.getByRole('button', { name: 'Sair' }).className;
    expect(className).toContain('text-red-600');
    expect(className).not.toContain('text-destructive');
  });

  it('sai da superfície sensível mesmo se a rede falhar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<LogoutButton />);
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/entrar'));
    expect(refresh).toHaveBeenCalled();
  });
});
