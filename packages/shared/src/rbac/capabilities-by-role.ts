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
  [ControlCenterRole.PROFESSIONAL]: [
    ControlCenterCapability.STUDENTS_READ,
    ControlCenterCapability.STUDENTS_HEALTH_READ,
    // O RT CREF vê como a agente fala (e as regras invioláveis), mas não publica config.
    ControlCenterCapability.AI_CONFIG_READ,
    // O profissional mantém somente as aprovações reguladas; ADMIN recebe todas as capacidades.
    ControlCenterCapability.AI_KNOWLEDGE_APPROVE,
    ControlCenterCapability.AI_METHODOLOGY_APPROVE,
    ControlCenterCapability.AI_GUARDRAIL_APPROVE,
  ],
  [ControlCenterRole.MARKETING]: [
    ControlCenterCapability.MARKETING_READ,
    ControlCenterCapability.MARKETING_WRITE,
  ],
  // `PARTNERS_READ`/`PARTNERS_WRITE` (US-8.7) ficam **fora** daqui de propósito: cap table
  // e distribuição por sócio são de sócio, não do setor financeiro. Só o `ADMIN` os
  // recebe — via `ALL_CAPABILITIES`, sem entrada aqui.
  [ControlCenterRole.FINANCE]: [
    ControlCenterCapability.FINANCE_READ,
    ControlCenterCapability.FINANCE_WRITE,
  ],
  // Suporte lê a base de alunos (identificação e situação comercial) e nada de saúde:
  // não recebe `STUDENTS_HEALTH_READ`.
  [ControlCenterRole.SUPPORT]: [
    ControlCenterCapability.SUPPORT_READ,
    ControlCenterCapability.STUDENTS_READ,
  ],
  [ControlCenterRole.ENGINEERING]: [
    ControlCenterCapability.SYSTEM_READ,
    ControlCenterCapability.SYSTEM_OPERATE,
    ControlCenterCapability.AI_CONFIG_READ,
    ControlCenterCapability.AI_CONFIG_WRITE,
  ],
  [ControlCenterRole.DPO]: [
    ControlCenterCapability.COMPLIANCE_READ,
    ControlCenterCapability.AUDIT_READ,
  ],
};
