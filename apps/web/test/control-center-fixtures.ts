/**
 * Fixtures das projeções do Control Center (PR #67).
 *
 * Os objetos são deliberadamente válidos contra `control-center.schema.ts`, para que o
 * mesmo dado sirva ao teste de contrato (`control-center-api.test.ts`) e ao teste de
 * renderização dos setores. Métricas com `status: 'UNAVAILABLE'` e `value: null` existem
 * aqui porque "sem amostra" é um estado de produto — nunca deve virar zero inventado.
 */
import type {
  ControlCenterComplianceResponse,
  ControlCenterFinanceResponse,
  ControlCenterMarketingResponse,
  ControlCenterMetric,
  ControlCenterOverviewResponse,
  ControlCenterStudentDetailResponse,
  ControlCenterStudentsResponse,
  ControlCenterSupportResponse,
  ControlCenterSystemResponse,
} from '@movivo/shared';

export const controlCenterMeta: ControlCenterOverviewResponse['meta'] = {
  generatedAt: '2026-08-11T15:00:00.000Z',
  timezone: 'America/Sao_Paulo',
  dataQuality: ['Custo de IA ainda é estimativa contratada, não medição por chamada.'],
};

export function metric(overrides: Partial<ControlCenterMetric> = {}): ControlCenterMetric {
  return {
    value: 12,
    unit: 'COUNT',
    status: 'AVAILABLE',
    definition: 'Definição visível ao operador.',
    ...overrides,
  };
}

/** Métrica sem fonte de dado: valor nulo e status explicitamente indisponível. */
export const unavailableMetric = metric({
  value: null,
  status: 'UNAVAILABLE',
  definition: 'Ainda não há fonte auditável para este número.',
});

export const overviewResponse: ControlCenterOverviewResponse = {
  data: {
    activeSubscriptions: metric({ value: 42 }),
    trials: metric({ value: 7 }),
    contractedMrr: metric({ value: 1638, unit: 'BRL' }),
    northStar: unavailableMetric,
    criticalAlerts: metric({ value: 1 }),
  },
  meta: { ...controlCenterMeta, dataQuality: [...controlCenterMeta.dataQuality] },
};

export const systemResponse: ControlCenterSystemResponse = {
  data: {
    databaseLatency: metric({ value: 18, unit: 'MILLISECONDS' }),
    redisLatency: metric({ value: 3, unit: 'MILLISECONDS' }),
    aiJobs: metric({ value: 120 }),
    aiFailures: metric({ value: 2 }),
    aiDlq: metric({ value: 0 }),
    aiAverageLatency: metric({ value: 4.5, unit: 'MINUTES', status: 'PROXY' }),
    whatsappDeliveryCost: metric({ value: 31.5, unit: 'BRL', status: 'PROXY' }),
    infrastructureCost: unavailableMetric,
  },
  meta: { ...controlCenterMeta, dataQuality: [] },
};

export const financeResponse: ControlCenterFinanceResponse = {
  data: {
    activeSubscriptions: metric({ value: 42 }),
    contractedMrr: metric({ value: 1638, unit: 'BRL' }),
    aiCost: metric({ value: 40.9, unit: 'BRL', status: 'PROXY' }),
    whatsappCost: metric({ value: 31.5, unit: 'BRL', status: 'PROXY' }),
    infrastructureCost: unavailableMetric,
    receivedRevenue: unavailableMetric,
  },
  meta: { ...controlCenterMeta, dataQuality: [...controlCenterMeta.dataQuality] },
};

export const marketingResponse: ControlCenterMarketingResponse = {
  data: {
    funnel: {
      formStarted: metric({ value: 310 }),
      formSubmitted: metric({ value: 188 }),
      protocolActive: metric({ value: 96 }),
      subscriptionActive: unavailableMetric,
    },
    acquisition: metric({ value: 24, unit: 'PERCENT', status: 'PROXY' }),
    segments: [
      { dimension: 'PRIMARY_GOAL', value: 'Hipertrofia', count: 34 },
      { dimension: 'TRAINING_LOCATION', value: 'Casa', count: 21 },
    ],
    suppressedSegments: 3,
    minimumSegmentSize: 10,
  },
  meta: { ...controlCenterMeta, dataQuality: [] },
};

export const studentsResponse: ControlCenterStudentsResponse = {
  data: {
    students: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Ana Souza',
        email: 'ana@teste.com',
        phoneNumber: '+5511999990001',
        status: 'ACTIVE',
        subscriptionStatus: 'TRIALING',
        protocolStatus: 'ACTIVE',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: null,
        email: null,
        phoneNumber: '+5511999990002',
        status: 'PENDING',
        subscriptionStatus: null,
        protocolStatus: null,
      },
    ],
  },
  meta: { ...controlCenterMeta, dataQuality: [] },
};

export const studentDetailResponse: ControlCenterStudentDetailResponse = {
  data: {
    student: {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Ana Souza',
      email: 'ana@teste.com',
      phoneNumber: '+5511999990001',
      status: 'ACTIVE',
      subscriptionStatus: 'TRIALING',
      protocolStatus: 'ACTIVE',
      requiresProfessionalReview: false,
      anamnesisStatus: 'COMPLETED',
      parqState: 'CLEARED',
      currentProtocol: {
        id: '33333333-3333-4333-8333-333333333333',
        version: 2,
        currentWeek: 3,
        totalWeeks: 8,
        signedAt: '2026-08-01T12:00:00.000Z',
      },
      routine: {
        primaryGoal: 'Hipertrofia',
        trainingStatus: 'Treinando',
        experience: 'Intermediário',
        daysPerWeek: 4,
        preferredDays: ['SEG', 'QUA'],
        sessionDuration: '60 min',
        location: 'Academia',
        preferredPeriod: 'Manhã',
      },
      workoutHistory: {
        status: 'UNAVAILABLE',
        reason: 'A execução dos treinos ainda não é registrada pelo produto.',
      },
    },
  },
  meta: { ...controlCenterMeta, dataQuality: [...controlCenterMeta.dataQuality] },
};

export const supportResponse: ControlCenterSupportResponse = {
  data: {
    customers: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Ana Souza',
        email: 'ana@teste.com',
        phoneNumber: '+5511999990001',
        status: 'ACTIVE',
        subscriptionStatus: 'ACTIVE',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: null,
        email: null,
        phoneNumber: '+5511999990002',
        status: 'PENDING',
        subscriptionStatus: null,
      },
    ],
  },
  meta: { ...controlCenterMeta, dataQuality: [] },
};

export const complianceResponse: ControlCenterComplianceResponse = {
  data: {
    activeConsents: metric({ value: 40 }),
    revokedConsents: metric({ value: 2 }),
    auditedHealthReads: metric({ value: 118 }),
    privacyRequests: unavailableMetric,
    recentAuditEvents: [
      {
        id: 1,
        actorId: 'aaaaaaaa-1111-4111-8111-111111111111',
        subjectId: 'bbbbbbbb-2222-4222-8222-222222222222',
        action: 'HEALTH_DATA_READ',
        entityType: 'anamnesis',
        entityId: 'cccccccc-3333-4333-8333-333333333333',
        createdAt: '2026-08-11T14:30:00.000Z',
      },
    ],
  },
  meta: { ...controlCenterMeta, dataQuality: [...controlCenterMeta.dataQuality] },
};
