import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard/notificacoes' }));
vi.mock('./logout-button', () => ({ LogoutButton: () => <button>Sair</button> }));

const api = vi.hoisted(() => ({
  getNotifications: vi.fn(),
  getNotificationsSummary: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));
vi.mock('@/lib/dashboard-api', () => api);

class MockEventSource {
  constructor(readonly url: string) {}

  addEventListener = vi.fn();
  close = vi.fn();
}

import { DashboardShell } from './dashboard-shell';

const COLLAPSE_KEY = 'movivo.sidebar.collapsed';

const CAPABILITIES = [
  'control_center.overview.read',
  'control_center.students.read',
  'control_center.students.health.read',
] as const;

function renderShell() {
  return render(
    <DashboardShell role="ADMIN" capabilities={CAPABILITIES} name="Ana" avatarUrl={null}>
      <p>Conteúdo</p>
    </DashboardShell>,
  );
}

describe('DashboardShell · item Notificações', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource);
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.values(api).forEach((mock) => mock.mockReset());
  });

  it('mostra a contagem de não lidas no rótulo acessível e como pílula neutra', async () => {
    api.getNotificationsSummary.mockResolvedValue({ unread: 3, openSafety: 0 });
    renderShell();

    const [link] = await screen.findAllByRole('link', { name: 'Notificações, 3 não lidas' });
    expect(link).toHaveAttribute('href', '/dashboard/notificacoes');
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(within(link as HTMLElement).getByText('3')).toBeInTheDocument();
  });

  it('sem não lidas o rótulo é só "Notificações" e não há pílula', async () => {
    api.getNotificationsSummary.mockResolvedValue({ unread: 0, openSafety: 0 });
    renderShell();

    const [link] = await screen.findAllByRole('link', { name: 'Notificações' });
    expect(within(link as HTMLElement).queryByText('0')).not.toBeInTheDocument();
  });

  it('limita a pílula a 99+', async () => {
    api.getNotificationsSummary.mockResolvedValue({ unread: 120, openSafety: 0 });
    renderShell();
    const [link] = await screen.findAllByRole('link', { name: 'Notificações, 120 não lidas' });
    expect(within(link as HTMLElement).getByText('99+')).toBeInTheDocument();
  });

  it('com o menu recolhido, o ícone ganha o ponto e o tooltip traz a contagem', async () => {
    localStorage.setItem(COLLAPSE_KEY, '1');
    api.getNotificationsSummary.mockResolvedValue({ unread: 2, openSafety: 0 });
    renderShell();

    const [link] = await screen.findAllByRole('link', { name: 'Notificações, 2 não lidas' });
    expect(link).toHaveAttribute('title', 'Notificações · 2 não lidas');
    expect(within(link as HTMLElement).queryByText('2')).not.toBeInTheDocument();
  });
});
