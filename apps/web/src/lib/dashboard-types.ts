import type { ProtocolStructure } from '@movivo/shared';

export type { DashboardCapability, DashboardRole } from './control-center-access';
/**
 * `PARQ` saiu do enum em 2026-08-24 (espelha `kindSchema` do backend): PAR-Q bloqueante
 * não é mais um item de fila próprio — o protocolo é sempre gerado e o PAR-Q vive dentro
 * dele como `QueueItem.origin === 'PARQ'`. `SUBSTITUTION` entrou em 2026-09-02: proposta
 * de substituição de exercício via IA. Desde 2026-09-03 tem a mesma divisão
 * obrigatória/opcional do protocolo (ver `QueueResponse` abaixo), em vez de cair sempre
 * em "Revisão Humana Opcional".
 */
export type QueueKind = 'PROTOCOL' | 'HANDOFF' | 'CHECKIN' | 'SUBSTITUTION';
export type QueueSeverity = 'SAFETY' | 'ALERT' | 'ROUTINE';

export interface QueueItem {
  id: string;
  kind: QueueKind;
  severity: QueueSeverity;
  createdAt: string;
  ageMinutes: number;
  title: string;
  summary: string;
  status: string;
  /** Só itens "Revisão Humana Opcional" — quando a liberação automática ocorre. */
  autoReleaseAt: string | null;
  /**
   * POR QUE este item exige revisão humana. `PARQ` = a sessão de origem está bloqueada
   * aguardando liberação (alerta clínico — assinar o protocolo também libera o PAR-Q, no
   * backend, dentro da própria assinatura); `FALLBACK` (2026-09-03) = o protocolo caiu no
   * template conservador do RT porque a geração/validação nunca passou limpa, mesmo com
   * PAR-Q liberado; `EDIT` = um CREF editou o conteúdo e precisa de sign-off fresco;
   * `AI_SUBSTITUTION` = troca de exercício confirmada pelo aluno via WhatsApp, aguardando
   * revisão/liberação automática. `CATALOG_GAP` (2026-09-09) = o aluno pediu um exercício
   * que não existe em nenhum lugar do catálogo — mandatory, com a opção de adicionar ao
   * catálogo na tela de detalhe (`substitution.catalogGap`). `null` nos demais itens `optional`.
   */
  origin: 'PARQ' | 'FALLBACK' | 'EDIT' | 'QUALITY' | 'AI_SUBSTITUTION' | 'CATALOG_GAP' | null;
  isFallback?: boolean;
  /** Protocolo que pode ser refeito a partir da anamnese ("Gerar protocolo novamente"). */
  canRegenerate?: boolean;
  /** O conteúdo vigente é edição do profissional — regerar a descarta (pede confirmação). */
  editedByProfessional?: boolean;
  /**
   * Último pedido de regeração: `RUNNING` (gerando), `NOT_APPLIED` (a nova geração não trocou
   * o conteúdo) ou `FAILED` (esgotou as tentativas). Ausente quando não há o que dizer.
   */
  regeneration?: 'RUNNING' | 'NOT_APPLIED' | 'FAILED';
  /** O profissional logado já abriu este item. Ler não tira o item da fila. */
  read: boolean;
}

/**
 * Fila do profissional — protocolo (`mandatory`/`optional`) e substituição de exercício
 * via IA (`substitutionMandatory`/`substitutionOptional`, achado 2026-09-03). Os dois
 * pares seguem a MESMA regra: o `mandatory`/`substitutionMandatory` nunca libera
 * sozinho; o `optional`/`substitutionOptional` libera sozinho após `autoReleaseAt` se o
 * CREF não agir. Cada array já vem ordenado por idade (mais antigo primeiro).
 */
export interface QueueResponse {
  mandatory: QueueItem[];
  optional: QueueItem[];
  substitutionMandatory: QueueItem[];
  substitutionOptional: QueueItem[];
  counts: {
    mandatory: number;
    optional: number;
    substitutionMandatory: number;
    substitutionOptional: number;
    total: number;
  };
}

export interface DashboardAlert {
  id: string;
  studentName: string | null;
  level: 'SAFETY' | 'ALERT';
  reason: string;
  sourceType: string | null;
  status: 'OPEN' | 'RESOLVED';
  createdAt: string;
  updatedAt: string;
  /** O profissional logado já abriu este alerta. Ler não resolve. */
  read: boolean;
}

export interface AlertsResponse {
  open: DashboardAlert[];
  resolved: DashboardAlert[];
}

export interface AlertsSummary {
  open: number;
}

export interface ReplayMessage {
  role: 'USER' | 'ASSISTANT' | 'PROFESSIONAL' | 'SYSTEM';
  content: string;
  createdAt: string;
}

export interface AnonymizedReplay {
  conversationId: string;
  startedAt: string;
  /** Nome real do titular da conversa — `null` quando não resolvido. */
  studentName: string | null;
  messages: ReplayMessage[];
}

export interface ProtocolDetail {
  isFallback?: boolean;
  id: string;
  version: number;
  status: string;
  approvalStatus: string;
  content: ProtocolStructure;
  signedAt: string | null;
  signatureHash: string | null;
  totalWeeks: number;
  createdAt: string;
  validation?: { valid: boolean; issues: string[] };
  /** Situação de revisão calculada no servidor (ausente em respostas antigas). */
  review?: ProtocolReview;
}

/** Divergência apontada pelo validador; `key` é o que o profissional reconhece ao assinar. */
export interface ProtocolConflict {
  key: string;
  rule: string;
  detail: string;
}

/**
 * Situação de revisão do conteúdo atual (achado 2026-10-15). `blocking` impede assinar ou
 * publicar; `conflicts` (só na prescrição do profissional) são divergências das regras
 * automáticas que ele reconhece como decisão própria.
 */
export interface ProtocolReview {
  origin: 'AI' | 'PROFESSIONAL';
  availability: { daysPerWeek: number | null; preferredDays: string[] };
  blocking: ProtocolConflict[];
  conflicts: ProtocolConflict[];
  qualityNotices?: string[];
}

/** Item do autocomplete de exercício (catálogo oficial publicado). */
export interface ExerciseCatalogOption {
  id: string;
  name: string;
  pattern: string;
  muscleGroups: string[];
  equipment: string[];
  measurement: 'REPS' | 'DURATION';
  /** Contraindicações do catálogo que batem com as restrições deste aluno (informativo). */
  contraindicatedForStudent: string[];
}

/**
 * Uma troca da proposta (achado 2026-09-30, troca em lote): o profissional aprova, edita ou
 * descarta cada item individualmente na tela única da proposta.
 */
export interface SubstitutionItemView {
  index: number;
  from: { id: string; name: string };
  /** `id: null` quando o aluno pediu um exercício que não existe no catálogo. */
  to: { id: string | null; name: string };
  catalogGap: boolean;
  /** Fora da curadoria segura padrão: exige decisão humana. */
  mandatory: boolean;
  decision: 'PENDING' | 'APPROVED' | 'DISCARDED';
  /** Opções SEGURAS para este aluno (recomputadas contra o protocolo vivo) — a troca do
   * item por outra opção é a "edição". Inclui a escolha atual. */
  options: Array<{ id: string; name: string }>;
}

/** Decisão do profissional sobre um item, enviada na aprovação. */
export interface SubstitutionItemEdit {
  index: number;
  action: 'APPROVE' | 'DISCARD';
  toExerciseId?: string;
}

/** Detalhe de uma proposta de substituição de exercício via IA (achado 2026-09-02). */
export interface SubstitutionDetail {
  id: string;
  protocolId: string;
  /** Um item por troca pedida (1 a 3). */
  items: SubstitutionItemView[];
  from: { id: string; name: string };
  /** Achado 2026-09-09: `id: null` quando `catalogGap` — o exercício pedido ainda não tem
   * id nenhum, `name` carrega o texto exatamente como o aluno pediu. */
  to: { id: string | null; name: string };
  diff: {
    type: 'EXERCISE_SUBSTITUTION';
    from: { id: string; name: string };
    to: { id: string; name: string };
    sessionsAffected: string[];
  } | null;
  changeReason: string;
  status: 'PENDING' | 'RELEASED' | 'DISCARDED';
  decidedAt: string | null;
  /** Achado 2026-09-09 — nasce decidido na criação da proposta (não depende de PAR-Q ao vivo). */
  reviewUrgency: 'OPTIONAL' | 'MANDATORY';
  /** `true` só quando o exercício pedido não existe em nenhum lugar do catálogo — liga a
   * opção "Adicionar exercício ao catálogo" na tela. */
  catalogGap: boolean;
}

export interface QueueDetail {
  item: QueueItem;
  context: Record<string, string | number | boolean | null>;
  protocol?: ProtocolDetail;
  replay?: AnonymizedReplay;
  handoff?: {
    reason: string;
    level: string;
    status: string;
    studentId?: string;
    studentName?: string | null;
    sourceType?: string | null;
    sourceId?: string | null;
    createdAt?: string;
    updatedAt?: string;
    trigger?: { content: string; createdAt: string; direction: 'INBOUND' | 'OUTBOUND' } | null;
  };
  substitution?: SubstitutionDetail;
}

/** Todas as respostas que o titular preencheu no formulário de anamnese (US: olho). */
export interface AnamnesisAnswers {
  userId: string;
  submittedAt: string | null;
  personal: {
    name: string;
    birthDate: string;
    biologicalSex: string;
    heightCm: number;
    weightKg: number;
    phoneNumber: string;
    email?: string;
  };
  routine: {
    primaryGoal: string;
    emphasis: string[];
    hasImportantEvent: boolean;
    importantEventDate?: string;
    trainingStatus: string;
    stoppedFor?: string;
    experience: string;
    pastActivities: string[];
    consistencyBarriers: string[];
    daysPerWeek: number;
    preferredDays: string[];
    sessionDuration: string;
    location: string;
    preferredPeriod: string;
    practicesOtherSport: boolean;
    otherSportDaysPerWeek?: number;
    hasAvoidedExercise: boolean;
  };
  health: {
    pain?: {
      hasPain: boolean;
      points: { region: string; intensity: number; regionOther?: string }[];
      trend?: string;
      trigger?: string;
      hasProfessionalExplanation: boolean;
      professionalExplanation?: string;
      underMedicalFollowUp: boolean;
      hasAvoidanceRecommendation: boolean;
      avoidanceRecommendation?: string;
    };
    freeText?: {
      primaryGoalOther?: string;
      importantEventDescription?: string;
      pastActivityOther?: string;
      consistencyBarrierOther?: string;
      otherSportName?: string;
      avoidedExercise?: string;
    };
    parq?: {
      version: string;
      answers: { questionId: string; answer: boolean; detail?: string }[];
    };
    declarations?: { version: string; accepted: string[]; acceptedAt: string };
  };
}

export interface OperationsResponse {
  funnel: {
    formStarted: number;
    protocolSent: number;
    firstWorkout: number | null;
    converted: number;
  };
  sla: {
    protocolDeliveryMinutes: number | null;
    coachP95Seconds: number | null;
    protocolBreached: boolean;
    coachBreached: boolean;
  };
  replays: AnonymizedReplay[];
}

export interface ActionResult {
  message?: string;
  status?: string;
  validation?: string | { valid?: boolean; issues?: unknown[] };
  /** Alertas do `ValidationService` (edição de protocolo): o que corrigir antes de assinar. */
  violations?: Array<{ rule?: string; detail?: string }>;
  /** Divergências da prescrição do profissional, reconhecidas na assinatura. */
  conflicts?: ProtocolConflict[];
}

/** Tipo de notificação do sino; cada um abre a sua própria tela de detalhe. */
export type NotificationType = 'alert' | 'protocol' | 'substitution';

export interface NotificationItem {
  type: NotificationType;
  id: string;
  read: boolean;
  createdAt: string;
  /** Só alertas. A Fila do Profissional não tem nível. */
  level: 'SAFETY' | 'ALERT' | null;
  /** Título pronto vindo da fila (protocolo/substituição/treino); alertas usam `reason`. */
  title: string | null;
  studentName: string | null;
  reason: string | null;
  sourceType: string | null;
  section: 'MANDATORY' | 'OPTIONAL' | null;
  origin: QueueItem['origin'];
  autoReleaseAt: string | null;
}

export interface NotificationsResponse {
  /** Hora do servidor em que o retrato foi tirado; é o corte de "marcar todas como lidas". */
  snapshotAt: string;
  items: NotificationItem[];
  totalPending: number;
  unread: number;
  openSafety: number;
}

export interface NotificationsSummary {
  unread: number;
  openSafety: number;
}

export type NotificationOutcome =
  'RESOLVED' | 'SIGNED' | 'AUTO_RELEASED' | 'RELEASED' | 'DISCARDED';

/** Item do registro de notificações: pendente ou já decidido (decidido nunca é "não lido"). */
export interface NotificationHistoryItem extends NotificationItem {
  status: 'PENDING' | 'SETTLED';
  outcome: NotificationOutcome | null;
  settledAt: string | null;
}

export interface NotificationHistoryResponse {
  snapshotAt: string;
  items: NotificationHistoryItem[];
  nextCursor: string | null;
  unread: number;
  openSafety: number;
}

export interface NotificationHistoryQuery {
  state: 'all' | 'unread';
  type: 'all' | 'alert' | 'queue';
  cursor?: string | null;
}
