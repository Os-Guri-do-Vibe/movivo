import {
  CAPABILITIES_BY_ROLE,
  ControlCenterCapability as Capability,
  ControlCenterRole,
  type ControlCenterCapability,
} from '@movivo/shared';

export const DASHBOARD_ROLES = [
  ControlCenterRole.ADMIN,
  ControlCenterRole.PROFESSIONAL,
  ControlCenterRole.MARKETING,
  ControlCenterRole.FINANCE,
  ControlCenterRole.SUPPORT,
  ControlCenterRole.ENGINEERING,
  ControlCenterRole.DPO,
] as const;

export type DashboardRole = (typeof DASHBOARD_ROLES)[number];
export type DashboardCapability = ControlCenterCapability;

export const DASHBOARD_CAPABILITIES = Object.values(Capability);

export const ROLE_LABELS: Record<DashboardRole, string> = {
  ADMIN: 'Fundador',
  PROFESSIONAL: 'Profissional CREF',
  MARKETING: 'Marketing',
  FINANCE: 'Financeiro',
  SUPPORT: 'Suporte',
  ENGINEERING: 'Engenharia · SRE',
  DPO: 'DPO · Auditoria',
};

export function isDashboardRole(value: unknown): value is DashboardRole {
  return typeof value === 'string' && (DASHBOARD_ROLES as readonly string[]).includes(value);
}

export function isDashboardCapability(value: unknown): value is DashboardCapability {
  return typeof value === 'string' && (DASHBOARD_CAPABILITIES as readonly string[]).includes(value);
}

/**
 * Compatibilidade de apresentação enquanto uma API antiga não devolve capabilities.
 * A autorização real continua no backend; este mapa só decide o que a UI exibe.
 */
export function defaultCapabilitiesForRole(role: DashboardRole): readonly DashboardCapability[] {
  return CAPABILITIES_BY_ROLE[role];
}

/**
 * AND explícito: espelha `roleHasCapabilities` do backend, que exige TODAS as
 * capacidades declaradas na rota. Nome verboso de propósito — `can(...)` era
 * ambíguo e escondia um OR que divergia do backend.
 */
export function hasAllCapabilities(
  capabilities: readonly DashboardCapability[],
  ...required: readonly DashboardCapability[]
): boolean {
  return required.every((capability) => capabilities.includes(capability));
}

const LANDING_BY_CAPABILITY: ReadonlyArray<[DashboardCapability, string]> = [
  [Capability.OVERVIEW_READ, '/dashboard'],
  [Capability.MARKETING_READ, '/dashboard/analytics'],
  [Capability.STUDENTS_READ, '/dashboard/alunos'],
  [Capability.SYSTEM_READ, '/dashboard/sistema'],
  [Capability.FINANCE_READ, '/dashboard/financeiro'],
  [Capability.COMPLIANCE_READ, '/dashboard/compliance'],
  [Capability.AUDIT_READ, '/dashboard/compliance'],
];

export function defaultDashboardPath(capabilities: readonly DashboardCapability[]): string | null {
  return (
    LANDING_BY_CAPABILITY.find(([capability]) => capabilities.includes(capability))?.[1] ?? null
  );
}

/**
 * Rota padrão por papel após o login (US-7.1, TASK-7.1.5): cada pessoa cai no que ela
 * abre todo dia, não a três cliques dali. A capability continua mandando — um papel
 * que, por qualquer motivo, não tiver a capability do destino cai no fallback por
 * capability e, em último caso, na Visão Geral.
 */
const LANDING_BY_ROLE: Partial<
  Record<DashboardRole, { path: string; requires: readonly DashboardCapability[] }>
> = {
  PROFESSIONAL: {
    path: '/dashboard/educacao-fisica',
    requires: [Capability.STUDENTS_READ, Capability.STUDENTS_HEALTH_READ],
  },
  FINANCE: { path: '/dashboard/financeiro', requires: [Capability.FINANCE_READ] },
  MARKETING: { path: '/dashboard/analytics', requires: [Capability.MARKETING_READ] },
  ENGINEERING: { path: '/dashboard/sistema', requires: [Capability.SYSTEM_READ] },
  ADMIN: { path: '/dashboard', requires: [Capability.OVERVIEW_READ] },
};

export function landingPathForRole(
  role: DashboardRole,
  capabilities: readonly DashboardCapability[],
): string {
  const mapped = LANDING_BY_ROLE[role];
  if (mapped && hasAllCapabilities(capabilities, ...mapped.requires)) return mapped.path;
  return defaultDashboardPath(capabilities) ?? '/dashboard';
}
