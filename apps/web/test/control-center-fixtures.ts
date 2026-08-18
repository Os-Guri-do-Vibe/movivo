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
  ControlCenterIntegrationResponse,
  ControlCenterMarketingResponse,
  ControlCenterMetric,
  ControlCenterOverviewResponse,
  ControlCenterStudentDetailResponse,
  ControlCenterStudentsResponse,
  ControlCenterSystemResponse,
  KnowledgeDocumentsResponse,
  PartnerDistributionResponse,
} from '@movivo/shared';
import { PARTNER_DISTRIBUTION_CAVEATS } from '@movivo/shared';

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

/** Grade 7x24 completa: só a segunda-feira às 8h concentra eventos, o resto é baixo. */
const heatmapCells: ControlCenterMarketingResponse['data']['signupSeasonality'] = Array.from(
  { length: 7 },
  (_, dayOfWeek) =>
    Array.from({ length: 24 }, (_, hour) => ({
      dayOfWeek,
      hour,
      // Célula publicável é 0 ou >= 10 (k-anonimato): o backend já suprime as de 1 a 9.
      value: dayOfWeek === 1 && hour === 8 ? 40 : ((dayOfWeek + hour) % 5) * 10,
    })),
).flat();

/**
 * Visão Geral (US-7.8): 5 linhas-resumo, uma por pilar. Cada `headline`/`details`
 * reaproveita o formato de métrica dos próprios pilares — é o mesmo contrato.
 */
export const overviewResponse: ControlCenterOverviewResponse = {
  data: {
    pillars: [
      {
        pillar: 'STUDENTS',
        label: 'Alunos',
        state: 'ATTENTION',
        href: '/dashboard/alunos',
        headline: { label: 'Alunos cadastrados', metric: metric({ value: 25 }) },
        details: [
          { label: 'Em risco de cancelamento', metric: metric({ value: 3 }) },
          { label: 'Alertas de segurança e PAR-Q bloqueado', metric: metric({ value: 0 }) },
        ],
        reason: '3 aluno(s) com sinal de risco de cancelamento.',
      },
      {
        pillar: 'FINANCE',
        label: 'Financeiro',
        state: 'OK',
        href: '/dashboard/financeiro',
        headline: { label: 'MRR contratado', metric: metric({ value: 1638, unit: 'BRL' }) },
        details: [
          { label: 'Receita em risco (30 dias)', metric: metric({ value: 0, unit: 'BRL' }) },
          { label: 'Cancelamentos (90 dias)', metric: metric({ value: 1 }) },
        ],
        reason: null,
      },
      {
        pillar: 'MARKETING',
        label: 'Marketing',
        state: 'OK',
        href: '/dashboard/analytics',
        headline: { label: 'Cadastros iniciados', metric: metric({ value: 120 }) },
        details: [
          {
            label: 'Taxa de conclusão da anamnese',
            metric: metric({ value: 68, unit: 'PERCENT' }),
          },
        ],
        reason: null,
      },
      {
        pillar: 'AI',
        label: 'IA',
        state: 'OK',
        href: '/dashboard/ia/agente',
        headline: { label: 'Conversas (30 dias)', metric: metric({ value: 340 }) },
        details: [
          {
            label: 'Taxa de resposta bloqueada pela validação',
            metric: metric({ value: 1.2, unit: 'PERCENT' }),
          },
          { label: 'Persona vigente', metric: metric({ value: 2 }) },
        ],
        reason: null,
      },
      {
        pillar: 'SYSTEM',
        label: 'Sistema',
        state: 'CRITICAL',
        href: '/dashboard/sistema',
        headline: {
          label: 'Trabalhos que não viraram tarefa manual',
          metric: metric({ value: 90, unit: 'PERCENT' }),
        },
        details: [
          { label: 'Orçamento de erro consumido', metric: metric({ value: 120, unit: 'PERCENT' }) },
        ],
        reason: 'Trabalhos que não viraram tarefa manual: fora da meta (menos de 0,5% em DLQ).',
      },
    ],
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
    aiLatency: {
      samples: 120,
      p50: metric({ value: 1200, unit: 'MILLISECONDS' }),
      p95: metric({ value: 4800, unit: 'MILLISECONDS' }),
      p99: metric({ value: 9000, unit: 'MILLISECONDS' }),
    },
    aiLatencyByModel: [
      { model: 'gpt-4.1', jobType: 'AI_RESPONSE', samples: 100, p50: 1200, p95: 4800, p99: 9000 },
    ],
    aiLatencyP95Daily: [
      { date: '2026-08-11', value: 4600 },
      { date: '2026-08-12', value: 4800 },
    ],
    whatsappLatency: {
      samples: 60,
      p50: metric({ value: 9000, unit: 'MILLISECONDS' }),
      p95: metric({ value: 25000, unit: 'MILLISECONDS' }),
      p99: metric({ value: 31000, unit: 'MILLISECONDS' }),
    },
    whatsappLatencyP95Daily: [
      { date: '2026-08-11', value: 24000 },
      { date: '2026-08-12', value: 25000 },
    ],
    ragQueries: metric({ value: 340 }),
    ragUsefulRetrievalRate: metric({ value: 62.5, unit: 'PERCENT' }),
    ragCorpusChunks: metric({ value: 48 }),
    slos: [
      {
        key: 'PROTOCOL_DELIVERY',
        title: 'Protocolo entregue em até 2 horas',
        objective: 'De cada 100 protocolos gerados, ao menos 95 ficam prontos em até 2 horas.',
        explanation: 'Mede o tempo entre o pedido do protocolo e a conclusão da geração.',
        targetPercent: 95,
        currentPercent: 97,
        samples: 100,
        errorBudgetConsumedPercent: 60,
        status: 'GREEN',
      },
      {
        key: 'COACH_RESPONSE',
        title: 'Resposta do AI Coach em até 30 segundos',
        objective: 'De cada 100 respostas, ao menos 95 chegam em até 30 segundos.',
        explanation: 'Conta o tempo que o aluno espera até a resposta chegar.',
        targetPercent: 95,
        currentPercent: 96,
        samples: 60,
        errorBudgetConsumedPercent: 80,
        status: 'YELLOW',
      },
      {
        key: 'AI_JOB_SUCCESS',
        title: 'Trabalhos de IA que terminam bem',
        objective: 'Ao menos 99 de cada 100 trabalhos de IA terminam sem erro.',
        explanation: 'Cada geração ou resposta é um trabalho.',
        targetPercent: 99,
        currentPercent: 98,
        samples: 120,
        errorBudgetConsumedPercent: 200,
        status: 'RED',
      },
      {
        key: 'AI_JOB_NO_DLQ',
        title: 'Trabalhos que não viraram tarefa manual',
        objective: 'Menos de 1 em cada 200 trabalhos esgota as tentativas.',
        explanation: 'Trabalho em DLQ exige alguém da equipe para resolver.',
        targetPercent: 99.5,
        currentPercent: null,
        samples: 0,
        errorBudgetConsumedPercent: null,
        status: 'UNKNOWN',
      },
    ],
    pendingCapabilities: [
      {
        title: 'Histórico de incidentes e disponibilidade real (uptime)',
        reason: 'Não existe registro do que ficou fora do ar.',
        dependency: 'Registro de incidentes e probe externo',
        plannedFor: 'Sprint 9',
      },
      {
        title: 'Rastro ponta-a-ponta de uma requisição (tracing distribuído)',
        reason: 'Não dá para seguir uma mensagem por todos os serviços.',
        dependency: 'Instrumentação OpenTelemetry e coletor',
        plannedFor: 'Fase 6 — Infraestrutura',
      },
    ],
  },
  meta: { ...controlCenterMeta, dataQuality: [] },
};

export const financeResponse: ControlCenterFinanceResponse = {
  data: {
    activeSubscriptions: metric({ value: 42 }),
    contractedMrr: metric({ value: 1638, unit: 'BRL' }),
    aiCost: metric({ value: 40.9, unit: 'BRL', status: 'PROXY' }),
    aiCostPerActiveUser: metric({ value: 0.97, unit: 'BRL', status: 'PROXY' }),
    whatsappCost: metric({ value: 31.5, unit: 'BRL', status: 'PROXY' }),
    infrastructureCost: unavailableMetric,
    receivedRevenue: unavailableMetric,
    profit: metric({
      value: null,
      unit: 'BRL',
      status: 'UNAVAILABLE',
      definition: 'Nenhuma despesa lançada ainda: exibir lucro sem custo seria inventar.',
    }),
    partnerDistribution: unavailableMetric,
    customerAcquisitionCost: unavailableMetric,
    revenueAtRisk30d: metric({ value: 297, unit: 'BRL', status: 'PROXY' }),
    entryCohorts: [
      {
        month: '2026-06',
        cohortSize: 40,
        converted: 12,
        conversionRatePercent: 30,
        retained: 10,
        retentionPercent: 25,
        reconstructed: true,
      },
      {
        month: '2026-07',
        cohortSize: 60,
        converted: 21,
        conversionRatePercent: 35,
        retained: 19,
        retentionPercent: 31.7,
        reconstructed: false,
      },
    ],
    suppressedCohorts: 1,
    renewalCalendar: [
      { month: '2026-08', plan: 'MONTHLY', subscriptions: 12, amountBrl: 468 },
      { month: '2026-09', plan: 'QUARTERLY', subscriptions: 3, amountBrl: 297 },
    ],
    subscriptionsAtRisk: [
      {
        subscriptionId: '44444444-4444-4444-8444-444444444444',
        plan: 'QUARTERLY',
        currentPeriodEnd: '2026-09-02T12:00:00.000Z',
        amountBrl: 99,
        riskSignal: 'Sem mensagem recebida há 14 dias',
      },
    ],
    churnByReason: [
      { reason: 'PRECO', total: 5, last90Days: 3 },
      { reason: 'NAO_INFORMADO', total: 3, last90Days: 1 },
    ],
    mrrByPlan: [
      { plan: 'MONTHLY', activeSubscriptions: 30, mrrBrl: 1170, arrBrl: 14040 },
      { plan: 'QUARTERLY', activeSubscriptions: 12, mrrBrl: 396, arrBrl: 4752 },
    ],
    aiCostByModel: [
      {
        model: 'gpt-4.1',
        jobs: 820,
        tokensInput: 1_200_000,
        tokensOutput: 300_000,
        costBrl: 38.88,
      },
      {
        model: 'claude-sonnet-4-5',
        jobs: 40,
        tokensInput: 60_000,
        tokensOutput: 15_000,
        costBrl: 2.02,
      },
    ],
    // US-8.4 — despesa lançada, custo por categoria/mês e resultado do período.
    totalExpense: metric({ value: 180, unit: 'BRL' }),
    expensePerActiveUser: metric({ value: 4.29, unit: 'BRL' }),
    costByCategory: [
      { category: 'INFRA', amountBrl: 120 },
      { category: 'IA_LLM', amountBrl: 30 },
      { category: 'MARKETING', amountBrl: 30 },
    ],
    costByMonth: [
      { month: '2026-07', amountBrl: 150 },
      { month: '2026-08', amountBrl: 180 },
    ],
    // US-8.5 — receita RECEBIDA. Série separada da contratada (`renewalCalendar`) de
    // propósito: são grandezas diferentes e a tela nunca as soma.
    receivedRevenueByMonth: [
      { month: '2026-07', grossBrl: 1400, netBrl: 1344, settlements: 36 },
      { month: '2026-08', grossBrl: 1500, netBrl: 1440, settlements: 39 },
    ],
    projection: {
      status: 'AVAILABLE',
      basisMonths: ['2026-07'],
      horizonMonths: 3,
      method: 'Media mensal de meses fechados.',
      reason: null,
      scenarios: (
        [
          { scenario: 'CONSERVATIVE', revenueFactor: 0.9, costFactor: 1.1 },
          { scenario: 'BASE', revenueFactor: 1, costFactor: 1 },
          { scenario: 'OPTIMISTIC', revenueFactor: 1.1, costFactor: 0.95 },
        ] as const
      ).map((scenario) => ({
        ...scenario,
        months: ['2026-09', '2026-10', '2026-11'].map((month) => ({
          month,
          projectedRevenueBrl: 1400,
          projectedCostBrl: 150,
          projectedResultBrl: 1250,
        })),
        totalRevenueBrl: 4200,
        totalCostBrl: 450,
        totalResultBrl: 3750,
      })),
    },
    delinquencyRate: metric({ value: 7.1, unit: 'PERCENT' }),
    averageSettlementDays: metric({ value: 2.3, unit: 'COUNT' }),
    gatewayFee: metric({ value: 60, unit: 'BRL' }),
    gatewayFeePercent: metric({ value: 4, unit: 'PERCENT' }),
    paymentExceptions: [
      {
        paymentId: '77777777-7777-4777-8777-777777777777',
        gateway: 'STRIPE',
        status: 'SETTLED',
        amountBrl: 39,
        occurredAt: '2026-08-10T12:00:00.000Z',
        receivedAt: '2026-08-10T12:00:05.000Z',
      },
    ],
    profitBasis: 'CONTRATADO_PROXY',
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
    trialConversion: {
      status: 'AVAILABLE',
      trialsStarted: 100,
      converted: 33,
      conversionRatePercent: 33,
      medianDaysToConversion: 5.5,
      reconstructedEntries: 40,
      reason: null,
    },
    anamnesisFunnel: {
      settledSessions: 310,
      steps: [
        {
          step: 1,
          label: 'Etapa 1 — cadastro',
          reached: 310,
          completed: 190,
          abandoned: 120,
          abandonRate: 0.387,
        },
        {
          step: 2,
          label: 'Etapa 2 — anamnese',
          reached: 190,
          completed: 160,
          abandoned: 30,
          abandonRate: 0.158,
        },
        {
          step: 3,
          label: 'Etapa 3 — PAR-Q',
          reached: 160,
          completed: 145,
          abandoned: 15,
          abandonRate: 0.094,
        },
      ],
      worstStep: 1,
      exitPoint: {
        status: 'AVAILABLE',
        step: 1,
        checkpoint: 'Código de verificação do WhatsApp',
        count: 74,
        reason: 'Checkpoint persistido da etapa 1 (posse do número, US-6.5).',
      },
    },
    acquisition: metric({ value: 24, unit: 'PERCENT', status: 'PROXY' }),
    acquisitionChannels: [
      { channel: 'instagram', mapped: true, raw: 'instagram / meta_ads', count: 34 },
      { channel: 'organico', mapped: true, raw: 'organico / organico', count: 21 },
    ],
    suppressedChannels: 1,
    channelEconomics: [
      {
        channel: 'instagram',
        mapped: true,
        students: 34,
        converted: 12,
        investmentBrl: 1200,
        investmentStatus: 'INVESTED',
        cac: metric({ value: 100, unit: 'BRL' }),
        receivedRevenue: metric({ value: 4200, unit: 'BRL' }),
        roas: metric({ value: 3.5, unit: 'RATIO' }),
        ltv: metric({ value: 350, unit: 'BRL', status: 'PROXY' }),
        ltvToCac: metric({ value: 3.5, unit: 'RATIO', status: 'PROXY' }),
        paybackMonths: metric({ value: 2, unit: 'MONTHS', status: 'PROXY' }),
        signal: 'GREEN',
      },
      {
        channel: 'organico',
        mapped: true,
        students: 21,
        converted: 7,
        investmentBrl: null,
        investmentStatus: 'NO_DIRECT_INVESTMENT',
        cac: unavailableMetric,
        receivedRevenue: metric({ value: 900, unit: 'BRL' }),
        roas: unavailableMetric,
        ltv: metric({ value: 128.57, unit: 'BRL', status: 'PROXY' }),
        ltvToCac: unavailableMetric,
        paybackMonths: unavailableMetric,
        signal: 'UNKNOWN',
      },
    ],
    attributionWindowDays: 60,
    matureCohorts: 2,
    mediaInvestmentBrl: 1200,
    attributionNotCaptured: 6,
    segments: [
      { dimension: 'PRIMARY_GOAL', value: 'Hipertrofia', count: 34 },
      { dimension: 'TRAINING_LOCATION', value: 'Casa', count: 21 },
      { dimension: 'AGE_BAND', value: '25-34', count: 41 },
    ],
    signupSeasonality: heatmapCells,
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
        churnRisk: {
          score: 2,
          signals: [
            { code: 'SEM_MENSAGEM', label: 'Sem mensagem do aluno há 9 dias' },
            { code: 'RENOVACAO_PROXIMA', label: 'Trial ou período pago termina em 2 dias' },
          ],
        },
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: null,
        email: null,
        phoneNumber: '+5511999990002',
        status: 'PENDING',
        subscriptionStatus: null,
        protocolStatus: null,
        churnRisk: { score: 0, signals: [] },
      },
    ],
    aiBlockedRate: metric({ value: 3.2, unit: 'PERCENT' }),
    northStar: {
      averageCompletions: metric({ value: 6.4, unit: 'COUNT' }),
      target: 8,
      reportingRate: metric({ value: 72.5, unit: 'PERCENT' }),
      cohortSize: 40,
      bySource: [
        { source: 'WHATSAPP_QUICK_REPLY', completions: 210 },
        { source: 'CHECKIN', completions: 46 },
        { source: 'CONVERSATION', completions: 0 },
      ],
    },
    declaredAdherenceRate: metric({ value: 81.3, unit: 'PERCENT' }),
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
      acquisition: {
        channel: 'instagram',
        mapped: true,
        raw: 'instagram / meta_ads',
        campaign: 'lancamento-agosto',
        content: null,
        referrerHost: 'instagram.com',
        capturedAt: '2026-07-30T14:00:00.000Z',
      },
      churnRisk: {
        score: 1,
        signals: [
          {
            code: 'CHECKIN_SEM_RESPOSTA',
            label: 'Check-in enviado há 4 dias e ainda sem resposta',
          },
        ],
      },
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
      // Timeline com as 6 origens fora de ordem de origem, mas já ordenada por tempo:
      // é exatamente o que o backend entrega.
      timeline: [
        {
          at: '2026-08-10T13:00:00.000Z',
          kind: 'HANDOFF',
          title: 'Atendimento humano aberto (ALERT)',
          detail: 'VALIDATOR_FLAG',
        },
        {
          at: '2026-08-09T15:00:00.000Z',
          kind: 'CONVERSATION',
          title: '12 mensagens trocadas no dia',
          detail: null,
        },
        {
          at: '2026-08-08T11:00:00.000Z',
          kind: 'CHECKIN',
          title: 'Check-in da semana 3 respondido',
          detail: 'esforço percebido ADEQUADO · treinos declarados TRES_MAIS',
        },
        {
          at: '2026-08-05T11:00:00.000Z',
          kind: 'CHECKIN',
          title: 'Check-in da semana 3 enviado',
          detail: null,
        },
        {
          at: '2026-08-02T12:00:00.000Z',
          kind: 'PROTOCOL',
          title: 'Versão 2 do protocolo gerada',
          detail: 'ajuste pós check-in · modelo gpt-4.1',
        },
        {
          at: '2026-07-20T09:00:00.000Z',
          kind: 'SUBSCRIPTION',
          title: 'Assinatura MONTHLY criada',
          detail: 'TRIALING',
        },
        {
          at: '2026-07-19T18:00:00.000Z',
          kind: 'ANAMNESIS',
          title: 'Formulário de anamnese enviado',
          detail: 'COMPLETED',
        },
      ],
      adherence: {
        checkinsSent: 4,
        checkinsResponded: 3,
        responseRate: metric({ value: 75, unit: 'PERCENT', status: 'PROXY' }),
      },
      aiQuality: {
        blockedRate: metric({ value: 5, unit: 'PERCENT' }),
        blocked: 1,
        validated: 20,
        occurrences: [
          {
            at: '2026-08-07T10:00:00.000Z',
            content: 'Resposta bloqueada para [nome], contato [telefone].',
          },
        ],
      },
      health: {
        parqState: 'CLEARED',
        painReports: [
          { at: '2026-08-08T11:00:00.000Z', week: 3, text: 'desconforto leve no ombro' },
        ],
        evolution: [
          {
            week: 2,
            at: '2026-08-01T11:00:00.000Z',
            fatigue: 'LEVE',
            workouts: 'UM_DOIS',
            adjustment: 'MANTER',
          },
          {
            week: 3,
            at: '2026-08-08T11:00:00.000Z',
            fatigue: 'ADEQUADO',
            workouts: 'TRES_MAIS',
            adjustment: 'AUMENTAR',
          },
        ],
      },
    },
  },
  meta: { ...controlCenterMeta, dataQuality: [...controlCenterMeta.dataQuality] },
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

/**
 * Cap table fechado (10.000 bps) com lucro apurado. As ressalvas vêm da constante do
 * contrato, não de texto solto: é assim que a rota real responde.
 */
export const partnerDistributionResponse: PartnerDistributionResponse = {
  data: {
    period: '2026-08',
    profitCents: 500_000,
    profitAvailable: true,
    profitDefinition: 'Receita reconhecida menos despesas lançadas no período.',
    partners: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Rodrigo',
        shareBasisPoints: 6000,
        validFrom: '2026-01-01',
        validTo: null,
        notes: null,
        amountCents: 300_000,
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Pedro',
        shareBasisPoints: 4000,
        validFrom: '2026-01-01',
        validTo: null,
        notes: null,
        amountCents: 200_000,
      },
    ],
    totalBasisPoints: 10_000,
    caveats: [...PARTNER_DISTRIBUTION_CAVEATS],
  },
  meta: { ...controlCenterMeta, dataQuality: [...controlCenterMeta.dataQuality] },
};

/** Um documento em quarentena, ainda não indexado — o estado padrão do corpus. */
export const knowledgeDocumentsResponse: KnowledgeDocumentsResponse = {
  data: {
    documents: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        title: 'Guia de descanso entre séries',
        topic: 'descanso',
        sourceUrl: null,
        originalFilename: 'guia.md',
        mimeType: 'text/markdown',
        sizeBytes: 120,
        sha256: 'a'.repeat(64),
        status: 'PENDING',
        uploadedBy: 'Rodrigo',
        reviewer: null,
        reviewNote: null,
        createdAt: '2026-08-11T15:00:00.000Z',
        reviewedAt: null,
        retainedUntil: '2026-09-10T15:00:00.000Z',
        blobAvailable: true,
        chunkCount: 0,
      },
    ],
    policy: {
      allowedTypes: ['text/plain', 'text/markdown'],
      maxBytes: 524_288,
      quarantineDays: 30,
      approvedOriginalDays: 365,
    },
  },
  meta: { ...controlCenterMeta, dataQuality: [...controlCenterMeta.dataQuality] },
};

export const integrationNotConfiguredResponse: ControlCenterIntegrationResponse = {
  data: { whatsapp: { configured: false, instanceName: null, status: 'NOT_CONFIGURED', qrCodeBase64: null } },
  meta: { ...controlCenterMeta, dataQuality: [] },
};

export const integrationConnectingResponse: ControlCenterIntegrationResponse = {
  data: {
    whatsapp: {
      configured: true,
      instanceName: 'minha-empresa',
      status: 'CONNECTING',
      qrCodeBase64: 'data:image/png;base64,abc',
    },
  },
  meta: { ...controlCenterMeta, dataQuality: [] },
};

export const integrationConnectedResponse: ControlCenterIntegrationResponse = {
  data: {
    whatsapp: { configured: true, instanceName: 'minha-empresa', status: 'CONNECTED', qrCodeBase64: null },
  },
  meta: { ...controlCenterMeta, dataQuality: [] },
};
