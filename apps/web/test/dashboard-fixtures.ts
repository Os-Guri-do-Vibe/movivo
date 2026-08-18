import type { ProtocolStructure } from '@movivo/shared';

import type {
  AnonymizedReplay,
  OperationsResponse,
  QueueDetail,
  QueueItem,
  QueueResponse,
} from '@/lib/dashboard-types';

export const PROTOCOL_ID = '11111111-1111-4111-8111-111111111111';
export const HANDOFF_ID = '22222222-2222-4222-8222-222222222222';
export const PARQ_ID = '33333333-3333-4333-8333-333333333333';
export const CHECKIN_ID = '44444444-4444-4444-8444-444444444444';

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
};

export const parqItem: QueueItem = {
  id: PARQ_ID,
  kind: 'PARQ',
  severity: 'ALERT',
  createdAt: '2026-08-03T11:00:00.000Z',
  ageMinutes: 70,
  title: 'PAR-Q aguardando liberação',
  summary: 'Um cuidado a mais antes de começar.',
  status: 'BLOCKED_PENDING_CLEARANCE',
  autoReleaseAt: null,
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
};

// `mandatory` é só PAR-Q bloqueado; `optional` é todo protocolo — só quem carrega
// `autoReleaseAt` (optionalProtocolItem) de fato libera sozinho.
export const queueResponse: QueueResponse = {
  mandatory: [parqItem],
  optional: [optionalProtocolItem, protocolItem],
  counts: { mandatory: 1, optional: 2, total: 3 },
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
  context: { goal: 'Hipertrofia', level: 'Intermediário', location: 'Academia' },
  protocol: {
    id: PROTOCOL_ID,
    version: 1,
    status: 'DRAFT',
    approvalStatus: 'PENDING_REVIEW',
    content: protocolContent,
    signedAt: null,
    signatureHash: null,
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
