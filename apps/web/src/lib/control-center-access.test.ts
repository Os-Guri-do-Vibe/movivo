import { describe, expect, it } from 'vitest';

import {
  defaultCapabilitiesForRole,
  defaultDashboardPath,
  isDashboardRole,
} from './control-center-access';

describe('controle de acesso do Control Center', () => {
  it('mantém USER fora do dashboard interno', () => {
    expect(isDashboardRole('USER')).toBe(false);
    expect(isDashboardRole('PROFESSIONAL')).toBe(true);
  });

  it('não concede overview executivo como fallback para papéis setoriais', () => {
    expect(defaultCapabilitiesForRole('MARKETING')).toEqual(['control_center.marketing.read']);
    expect(defaultCapabilitiesForRole('PROFESSIONAL')).not.toContain(
      'control_center.overview.read',
    );
  });

  it('leva cada papel ao primeiro setor autorizado', () => {
    expect(defaultDashboardPath(['control_center.finance.read'])).toBe('/dashboard/financeiro');
    expect(defaultDashboardPath(['control_center.students.read'])).toBe('/dashboard/alunos');
    expect(defaultDashboardPath([])).toBeNull();
  });
});
