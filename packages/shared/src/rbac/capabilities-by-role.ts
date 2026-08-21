import {
  ControlCenterCapability,
  ControlCenterRole,
  type ControlCenterCapability as Capability,
  type ControlCenterRole as Role,
} from '../enums/control-center';

/**
 * Capacidades que `ADMIN` NÃO herda, mesmo recebendo "tudo".
 *
 * Justificativa (US-7.1, TASK-7.1.2 — validar com Alexandre/Sato): administrar o
 * sistema e aprovar conteúdo clínico-metodológico são responsabilidades distintas.
 * Quem aprova metodologia de treino e conhecimento usado pela IA é o Responsável
 * Técnico CREF (papel `PROFESSIONAL`), porque é ele quem responde profissionalmente
 * por esse conteúdo — é exatamente essa separação que sustenta a defensabilidade
 * jurídica do produto. Um admin de sistema que pudesse aprovar sozinho tornaria a
 * supervisão CREF nominal.
 *
 * Estas capacidades ainda não guardam nenhuma rota (chegam nas Sprints 10/11), mas o
 * mecanismo de exceção nasce agora para que o núcleo de RBAC não seja mexido depois
 * sob pressão de escopo.
 */
export const ADMIN_INHERITANCE_DENYLIST: readonly Capability[] = [
  ControlCenterCapability.AI_KNOWLEDGE_APPROVE,
  ControlCenterCapability.AI_METHODOLOGY_APPROVE,
  ControlCenterCapability.AI_GUARDRAIL_APPROVE,
];

const ALL_CAPABILITIES: readonly Capability[] = Object.values(ControlCenterCapability);

const ADMIN_CAPABILITIES: readonly Capability[] = ALL_CAPABILITIES.filter(
  (capability) => !ADMIN_INHERITANCE_DENYLIST.includes(capability),
);

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
  [ControlCenterRole.ADMIN]: ADMIN_CAPABILITIES,
  [ControlCenterRole.PROFESSIONAL]: [
    ControlCenterCapability.STUDENTS_READ,
    ControlCenterCapability.STUDENTS_HEALTH_READ,
    // O RT CREF vê como a agente fala (e as regras invioláveis), mas não publica config.
    ControlCenterCapability.AI_CONFIG_READ,
    // Exclusivas do RT CREF — ver ADMIN_INHERITANCE_DENYLIST.
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
  // recebe — via `ADMIN_CAPABILITIES` (tudo menos a denylist clínica), sem entrada aqui.
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
