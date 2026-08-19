import type { ProtocolStructure } from '@movivo/shared';

export type { DashboardCapability, DashboardRole } from './control-center-access';
export type QueueKind = 'PROTOCOL' | 'HANDOFF' | 'PARQ' | 'CHECKIN';
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
  /** Só protocolos "Revisão Humana Opcional" — quando a liberação automática ocorre. */
  autoReleaseAt: string | null;
}

/**
 * Fila do profissional — só protocolo + PAR-Q (US: duas categorias de revisão).
 * `mandatory` nunca libera sozinho; `optional` libera sozinho após `autoReleaseAt` se
 * o CREF não agir. Cada array já vem ordenado por idade (mais antigo primeiro).
 */
export interface QueueResponse {
  mandatory: QueueItem[];
  optional: QueueItem[];
  counts: { mandatory: number; optional: number; total: number };
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

export interface QueueDetail {
  item: QueueItem;
  context: Record<string, string | number | boolean | null>;
  protocol?: ProtocolDetail;
  replay?: AnonymizedReplay;
  parq?: { flags: string[]; state: string };
  handoff?: { reason: string; level: string; status: string };
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
