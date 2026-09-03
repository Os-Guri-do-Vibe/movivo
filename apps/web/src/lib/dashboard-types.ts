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
   * backend, dentro da própria assinatura); `EDIT` = um CREF editou o conteúdo e precisa
   * de sign-off fresco; `AI_SUBSTITUTION` = troca de exercício confirmada pelo aluno via
   * WhatsApp, aguardando revisão/liberação automática. `null` nos demais itens `optional`.
   */
  origin: 'PARQ' | 'EDIT' | 'AI_SUBSTITUTION' | null;
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

export interface ReplayMessage {
  role: 'USER' | 'ASSISTANT' | 'PROFESSIONAL' | 'SYSTEM';
  content: string;
  createdAt: string;
}

export interface AnonymizedReplay {
  conversationId: string;
  startedAt: string;
  messages: ReplayMessage[];
}

export interface ProtocolDetail {
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
}

/** Detalhe de uma proposta de substituição de exercício via IA (achado 2026-09-02). */
export interface SubstitutionDetail {
  id: string;
  protocolId: string;
  from: { id: string; name: string };
  to: { id: string; name: string };
  diff: {
    type: 'EXERCISE_SUBSTITUTION';
    from: { id: string; name: string };
    to: { id: string; name: string };
    sessionsAffected: string[];
  };
  changeReason: string;
  status: 'PENDING' | 'RELEASED' | 'DISCARDED';
  decidedAt: string | null;
}

export interface QueueDetail {
  item: QueueItem;
  context: Record<string, string | number | boolean | null>;
  protocol?: ProtocolDetail;
  replay?: AnonymizedReplay;
  handoff?: { reason: string; level: string; status: string };
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
  validation?: { valid?: boolean; issues?: unknown[] };
}
