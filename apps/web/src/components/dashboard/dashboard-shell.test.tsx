import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard/analytics' }));
vi.mock('./logout-button', () => ({ LogoutButton: () => <button>Sair</button> }));

import { DashboardShell, navigationFor } from './dashboard-shell';

describe('DashboardShell', () => {
  it('mostra somente os setores autorizados para marketing', () => {
    const items = navigationFor(['control_center.marketing.read']);
    expect(items.map((item) => item.label)).toEqual(['Analytics']);
  });

  it('não renderiza links proibidos para financeiro', () => {
    render(
      <DashboardShell role="FINANCE" capabilities={['control_center.finance.read']}>
        <p>Conteúdo</p>
      </DashboardShell>,
    );
    expect(screen.getAllByRole('link', { name: 'Financeiro' })).not.toHaveLength(0);
    expect(screen.queryByRole('link', { name: 'Alunos' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Analytics' })).not.toBeInTheDocument();
  });

  const ADMIN_CAPABILITIES = [
    'control_center.overview.read',
    'control_center.marketing.read',
    'control_center.students.read',
    'control_center.system.read',
    'control_center.finance.read',
    'control_center.support.read',
    'control_center.compliance.read',
    'control_center.audit.read',
    'control_center.admin.destructive.request',
  ] as const;

  it('admin recebe todos os setores quando possui todas as capabilities necessárias', () => {
    expect(navigationFor(ADMIN_CAPABILITIES)).toHaveLength(9);
  });

  it('esconde Compliance quando falta uma das capabilities exigidas (AND, como no backend)', () => {
    const items = navigationFor(
      ADMIN_CAPABILITIES.filter((capability) => capability !== 'control_center.audit.read'),
    );
    expect(items.map((item) => item.label)).not.toContain('Compliance');
  });
});
