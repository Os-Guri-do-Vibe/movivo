/** Papéis persistidos. `PROFESSIONAL` continua sendo o profissional CREF. */
export const ControlCenterRole = {
  USER: 'USER',
  ADMIN: 'ADMIN',
  PROFESSIONAL: 'PROFESSIONAL',
  MARKETING: 'MARKETING',
  FINANCE: 'FINANCE',
  SUPPORT: 'SUPPORT',
  ENGINEERING: 'ENGINEERING',
  DPO: 'DPO',
} as const;

export type ControlCenterRole = (typeof ControlCenterRole)[keyof typeof ControlCenterRole];

/** Capacidades do P0. Endpoints internos negam acesso quando nenhuma é declarada. */
export const ControlCenterCapability = {
  OVERVIEW_READ: 'control_center.overview.read',
  MARKETING_READ: 'control_center.marketing.read',
  STUDENTS_READ: 'control_center.students.read',
  SYSTEM_READ: 'control_center.system.read',
  FINANCE_READ: 'control_center.finance.read',
  SUPPORT_READ: 'control_center.support.read',
  COMPLIANCE_READ: 'control_center.compliance.read',
  AUDIT_READ: 'control_center.audit.read',
  ADMIN_DESTRUCTIVE_REQUEST: 'control_center.admin.destructive.request',
} as const;

export type ControlCenterCapability =
  (typeof ControlCenterCapability)[keyof typeof ControlCenterCapability];
