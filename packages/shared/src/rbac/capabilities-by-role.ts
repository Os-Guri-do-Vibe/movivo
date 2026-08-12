import {
  ControlCenterCapability,
  ControlCenterRole,
  type ControlCenterCapability as Capability,
  type ControlCenterRole as Role,
} from '../enums/control-center';

const ALL_CAPABILITIES: readonly Capability[] = Object.values(ControlCenterCapability);

/**
 * Fonte única do RBAC do Control Center — consumida por `apps/api` (autorização real)
 * e por `apps/web` (o que a UI exibe). Duplicar este mapa faz frontend e backend
 * divergirem em silêncio, por isso ele vive aqui.
 *
 * Semântica de checagem: quando uma rota exige várias capacidades, TODAS são
 * exigidas (AND), tanto no backend quanto no frontend.
 */
export const CAPABILITIES_BY_ROLE: Readonly<Record<Role, readonly Capability[]>> = {
  [ControlCenterRole.USER]: [],
  [ControlCenterRole.ADMIN]: ALL_CAPABILITIES,
  [ControlCenterRole.PROFESSIONAL]: [ControlCenterCapability.STUDENTS_READ],
  [ControlCenterRole.MARKETING]: [ControlCenterCapability.MARKETING_READ],
  [ControlCenterRole.FINANCE]: [ControlCenterCapability.FINANCE_READ],
  [ControlCenterRole.SUPPORT]: [ControlCenterCapability.SUPPORT_READ],
  [ControlCenterRole.ENGINEERING]: [ControlCenterCapability.SYSTEM_READ],
  [ControlCenterRole.DPO]: [
    ControlCenterCapability.COMPLIANCE_READ,
    ControlCenterCapability.AUDIT_READ,
  ],
};
