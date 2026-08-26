import type { ProtocolStructure } from '@movivo/shared';

import type {
  AnamnesisAnswers,
  AnonymizedReplay,
  OperationsResponse,
  QueueDetail,
  QueueItem,
  QueueResponse,
} from '@/lib/dashboard-types';

export const PROTOCOL_ID = '11111111-1111-4111-8111-111111111111';
export const HANDOFF_ID = '22222222-2222-4222-8222-222222222222';
/** Protocolo `MANDATORY` cuja sessão de origem está com PAR-Q bloqueado. */
export const PARQ_PROTOCOL_ID = '33333333-3333-4333-8333-333333333333';
export const CHECKIN_ID = '44444444-4444-4444-8444-444444444444';
/** Protocolo `MANDATORY` que um CREF editou à mão e precisa de sign-off fresco. */
export const EDIT_PROTOCOL_ID = '55555555-5555-4555-8555-555555555555';

export const anamnesisAnswers: AnamnesisAnswers = {
  userId: 'user-1',
  submittedAt: '2026-08-01T13:00:00.000Z',
  personal: {
    name: 'Rodrigo de Barros',
    birthDate: '1990-01-01',
    biologicalSex: 'MALE',
    heightCm: 178,
    weightKg: 80,
    phoneNumber: '+5511999999999',
    email: 'rodrigo@example.invalid',
  },
  routine: {
    primaryGoal: 'GAIN_MUSCLE',
    emphasis: ['CHEST', 'BACK'],
    hasImportantEvent: false,
    trainingStatus: 'NEVER',
    experience: 'BEGINNER',
    pastActivities: ['NONE'],
    consistencyBarriers: ['LACK_OF_TIME'],
    daysPerWeek: 3,
    preferredDays: ['MON', 'WED', 'FRI'],
    sessionDuration: 'M45_TO_60',
    location: 'HOME',
    preferredPeriod: 'MORNING',
    practicesOtherSport: false,
    hasAvoidedExercise: false,
  },
  health: {
    parq: {
      version: 'parq-2026-07-v1',
      answers: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'].map((questionId) => ({
        questionId,
        answer: false,
      })),
    },
    pain: {
      hasPain: true,
      points: [{ region: 'KNEE', intensity: 4 }],
      hasProfessionalExplanation: false,
      underMedicalFollowUp: false,
      hasAvoidanceRecommendation: false,
    },
    declarations: {
      version: 'v1',
      accepted: ['TRUTHFUL', 'WILL_REPORT_CHANGES'],
      acceptedAt: '2026-08-01T12:59:00.000Z',
    },
  },
};

export const protocolContent: ProtocolStructure = {
  promptVersion: 'methodology-2026-07',
  goal: 'GAIN_MUSCLE',
  phase: 'HIPERTROFIA',
  weeklyFrequency: 3,
  sessions: [
    {
      dayLabel: 'Treino A',
      focus: 'Membros inferiores',
      exercises: [
        {
          exerciseId: 'goblet_squat',
          name: 'Agachamento goblet',
          sets: 3,
          reps: { min: 8, max: 10 },
          loadStrategy: 'DOUBLE_PROGRESSION',
          restSeconds: 90,
          rir: 2,
          videoUrl: 'https://example.com/goblet-squat',
          notes: 'Movimento controlado.',
        },
      ],
    },
  ],
  generalNotes: 'Manter retorno semanal com o profissional responsável.',
};

export const protocolItem: QueueItem = {
  id: PROTOCOL_ID,
  kind: 'PROTOCOL',
  severity: 'ROUTINE',
  createdAt: '2026-08-03T12:00:00.000Z',
  ageMinutes: 10,
  title: 'Protocolo para Revisão: Maria Teste',
  summary: 'Hipertrofia · 3x por semana',
  status: 'PENDING_REVIEW',
  autoReleaseAt: null,
  origin: null,
};

/** Protocolo "Disponível para Revisão" — libera sozinho se o CREF não agir a tempo. */
export const optionalProtocolItem: QueueItem = {
  id: '66666666-6666-4666-8666-666666666666',
  kind: 'PROTOCOL',
  severity: 'ROUTINE',
  createdAt: '2026-08-03T11:30:00.000Z',
  ageMinutes: 40,
  title: 'Protocolo para Revisão: Bruno Teste',
  summary: 'Condicionamento · 4x por semana',
  status: 'PENDING_REVIEW',
  autoReleaseAt: '2026-08-03T12:30:00.000Z',
  origin: null,
};

export const handoffItem: QueueItem = {
  id: HANDOFF_ID,
  kind: 'HANDOFF',
  severity: 'SAFETY',
  createdAt: '2026-08-03T10:00:00.000Z',
  ageMinutes: 130,
  title: 'Relato exige atenção profissional',
  summary: 'Conteúdo já anonimizado.',
  status: 'OPEN',
  autoReleaseAt: null,
  origin: null,
};

/**
 * PAR-Q bloqueante depois de 2026-08-24: NÃO é mais `kind: 'PARQ'` apontando pra uma
 * sessão sem protocolo — é um protocolo normal, gerado em modo conservador, marcado
 * `MANDATORY`/`SAFETY` com `origin: 'PARQ'`. Título idêntico ao de um protocolo
 * opcional de propósito: o que distingue é a severidade e a legenda de origem.
 */
export const parqProtocolItem: QueueItem = {
  id: PARQ_PROTOCOL_ID,
  kind: 'PROTOCOL',
  severity: 'SAFETY',
  createdAt: '2026-08-03T11:00:00.000Z',
  ageMinutes: 70,
  title: 'Protocolo para Revisão: Carla Teste',
  summary: 'PENDING_REVIEW',
  status: 'PENDING_REVIEW',
  autoReleaseAt: null,
  origin: 'PARQ',
};

/** A outra origem de `MANDATORY`: edição manual do CREF, sem alerta clínico. */
export const editProtocolItem: QueueItem = {
  id: EDIT_PROTOCOL_ID,
  kind: 'PROTOCOL',
  severity: 'ALERT',
  createdAt: '2026-08-03T11:15:00.000Z',
  ageMinutes: 55,
  title: 'Protocolo para Revisão: Diego Teste',
  summary: 'Editado pelo profissional · aguarda assinatura',
  status: 'PENDING_REVIEW',
  autoReleaseAt: null,
  origin: 'EDIT',
};

export const checkinItem: QueueItem = {
  id: CHECKIN_ID,
  kind: 'CHECKIN',
  severity: 'SAFETY',
  createdAt: '2026-08-03T09:00:00.000Z',
  ageMinutes: 190,
  title: 'Check-in exige revisão profissional',
  summary: 'Sinalização de segurança registrada no check-in.',
  status: 'OPEN',
  autoReleaseAt: null,
  origin: null,
};

// Todo item das duas caixas é protocolo. `mandatory` cobre as duas origens (PAR-Q e
// edição manual) e nunca libera sozinho; `optional` é o resto — só quem carrega
// `autoReleaseAt` (optionalProtocolItem) de fato libera sozinho.
export const queueResponse: QueueResponse = {
  mandatory: [parqProtocolItem, editProtocolItem],
  optional: [optionalProtocolItem, protocolItem],
  counts: { mandatory: 2, optional: 2, total: 4 },
};

export const anonymizedReplay: AnonymizedReplay = {
  conversationId: 'anonymous-conversation',
  startedAt: '2026-08-03T11:30:00.000Z',
  messages: [
    {
      role: 'USER',
      content: '[PESSOA] relatou dificuldade.',
      createdAt: '2026-08-03T11:31:00.000Z',
    },
    {
      role: 'ASSISTANT',
      content: 'Retorno acolhido e encaminhado.',
      createdAt: '2026-08-03T11:31:10.000Z',
    },
  ],
};

export const protocolDetail: QueueDetail = {
  item: protocolItem,
  // Achado 2026-08-19: protocolo não manda mais "Contexto autorizado" (version/
  // humanReviewRequired não ajudavam o RT) — `QueueDetail` nem renderiza a seção.
  context: {},
  protocol: {
    id: PROTOCOL_ID,
    version: 1,
    status: 'DRAFT',
    approvalStatus: 'PENDING_REVIEW',
    content: protocolContent,
    signedAt: null,
    signatureHash: null,
    totalWeeks: 8,
    createdAt: '2026-08-03T12:00:00.000Z',
  },
  replay: anonymizedReplay,
};

export const operationsResponse: OperationsResponse = {
  funnel: { formStarted: 100, protocolSent: 80, firstWorkout: 48, converted: 22 },
  sla: {
    protocolDeliveryMinutes: 132,
    coachP95Seconds: 24,
    protocolBreached: true,
    coachBreached: false,
  },
  replays: [anonymizedReplay],
};
