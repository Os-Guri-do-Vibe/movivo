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

  /**
   * Dado de saúde do aluno (anamnese, PAR-Q, relato de dor, respostas de check-in
   * decifradas). Separada de `STUDENTS_READ` de propósito: ver *que* o aluno existe e
   * qual a situação comercial dele não é a mesma autorização de ver o dado de saúde
   * dele — que é dado sensível (LGPD, Art. 11). Suporte lê a base de alunos; suporte
   * não lê saúde. Sempre exigida em conjunto com `STUDENTS_READ` (semântica AND).
   */
  STUDENTS_HEALTH_READ: 'control_center.students.health.read',

  FINANCE_WRITE: 'control_center.finance.write',

  /**
   * Cap table e distribuição por sócio (US-8.7). **Fora de `FINANCE_*` de propósito**:
   * quem opera o livro-caixa não precisa ver quanto cabe a cada sócio. Concedidas só a
   * `ADMIN` (ver `CAPABILITIES_BY_ROLE`).
   */
  PARTNERS_READ: 'control_center.partners.read',
  PARTNERS_WRITE: 'control_center.partners.write',

  MARKETING_WRITE: 'control_center.marketing.write',
  SYSTEM_OPERATE: 'control_center.system.operate',
  /** Ver o pilar IA, incluindo as regras invioláveis L0 (somente leitura) — US-7.6/7.7. */
  AI_CONFIG_READ: 'control_center.ai.config.read',
  /** Publicar configuração L2 (persona/tom/nome) e fazer rollback — US-7.6/7.7. */
  AI_CONFIG_WRITE: 'control_center.ai.config.write',

  // Reservadas: registradas agora para que o RBAC nasça completo, sem uso ativo em
  // nenhuma rota até as Sprints 8/10/11.
  AI_KNOWLEDGE_WRITE: 'control_center.ai.knowledge.write',
  AI_KNOWLEDGE_APPROVE: 'control_center.ai.knowledge.approve',
  AI_METHODOLOGY_APPROVE: 'control_center.ai.methodology.approve',

  /**
   * Aprovar/retirar **tema proibido** e alterar a **mensagem de handoff humano**.
   *
   * As duas coisas são a mesma classe de decisão: o que a agente se recusa a discutir e o
   * que o aluno lê quando o sistema desiste de responder. Concedida ao `PROFESSIONAL`
   * com CREF ativo e ao `ADMIN`, que recebe todas as capacidades do Control Center.
   */
  AI_GUARDRAIL_APPROVE: 'control_center.ai.guardrail.approve',
} as const;

export type ControlCenterCapability =
  (typeof ControlCenterCapability)[keyof typeof ControlCenterCapability];
