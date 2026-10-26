import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const route = vi.hoisted(() => ({ pathname: '/dashboard/analytics' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
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
  'control_center.system.operate',
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
      <DashboardShell
        role="FINANCE"
        capabilities={['control_center.finance.read']}
        name="Ana Souza"
        avatarUrl={null}
      >
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

  it('limpa um fragmento residual ao reabrir o setor atual', async () => {
    window.history.replaceState(null, '', '/dashboard/financeiro#custos#custos');
    render(
      <DashboardShell
        role="FINANCE"
        capabilities={['control_center.finance.read']}
        name="Ana Souza"
        avatarUrl={null}
      >
        <p>Conteúdo</p>
      </DashboardShell>,
    );
    for (const toggle of screen.getAllByRole('button', { name: 'Financeiro' })) {
      await userEvent.click(toggle);
    }

    const [financeLink] = screen.getAllByRole('link', { name: 'Receita & Assinaturas' });
    if (!financeLink) throw new Error('link de Receita & Assinaturas não encontrado');
    await userEvent.click(financeLink);

    expect(window.location.pathname + window.location.hash).toBe('/dashboard/financeiro');
  });

  it('admin recebe todos os setores autorizados, incluindo alertas', () => {
    expect(navigationFor(ADMIN_CAPABILITIES).map((item) => item.label)).toEqual(
      expect.arrayContaining(['Visão Geral', 'Base de Alunos', 'Alertas', 'Administração']),
    );
  });

  it('esconde Compliance & Privacidade quando falta uma das capabilities exigidas (AND, como no backend)', () => {
    const items = navigationFor(
      ADMIN_CAPABILITIES.filter((capability) => capability !== 'control_center.audit.read'),
    );
    expect(items.map((item) => item.label)).not.toContain('Compliance & Privacidade');
  });

  it('agrupa o menu e omite grupos cujos itens foram todos filtrados pelo RBAC', () => {
    const admin = navigationGroupsFor(ADMIN_CAPABILITIES);
    // Ordem das categorias (a pedido do fundador, 2026-08-20): Visão Geral (null) →
    // Alunos → IA → Marketing → Financeiro → Sistema.
    expect(admin.map((group) => group.label)).toEqual([
      null,
      'Alunos',
      'IA',
      'Marketing',
      'Financeiro',
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

  it('coloca Notificações logo abaixo de Visão Geral, só com leitura de saúde', () => {
    const principal = navigationGroupsFor(ADMIN_CAPABILITIES)[0];
    expect(principal?.label).toBeNull();
    expect(principal?.items.map((item) => item.label)).toEqual(['Visão Geral', 'Notificações']);
    expect(principal?.items[1]).toMatchObject({
      href: '/dashboard/notificacoes',
      badge: 'notifications',
    });
    // Mesmas capabilities do sino: leitura de alunos E de saúde.
    expect(navigationFor(['control_center.students.read']).map((item) => item.label)).not.toContain(
      'Notificações',
    );
  });

  it('coloca Conversas, Fila e Alertas na área de alunos, só com leitura de saúde', () => {
    const alunos = navigationGroupsFor(ADMIN_CAPABILITIES).find(
      (group) => group.label === 'Alunos',
    );
    expect(alunos?.items.map((item) => item.label)).toEqual([
      'Base de Alunos',
      'Conversas',
      'Fila do Profissional',
      'Alertas',
    ]);
    // Suporte lê a base de alunos, mas não o conteúdo das conversas (dado de saúde).
    expect(navigationFor(['control_center.students.read']).map((item) => item.label)).not.toContain(
      'Conversas',
    );
    expect(navigationFor(['control_center.students.read']).map((item) => item.label)).not.toContain(
      'Alertas',
    );
  });

  describe('altura da tela', () => {
    afterEach(() => {
      route.pathname = '/dashboard/analytics';
    });

    // Sem leitura de saúde não há provider de notificações (que abre um EventSource).
    const shell = () =>
      render(
        <DashboardShell
          role="FINANCE"
          capabilities={['control_center.finance.read']}
          name="Ana Souza"
          avatarUrl={null}
        >
          <p>Conteúdo</p>
        </DashboardShell>,
      );

    it('Conversas ocupa exatamente a janela: sem rolagem da página, só a do chat', () => {
      route.pathname = '/dashboard/conversas';
      const { container } = shell();
      expect(container.firstElementChild).toHaveClass('h-dvh', 'overflow-hidden');
      expect(container.firstElementChild).not.toHaveClass('min-h-dvh');
      expect(document.getElementById('conteudo-dashboard')).toHaveClass('min-h-0', 'flex-col');
    });

    it('as demais telas seguem rolando normalmente', () => {
      const { container } = shell();
      expect(container.firstElementChild).toHaveClass('min-h-dvh');
      expect(container.firstElementChild).not.toHaveClass('h-dvh');
    });
  });

  it('marca o setor atual com aria-current e mostra o título no cabeçalho', () => {
    render(
      <DashboardShell
        role="MARKETING"
        capabilities={['control_center.marketing.read']}
        name="Ana Souza"
        avatarUrl={null}
      >
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
      <DashboardShell
        role="MARKETING"
        capabilities={['control_center.marketing.read']}
        name="Ana Souza"
        avatarUrl={null}
      >
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
      <DashboardShell
        role="MARKETING"
        capabilities={['control_center.marketing.read']}
        name="Ana Souza"
        avatarUrl={null}
      >
        <p>Conteúdo</p>
      </DashboardShell>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Recolher menu lateral' }));
    expect(window.localStorage.getItem('movivo.sidebar.collapsed')).toBe('1');
    await userEvent.click(screen.getByRole('button', { name: 'Expandir menu lateral' }));
    expect(window.localStorage.getItem('movivo.sidebar.collapsed')).toBe('0');
  });
});
