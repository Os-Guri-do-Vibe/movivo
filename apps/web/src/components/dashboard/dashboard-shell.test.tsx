import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard/analytics' }));
vi.mock('./logout-button', () => ({ LogoutButton: () => <button>Sair</button> }));

import { DashboardShell, navigationFor, navigationGroupsFor } from './dashboard-shell';

const ADMIN_CAPABILITIES = [
  'control_center.overview.read',
  'control_center.students.read',
  'control_center.students.health.read',
  'control_center.finance.read',
  'control_center.partners.read',
  'control_center.marketing.read',
  'control_center.ai.config.read',
  'control_center.system.read',
  'control_center.compliance.read',
  'control_center.audit.read',
  'control_center.admin.destructive.request',
] as const;

describe('DashboardShell', () => {
  it('mostra somente os setores autorizados para marketing', () => {
    const items = navigationFor(['control_center.marketing.read']);
    expect(items.map((item) => item.label)).toEqual([
      'Aquisição & Canais',
      'Perfil de Clientes',
      'Campanhas & Experimentos',
    ]);
  });

  it('não renderiza links proibidos para financeiro', async () => {
    render(
      <DashboardShell role="FINANCE" capabilities={['control_center.finance.read']}>
        <p>Conteúdo</p>
      </DashboardShell>,
    );
    // Categoria começa recolhida (a rota atual do mock é de Marketing, não Financeiro).
    for (const toggle of screen.getAllByRole('button', { name: 'Financeiro' })) {
      await userEvent.click(toggle);
    }
    expect(screen.getAllByRole('link', { name: 'Receita & Assinaturas' })).not.toHaveLength(0);
    expect(screen.queryByRole('link', { name: 'Base de Alunos' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Aquisição & Canais' })).not.toBeInTheDocument();
    // US-8.7: cap table é exclusivo do ADMIN — FINANCE não alcança nem o item.
    expect(screen.queryByRole('link', { name: 'Sócios & Distribuição' })).not.toBeInTheDocument();
    // Ausência, não desabilitação (TASK-7.9.1): dentro do menu o rótulo não existe
    // em elemento nenhum — nem link, nem botão inerte, nem texto cinza.
    for (const nav of screen.getAllByRole('navigation')) {
      expect(within(nav).queryByText('Base de Alunos')).not.toBeInTheDocument();
      expect(within(nav).queryByText('Aquisição & Canais')).not.toBeInTheDocument();
      expect(within(nav).queryByText('Sócios & Distribuição')).not.toBeInTheDocument();
      expect(nav.querySelectorAll('[aria-disabled="true"], :disabled')).toHaveLength(0);
    }
  });

  it('admin recebe todos os setores quando possui todas as capabilities necessárias', () => {
    expect(navigationFor(ADMIN_CAPABILITIES)).toHaveLength(18);
  });

  it('esconde Compliance & Privacidade quando falta uma das capabilities exigidas (AND, como no backend)', () => {
    const items = navigationFor(
      ADMIN_CAPABILITIES.filter((capability) => capability !== 'control_center.audit.read'),
    );
    expect(items.map((item) => item.label)).not.toContain('Compliance & Privacidade');
  });

  it('agrupa o menu e omite grupos cujos itens foram todos filtrados pelo RBAC', () => {
    const admin = navigationGroupsFor(ADMIN_CAPABILITIES);
    expect(admin.map((group) => group.label)).toEqual([
      null,
      'Alunos',
      'Financeiro',
      'Marketing',
      'IA',
      'Sistema',
    ]);

    const marketing = navigationGroupsFor(['control_center.marketing.read']);
    expect(marketing).toHaveLength(1);
    expect(marketing[0]?.label).toBe('Marketing');
    expect(marketing[0]?.items.map((item) => item.label)).toEqual([
      'Aquisição & Canais',
      'Perfil de Clientes',
      'Campanhas & Experimentos',
    ]);
  });

  it('marca o setor atual com aria-current e mostra o título no cabeçalho', () => {
    render(
      <DashboardShell role="MARKETING" capabilities={['control_center.marketing.read']}>
        <p>Conteúdo</p>
      </DashboardShell>,
    );
    for (const link of screen.getAllByRole('link', { name: 'Aquisição & Canais' })) {
      expect(link).toHaveAttribute('aria-current', 'page');
    }
    expect(screen.getByRole('banner')).toHaveTextContent('Aquisição & Canais');
  });

  it('abre o menu mobile, fecha com Esc e fecha ao clicar no overlay', async () => {
    render(
      <DashboardShell role="MARKETING" capabilities={['control_center.marketing.read']}>
        <p>Conteúdo</p>
      </DashboardShell>,
    );
    const open = screen.getByRole('button', { name: 'Abrir menu' });

    await userEvent.click(open);
    const drawer = screen.getByRole('dialog', { name: 'Setores do Control Center' });
    expect(within(drawer).getByRole('link', { name: 'Aquisição & Canais' })).toBeVisible();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(open).toHaveFocus();

    await userEvent.click(open);
    const [closeButton] = screen.getAllByRole('button', { name: 'Fechar menu' });
    await userEvent.click(closeButton as HTMLElement);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('recolhe e expande a barra lateral guardando a preferência', async () => {
    render(
      <DashboardShell role="MARKETING" capabilities={['control_center.marketing.read']}>
        <p>Conteúdo</p>
      </DashboardShell>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Recolher menu lateral' }));
    expect(window.localStorage.getItem('movivo.sidebar.collapsed')).toBe('1');
    await userEvent.click(screen.getByRole('button', { name: 'Expandir menu lateral' }));
    expect(window.localStorage.getItem('movivo.sidebar.collapsed')).toBe('0');
  });
});
