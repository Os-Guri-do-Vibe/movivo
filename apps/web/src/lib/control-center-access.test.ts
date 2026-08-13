import { describe, expect, it } from 'vitest';

import {
  DASHBOARD_ROLES,
  defaultCapabilitiesForRole,
  defaultDashboardPath,
  isDashboardRole,
  landingPathForRole,
} from './control-center-access';

describe('controle de acesso do Control Center', () => {
  it('mantém USER fora do dashboard interno', () => {
    expect(isDashboardRole('USER')).toBe(false);
    expect(isDashboardRole('PROFESSIONAL')).toBe(true);
  });

  it('não concede overview executivo como fallback para papéis setoriais', () => {
    expect(defaultCapabilitiesForRole('MARKETING')).toEqual([
      'control_center.marketing.read',
      'control_center.marketing.write',
    ]);
    expect(defaultCapabilitiesForRole('PROFESSIONAL')).not.toContain(
      'control_center.overview.read',
    );
  });

  it('leva cada papel ao primeiro setor autorizado', () => {
    expect(defaultDashboardPath(['control_center.finance.read'])).toBe('/dashboard/financeiro');
    expect(defaultDashboardPath(['control_center.students.read'])).toBe('/dashboard/alunos');
    expect(defaultDashboardPath([])).toBeNull();
  });

  /** TASK-7.9.1 — rota padrão por papel no login (US-7.1, TASK-7.1.5). */
  it('cai na rota padrão do papel usando as capabilities reais daquele papel', () => {
    const landing = Object.fromEntries(
      DASHBOARD_ROLES.map((role) => [
        role,
        landingPathForRole(role, defaultCapabilitiesForRole(role)),
      ]),
    );
    expect(landing).toEqual({
      ADMIN: '/dashboard',
      PROFESSIONAL: '/dashboard/educacao-fisica',
      FINANCE: '/dashboard/financeiro',
      MARKETING: '/dashboard/analytics',
      ENGINEERING: '/dashboard/sistema',
      SUPPORT: '/dashboard/alunos',
      DPO: '/dashboard/compliance',
    });
  });

  it('não leva a rota padrão a um destino que o ator não pode abrir', () => {
    // PROFESSIONAL sem STUDENTS_HEALTH_READ não cai na Fila do Profissional.
    expect(landingPathForRole('PROFESSIONAL', ['control_center.students.read'])).toBe(
      '/dashboard/alunos',
    );
    // Sem nenhuma capability não há setor: a Visão Geral é o último recurso, e o
    // gate real continua no backend.
    expect(landingPathForRole('FINANCE', [])).toBe('/dashboard');
  });
});
