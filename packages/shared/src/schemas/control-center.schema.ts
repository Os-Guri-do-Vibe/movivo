import { z } from 'zod';

import { ControlCenterCapability, ControlCenterRole } from '../enums/control-center';
import { ProfitBasis } from '../enums/expense';
import { expenseCategorySchema } from './expense.schema';

export const profitBasisSchema = z.enum(
  Object.values(ProfitBasis) as [ProfitBasis, ...ProfitBasis[]],
);

const roleValues = Object.values(ControlCenterRole) as [ControlCenterRole, ...ControlCenterRole[]];
const capabilityValues = Object.values(ControlCenterCapability) as [
  ControlCenterCapability,
  ...ControlCenterCapability[],
];

export const controlCenterRoleSchema = z.enum(roleValues);
export const controlCenterCapabilitySchema = z.enum(capabilityValues);

export const dataAvailabilitySchema = z.enum(['AVAILABLE', 'PROXY', 'UNAVAILABLE']);
export type DataAvailability = z.infer<typeof dataAvailabilitySchema>;

export const controlCenterMetricSchema = z.object({
  value: z.number().finite().nullable(),
  unit: z.enum(['COUNT', 'PERCENT', 'BRL', 'MILLISECONDS', 'MINUTES', 'RATIO', 'MONTHS']),
  status: dataAvailabilitySchema,
  definition: z.string().min(1),
});
export type ControlCenterMetric = z.infer<typeof controlCenterMetricSchema>;

export const controlCenterMetaSchema = z.object({
  generatedAt: z.iso.datetime(),
  timezone: z.literal('America/Sao_Paulo'),
  dataQuality: z.array(z.string()),
});

export const controlCenterSessionSchema = z.object({
  userId: z.uuid(),
  role: controlCenterRoleSchema,
  capabilities: z.array(controlCenterCapabilitySchema),
});
export type ControlCenterSession = z.infer<typeof controlCenterSessionSchema>;

/** Ponto de uma série diária já preenchida com zeros nos dias sem evento. */
export const controlCenterTimeSeriesPointSchema = z.object({
  /** Dia civil em `America/Sao_Paulo`, formato `YYYY-MM-DD`. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.number().int().nonnegative(),
});
export type ControlCenterTimeSeriesPoint = z.infer<typeof controlCenterTimeSeriesPointSchema>;

/**
 * Contagem publicável sob k-anonimato: ou é zero (não identifica ninguém) ou é
 * grande o bastante. Qualquer célula entre 1 e 9 é erro de contrato, não de tela —
 * é aqui que a supressão deixa de depender da boa vontade do frontend.
 */
const kAnonymousCount = z
  .number()
  .int()
  .nonnegative()
  .refine((value) => value === 0 || value >= 10, 'Célula entre 1 e 9 viola o k-anonimato.');

/** Célula do mapa de calor: grade completa 7x24 em `America/Sao_Paulo`. */
export const controlCenterHeatmapCellSchema = z.object({
  /** 0 = domingo … 6 = sábado (mesma convenção de `EXTRACT(dow)` do PostgreSQL). */
  dayOfWeek: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  /** Dia×hora de cadastro é quase-identificador: célula entre 1 e 9 nunca é publicada. */
  value: kAnonymousCount,
});
export type ControlCenterHeatmapCell = z.infer<typeof controlCenterHeatmapCellSchema>;

/** Pilar de decisão do menu (US-7.1). A Visão Geral resume um por linha (US-7.8). */
export const controlCenterPillarSchema = z.enum([
  'STUDENTS',
  'FINANCE',
  'MARKETING',
  'AI',
  'SYSTEM',
]);
export type ControlCenterPillar = z.infer<typeof controlCenterPillarSchema>;

/** Semáforo da linha-resumo. Sem quarto estado: "sem amostra" é `OK` com `reason` nulo. */
export const controlCenterPillarStateSchema = z.enum(['OK', 'ATTENTION', 'CRITICAL']);
export type ControlCenterPillarState = z.infer<typeof controlCenterPillarStateSchema>;

export const controlCenterLabeledMetricSchema = z.object({
  label: z.string().min(1),
  metric: controlCenterMetricSchema,
});

/**
 * Linha-resumo de um pilar (US-7.8). **Nenhum número nasce aqui**: todos vêm de uma
 * métrica que já existe no pilar de destino, e `href` é a rota onde se age sobre ela.
 */
export const controlCenterPillarSummarySchema = z.object({
  pillar: controlCenterPillarSchema,
  label: z.string().min(1),
  state: controlCenterPillarStateSchema,
  /** Rota existente do menu — o clique tem que cair onde a ação acontece. */
  href: z.string().startsWith('/dashboard'),
  /** O número-âncora do pilar naquele momento. */
  headline: controlCenterLabeledMetricSchema,
  details: z.array(controlCenterLabeledMetricSchema),
  /** Por que a linha não está `OK`. `null` quando está. */
  reason: z.string().nullable(),
});
export type ControlCenterPillarSummary = z.infer<typeof controlCenterPillarSummarySchema>;

/**
 * Visão Geral (US-7.8): só as linhas dos pilares que o ator pode ver. Um pilar sem
 * capability **não é calculado no servidor** — não chega ao payload para ser escondido
 * na UI depois.
 */
export const controlCenterOverviewResponseSchema = z.object({
  data: z.object({ pillars: z.array(controlCenterPillarSummarySchema) }),
  meta: controlCenterMetaSchema,
});
export type ControlCenterOverviewResponse = z.infer<typeof controlCenterOverviewResponseSchema>;

export const marketingSegmentSchema = z.object({
  dimension: z.enum(['PRIMARY_GOAL', 'TRAINING_LOCATION', 'PREFERRED_PERIOD', 'AGE_BAND']),
  value: z.string(),
  count: z.number().int().nonnegative().min(10),
});

/** Etapa do wizard de onboarding (1=cadastro, 2=anamnese, 3=PAR-Q). */
export const anamnesisFunnelStepSchema = z.object({
  step: z.number().int().min(1).max(3),
  label: z.string().min(1),
  /** Sessões encerradas que chegaram a esta etapa. */
  reached: kAnonymousCount,
  /** Quantas concluíram a etapa e avançaram. */
  completed: kAnonymousCount,
  /** `reached - completed`. */
  abandoned: kAnonymousCount,
  /** Fração de 0 a 1; `null` quando não houve ninguém na etapa. */
  abandonRate: z.number().min(0).max(1).nullable(),
});
export type AnamnesisFunnelStep = z.infer<typeof anamnesisFunnelStepSchema>;

export const anamnesisFunnelSchema = z.object({
  /** Sessões com desfecho definido (enviadas ou com link já expirado). */
  settledSessions: kAnonymousCount,
  /** Vazio quando alguma célula cairia entre 1 e 9: a dimensão inteira é suprimida. */
  steps: z.array(anamnesisFunnelStepSchema),
  /** Etapa com maior taxa de abandono, ou `null` sem amostra publicável. */
  worstStep: z.number().int().min(1).max(3).nullable(),
  /** Ponto de parada mais frequente dentro da etapa de maior queda. */
  exitPoint: z.object({
    status: dataAvailabilitySchema,
    step: z.number().int().min(1).max(3).nullable(),
    checkpoint: z.string().nullable(),
    count: kAnonymousCount.nullable(),
    reason: z.string().min(1),
  }),
});

/**
 * Canal de aquisição agregado (US-8.2, TASK-8.2.3). Fonte pronta para a tela de
 * Aquisição & Canais da US-8.6.
 *
 * `mapped: false` é o valor que chegou por UTM e **não** está na taxonomia canônica —
 * ele aparece rotulado como `nao_mapeado` com o bruto ao lado, nunca dissolvido num
 * balde "outros" que esconderia erro de marcação de campanha.
 */
export const acquisitionChannelSchema = z.object({
  channel: z.string().min(1),
  mapped: z.boolean(),
  /** `utm_source / utm_medium` como veio do link. */
  raw: z.string().min(1),
  count: kAnonymousCount,
});
export type AcquisitionChannel = z.infer<typeof acquisitionChannelSchema>;

/**
 * Janela de atribuição declarada (US-8.6 / TASK-8.6.2). Quem viu o anúncio em maio pode
 * converter em junho: CAC de mês-calendário sobre conversão do mesmo mês está errado. A
 * atribuição é por **coorte de origem**, e a janela vai na resposta — nunca fica implícita.
 */
export const ATTRIBUTION_WINDOW_DAYS = 60;

/** Meses para uma coorte de entrada ser considerada madura o bastante para sustentar LTV. */
export const MATURE_COHORT_MONTHS = 3;

/** Metas de Eduardo (`07-relatorio-eduardo.md`). */
export const LTV_TO_CAC_TARGET = 3;
export const PAYBACK_TARGET_MONTHS = 3;

/**
 * Semáforo de origem contra as metas. `UNKNOWN` quando falta numerador ou denominador —
 * um canal sem investimento não é verde nem vermelho, é uma pergunta sem dado.
 */
export const channelSignalSchema = z.enum(['GREEN', 'ATTENTION', 'CRITICAL', 'UNKNOWN']);
export type ChannelSignal = z.infer<typeof channelSignalSchema>;

/**
 * Economia por canal de origem (US-8.6): CAC, ROAS e LTV/CAC.
 *
 * Três regras que o contrato impõe:
 *  - `investmentBrl` é **nulo** quando não houve investimento no canal, e o rótulo é
 *    "sem investimento direto". `R$ 0,00` seria um número bonito e falso, e um CAC
 *    dividido por zero é infinito disfarçado.
 *  - ROAS usa receita **recebida** (`payments`, US-8.5), nunca contratada — ROAS sobre
 *    dinheiro que não entrou é o que faz escalar um anúncio ruim.
 *  - só entram canais com `students >= 10`; não há drill-down até o aluno.
 */
export const channelEconomicsSchema = z.object({
  channel: z.string().min(1),
  mapped: z.boolean(),
  students: kAnonymousCount,
  /** Convertidos dentro da janela de atribuição declarada em `attributionWindowDays`. */
  converted: z.number().int().nonnegative(),
  /** Nulo = sem investimento direto no canal. Nunca zero. */
  investmentBrl: z.number().nonnegative().nullable(),
  investmentStatus: z.enum(['INVESTED', 'NO_DIRECT_INVESTMENT']),
  cac: controlCenterMetricSchema,
  receivedRevenue: controlCenterMetricSchema,
  roas: controlCenterMetricSchema,
  ltv: controlCenterMetricSchema,
  ltvToCac: controlCenterMetricSchema,
  paybackMonths: controlCenterMetricSchema,
  signal: channelSignalSchema,
});
export type ChannelEconomics = z.infer<typeof channelEconomicsSchema>;

/** Linha do extrato de investimento em mídia (US-8.6). Estorno aparece como linha própria. */
export const adSpendEntrySchema = z.object({
  id: z.uuid(),
  channel: z.string().min(1),
  campaign: z.string().min(1),
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountCents: z.number().int(),
  reversesAdSpendId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdSpendEntry = z.infer<typeof adSpendEntrySchema>;

/**
 * Funil trial→ativo (US-8.3, TASK-8.3.4), lido de `user_status_transitions`.
 *
 * `UNAVAILABLE` com `reason` preenchido quando a amostra é pequena demais para publicar —
 * nunca zero, que seria lido como "ninguém converteu".
 *
 * ATENÇÃO à definição de "convertido": até a tabela `payments` existir (US-8.5), o marco
 * `CONVERTED` é gravado no proxy `TRIALING→ACTIVE` (pagamento **autorizado**). A definição
 * fechada por Eduardo é primeiro pagamento **liquidado** — a diferença (reembolso e falha de
 * liquidação pós-autorização) infla a taxa para cima. A UI deve expor isso no tooltip.
 */
export const controlCenterTrialConversionSchema = z.object({
  status: dataAvailabilitySchema,
  trialsStarted: kAnonymousCount.nullable(),
  converted: kAnonymousCount.nullable(),
  /** 0–100, uma casa decimal. */
  conversionRatePercent: z.number().min(0).max(100).nullable(),
  /** Mediana de dias entre a entrada em trial e a conversão, só sobre quem converteu. */
  medianDaysToConversion: z.number().nonnegative().nullable(),
  /** Quantas entradas do denominador vieram do backfill (`actor = 'BACKFILL'`). */
  reconstructedEntries: z.number().int().nonnegative(),
  reason: z.string().nullable(),
});
export type ControlCenterTrialConversion = z.infer<typeof controlCenterTrialConversionSchema>;

export const controlCenterMarketingResponseSchema = z.object({
  data: z.object({
    funnel: z.object({
      formStarted: controlCenterMetricSchema,
      formSubmitted: controlCenterMetricSchema,
      protocolActive: controlCenterMetricSchema,
      subscriptionActive: controlCenterMetricSchema,
    }),
    anamnesisFunnel: anamnesisFunnelSchema,
    acquisition: controlCenterMetricSchema,
    /** Cadastros por canal de origem, sob k-anonimato (n >= 10). Consumido pela US-8.6. */
    acquisitionChannels: z.array(acquisitionChannelSchema),
    /** Canais omitidos por caírem entre 1 e 9 cadastros. */
    suppressedChannels: z.number().int().nonnegative(),
    /** CAC, ROAS e LTV/CAC por canal (US-8.6). Só canais publicáveis sob k-anonimato. */
    channelEconomics: z.array(channelEconomicsSchema),
    /** Janela de atribuição usada no numerador de conversão. Sempre visível na tela. */
    attributionWindowDays: z.number().int().positive(),
    /** Coortes de entrada com pelo menos `MATURE_COHORT_MONTHS` de maturidade. */
    matureCohorts: z.number().int().nonnegative(),
    /** Investimento total em mídia registrado em `ad_spend`, líquido de estornos. */
    mediaInvestmentBrl: z.number(),
    /** Sessões anteriores à US-8.2, sem origem capturada. Nunca inferidas como orgânicas. */
    attributionNotCaptured: z.number().int().nonnegative(),
    /** Funil trial→ativo e tempo mediano até a conversão (US-8.3). */
    trialConversion: controlCenterTrialConversionSchema,
    segments: z.array(marketingSegmentSchema),
    /** Cadastros iniciados por dia da semana × hora, grade 7x24 completa. */
    signupSeasonality: z.array(controlCenterHeatmapCellSchema),
    suppressedSegments: z.number().int().nonnegative(),
    minimumSegmentSize: z.literal(10),
  }),
  meta: controlCenterMetaSchema,
});
export type ControlCenterMarketingResponse = z.infer<typeof controlCenterMarketingResponseSchema>;

const nullableText = z.string().nullable();

/**
 * Sinal de risco **comercial** de cancelamento. Nunca é leitura sobre a saúde da
 * pessoa — a nomenclatura é estritamente comercial (US-7.4, TASK-7.4.5).
 */
export const churnRiskSignalSchema = z.object({
  code: z.enum(['SEM_MENSAGEM', 'CHECKIN_SEM_RESPOSTA', 'RENOVACAO_PROXIMA']),
  /** Texto já pronto para leitura, com o número que disparou o sinal. */
  label: z.string().min(1),
});
export type ChurnRiskSignal = z.infer<typeof churnRiskSignalSchema>;

export const churnRiskSchema = z.object({
  /** Quantidade de sinais disparados (0..3). Não é probabilidade nem score treinado. */
  score: z.number().int().min(0).max(3),
  signals: z.array(churnRiskSignalSchema),
});
export type ChurnRisk = z.infer<typeof churnRiskSchema>;

export const controlCenterStudentSummarySchema = z.object({
  id: z.uuid(),
  name: nullableText,
  email: nullableText,
  phoneNumber: z.string(),
  status: z.string(),
  subscriptionStatus: nullableText,
  protocolStatus: nullableText,
  churnRisk: churnRiskSchema,
});

/**
 * North Star do produto (US-8.1 / TASK-8.1.5): treinos concluídos por usuário pago nos
 * primeiros 30 dias, meta ≥8 (`08-relatorio-lucas.md`).
 *
 * `reportingRate` **não é decoração**: se metade da coorte nunca respondeu o quick
 * reply, `averageCompletions` é um piso, não uma medida — e a tela precisa dizer isso.
 * `bySource` existe para que, meses depois, dê para distinguir "o aluno treinou mais"
 * de "o canal de captura melhorou".
 */
export const controlCenterNorthStarSchema = z.object({
  /** Média de treinos registrados na janela de 30 dias da coorte paga. Meta ≥ `target`. */
  averageCompletions: controlCenterMetricSchema,
  target: z.number().int().positive(),
  /** % da coorte com ao menos 1 treino registrado no período. */
  reportingRate: controlCenterMetricSchema,
  cohortSize: z.number().int().nonnegative(),
  bySource: z.array(
    z.object({
      source: z.enum(['WHATSAPP_QUICK_REPLY', 'CHECKIN', 'CONVERSATION']),
      completions: z.number().int().nonnegative(),
    }),
  ),
});
export type ControlCenterNorthStar = z.infer<typeof controlCenterNorthStarSchema>;

export const controlCenterStudentsResponseSchema = z.object({
  data: z.object({
    students: z.array(controlCenterStudentSummarySchema),
    /** Respostas bloqueadas pela validação de compliance, no agregado da base. */
    aiBlockedRate: controlCenterMetricSchema,
    /** Adesão **verificada** (US-8.1). Coexiste com a declarada, não a substitui. */
    northStar: controlCenterNorthStarSchema,
    /**
     * Adesão **declarada** da Sprint 7: % de check-ins enviados que foram respondidos.
     * Proxy de engajamento, não de treino executado — mantida nomeada ao lado da North
     * Star porque a divergência entre as duas é informação.
     */
    declaredAdherenceRate: controlCenterMetricSchema,
  }),
  meta: controlCenterMetaSchema,
});
export type ControlCenterStudentsResponse = z.infer<typeof controlCenterStudentsResponseSchema>;

/** Item da timeline única do aluno (US-7.4, TASK-7.4.1). */
export const controlCenterTimelineEventSchema = z.object({
  at: z.iso.datetime(),
  kind: z.enum(['ANAMNESIS', 'PROTOCOL', 'CHECKIN', 'CONVERSATION', 'SUBSCRIPTION', 'HANDOFF']),
  title: z.string().min(1),
  detail: nullableText,
});
export type ControlCenterTimelineEvent = z.infer<typeof controlCenterTimelineEventSchema>;

/** Ponto da evolução **declarada** pelo aluno no check-in. Dado de saúde. */
export const controlCenterEvolutionPointSchema = z.object({
  week: z.number().int().positive(),
  at: z.iso.datetime(),
  /** Percepção de esforço declarada (proxy de RPE). */
  fatigue: nullableText,
  /** Treinos declarados na semana — declaração, não execução verificada. */
  workouts: nullableText,
  /** Pedido de ajuste de carga declarado. */
  adjustment: nullableText,
});
export type ControlCenterEvolutionPoint = z.infer<typeof controlCenterEvolutionPointSchema>;

export const controlCenterStudentDetailResponseSchema = z.object({
  data: z.object({
    student: controlCenterStudentSummarySchema.extend({
      requiresProfessionalReview: z.boolean(),
      anamnesisStatus: nullableText,
      currentProtocol: z
        .object({
          id: z.uuid(),
          version: z.number().int().positive(),
          currentWeek: z.number().int().positive(),
          totalWeeks: z.number().int().positive(),
          signedAt: z.iso.datetime().nullable(),
        })
        .nullable(),
      /**
       * Origem do primeiro toque (US-8.2). `null` para cadastro anterior à Sprint 8 —
       * a UI rotula como "não capturada", nunca como orgânico (seria inferência falsa).
       */
      acquisition: z
        .object({
          channel: z.string().min(1),
          mapped: z.boolean(),
          raw: z.string().min(1),
          campaign: nullableText,
          content: nullableText,
          referrerHost: nullableText,
          capturedAt: z.iso.datetime(),
        })
        .nullable(),
      routine: z
        .object({
          primaryGoal: nullableText,
          trainingStatus: nullableText,
          experience: nullableText,
          daysPerWeek: z.number().int().nullable(),
          preferredDays: z.array(z.string()),
          sessionDuration: nullableText,
          location: nullableText,
          preferredPeriod: nullableText,
        })
        .nullable(),
      workoutHistory: z.object({
        status: z.literal('UNAVAILABLE'),
        reason: z.string(),
      }),

      /** Timeline única, do evento mais recente para o mais antigo. */
      timeline: z.array(controlCenterTimelineEventSchema),

      /** Adesão **declarada**: responder ao check-in, não treino verificado. */
      adherence: z.object({
        checkinsSent: z.number().int().nonnegative(),
        checkinsResponded: z.number().int().nonnegative(),
        responseRate: controlCenterMetricSchema,
      }),

      /** Respostas bloqueadas pela validação de compliance neste aluno. */
      aiQuality: z.object({
        blockedRate: controlCenterMetricSchema,
        blocked: z.number().int().nonnegative(),
        validated: z.number().int().nonnegative(),
        /** Ocorrências anonimizadas pelo PII Scrubber. Vazio sem `STUDENTS_HEALTH_READ`. */
        occurrences: z.array(z.object({ at: z.iso.datetime(), content: z.string() })),
      }),

      /**
       * Seção de saúde (LGPD Art. 11). **`null` — e nenhum campo dela no payload —**
       * para quem não tem `control_center.students.health.read`.
       */
      health: z
        .object({
          parqState: nullableText,
          painReports: z.array(
            z.object({ at: z.iso.datetime(), week: z.number().int(), text: z.string() }),
          ),
          evolution: z.array(controlCenterEvolutionPointSchema),
        })
        .nullable(),
    }),
  }),
  meta: controlCenterMetaSchema,
});
export type ControlCenterStudentDetailResponse = z.infer<
  typeof controlCenterStudentDetailResponseSchema
>;

/** p50/p95/p99 de uma distribuição de latência (`percentile_cont` no Postgres). */
export const controlCenterPercentilesSchema = z.object({
  samples: z.number().int().nonnegative(),
  p50: controlCenterMetricSchema,
  p95: controlCenterMetricSchema,
  p99: controlCenterMetricSchema,
});
export type ControlCenterPercentiles = z.infer<typeof controlCenterPercentilesSchema>;

/** Recorte de latência de IA por modelo efetivo e tipo de job — leitura de engenharia. */
export const controlCenterAiLatencySliceSchema = z.object({
  model: z.string(),
  jobType: z.string(),
  samples: z.number().int().nonnegative(),
  p50: z.number().finite().nullable(),
  p95: z.number().finite().nullable(),
  p99: z.number().finite().nullable(),
});
export type ControlCenterAiLatencySlice = z.infer<typeof controlCenterAiLatencySliceSchema>;

export const controlCenterSloStatusSchema = z.enum(['GREEN', 'YELLOW', 'RED', 'UNKNOWN']);
export type ControlCenterSloStatus = z.infer<typeof controlCenterSloStatusSchema>;

/**
 * Um SLO do board didático. `title`/`objective`/`explanation` são escritos em
 * linguagem de negócio de propósito: o leitor desta tela pode não ser engenheiro.
 * `errorBudgetConsumedPercent` acima de 100 significa meta estourada no período.
 */
export const controlCenterSloSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().min(1),
  explanation: z.string().min(1),
  targetPercent: z.number().finite(),
  currentPercent: z.number().finite().nullable(),
  samples: z.number().int().nonnegative(),
  errorBudgetConsumedPercent: z.number().finite().nullable(),
  status: controlCenterSloStatusSchema,
});
export type ControlCenterSlo = z.infer<typeof controlCenterSloSchema>;

/** Indicador que ainda não existe, com a dependência e a sprint que o destrava. */
export const controlCenterPendingCapabilitySchema = z.object({
  title: z.string().min(1),
  reason: z.string().min(1),
  dependency: z.string().min(1),
  plannedFor: z.string().min(1),
});
export type ControlCenterPendingCapability = z.infer<typeof controlCenterPendingCapabilitySchema>;

export const controlCenterSystemResponseSchema = z.object({
  data: z.object({
    databaseLatency: controlCenterMetricSchema,
    redisLatency: controlCenterMetricSchema,
    aiJobs: controlCenterMetricSchema,
    aiFailures: controlCenterMetricSchema,
    aiDlq: controlCenterMetricSchema,
    /** Tempo de modelo: só a chamada de LLM, medida em `ai_jobs.latency_ms`. */
    aiLatency: controlCenterPercentilesSchema,
    aiLatencyByModel: z.array(controlCenterAiLatencySliceSchema),
    aiLatencyP95Daily: z.array(controlCenterTimeSeriesPointSchema),
    /** Tempo sentido pelo aluno no WhatsApp: `conversations.latency_ms`. */
    whatsappLatency: controlCenterPercentilesSchema,
    whatsappLatencyP95Daily: z.array(controlCenterTimeSeriesPointSchema),
    ragQueries: controlCenterMetricSchema,
    ragUsefulRetrievalRate: controlCenterMetricSchema,
    ragCorpusChunks: controlCenterMetricSchema,
    /** Entre 3 e 5 semáforos — o board só é legível enquanto for curto. */
    slos: z.array(controlCenterSloSchema).min(3).max(5),
    pendingCapabilities: z.array(controlCenterPendingCapabilitySchema),
  }),
  meta: controlCenterMetaSchema,
});
export type ControlCenterSystemResponse = z.infer<typeof controlCenterSystemResponseSchema>;

/** Mês civil `YYYY-MM` em `America/Sao_Paulo`. */
const monthKey = z.string().regex(/^\d{4}-\d{2}$/);

/** Uma linha do calendário de renovação: quanto vence, de qual plano, em qual mês. */
export const controlCenterRenewalSliceSchema = z.object({
  month: monthKey,
  plan: z.string(),
  subscriptions: z.number().int().nonnegative(),
  /** Soma do preço contratado das assinaturas que vencem no mês, em reais. */
  amountBrl: z.number().nonnegative(),
});

/**
 * Assinatura que vence em 30 dias com sinal de risco. Sem PII do titular — o
 * pilar Financeiro não devolve identidade; a ação de retenção parte do id.
 */
export const controlCenterRenewalRiskSchema = z.object({
  subscriptionId: z.uuid(),
  plan: z.string(),
  currentPeriodEnd: z.iso.datetime(),
  amountBrl: z.number().nonnegative(),
  /** Texto do sinal que motivou o alerta (ex.: silêncio de N dias). */
  riskSignal: z.string().min(1),
});

export const controlCenterChurnReasonSchema = z.object({
  /** `cancel_reason` declarado; `NAO_INFORMADO` quando a coluna é nula. */
  reason: z.string(),
  total: z.number().int().nonnegative(),
  last90Days: z.number().int().nonnegative(),
});

export const controlCenterPlanRevenueSchema = z.object({
  plan: z.string(),
  activeSubscriptions: z.number().int().nonnegative(),
  /** Preço contratado normalizado para um mês. */
  mrrBrl: z.number().nonnegative(),
  /** `mrrBrl * 12`. */
  arrBrl: z.number().nonnegative(),
});

export const controlCenterAiModelCostSchema = z.object({
  model: z.string(),
  jobs: z.number().int().nonnegative(),
  tokensInput: z.number().int().nonnegative(),
  tokensOutput: z.number().int().nonnegative(),
  /** Nulo quando o modelo não está na tabela de preço versionada em código. */
  costBrl: z.number().nonnegative().nullable(),
});

/**
 * Retenção por coorte mensal de entrada (US-8.3, TASK-8.3.4). Coortes com menos de 10
 * entradas nunca aparecem — a supressão é contada em `suppressedCohorts`.
 */
export const controlCenterEntryCohortSchema = z.object({
  /** Mês civil da primeira entrada em trial, `YYYY-MM` no fuso do painel. */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  cohortSize: kAnonymousCount,
  converted: z.number().int().nonnegative(),
  conversionRatePercent: z.number().min(0).max(100),
  /** Titulares da coorte com assinatura hoje `ACTIVE`. */
  retained: z.number().int().nonnegative(),
  retentionPercent: z.number().min(0).max(100),
  /**
   * `true` quando alguma entrada da coorte veio do backfill (`actor = 'BACKFILL'`), ou seja,
   * foi **reconstruída** a partir das datas de `subscriptions` e não observada. A UI precisa
   * distinguir visualmente — uma coorte reconstruída não é comparável com uma observada sem ressalva.
   */
  reconstructed: z.boolean(),
});
export type ControlCenterEntryCohort = z.infer<typeof controlCenterEntryCohortSchema>;

/** Custo agregado por categoria de despesa (US-8.4). Pode ser negativo se houver mais estorno que lançamento no recorte. */
export const controlCenterCostByCategorySchema = z.object({
  category: expenseCategorySchema,
  amountBrl: z.number(),
});

/** Custo agregado por mês de competência (`YYYY-MM`). */
export const controlCenterCostByMonthSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  amountBrl: z.number(),
});

/**
 * Receita **recebida** por mês (US-8.5), do que efetivamente liquidou no gateway.
 *
 * Série separada de `renewalCalendar` (receita **contratada**) de propósito: são grandezas
 * diferentes — a diferença entre elas é inadimplência, falha de cartão e prazo de
 * liquidação. Somar as duas produziria um número que não existe (regra 3 da Sprint 8), e a
 * separação em dois contratos distintos é o que torna a soma indevida impossível na tela.
 */
export const controlCenterReceivedByMonthSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  /** Bruto liquidado, já líquido de estornos (estorno é linha negativa). */
  grossBrl: z.number(),
  /** Bruto menos a taxa do gateway — o que de fato entrou na conta. */
  netBrl: z.number(),
  /** Quantidade de eventos liquidados no mês. */
  settlements: z.number().int().nonnegative(),
});
export type ControlCenterReceivedByMonth = z.infer<typeof controlCenterReceivedByMonthSchema>;

/**
 * Fila de exceção da conciliação (US-8.5 / TASK-8.5.3): liquidação **autenticada** cuja
 * assinatura não foi encontrada. Existe para que esse evento nunca seja descartado em
 * silêncio — ele fica gravado em `payments` com titular nulo e aparece aqui.
 *
 * Sem PII do titular por construção: se houvesse titular, não seria exceção.
 */
export const controlCenterPaymentExceptionSchema = z.object({
  paymentId: z.uuid(),
  gateway: z.string(),
  status: z.string(),
  amountBrl: z.number(),
  occurredAt: z.string(),
  receivedAt: z.string(),
});
export type ControlCenterPaymentException = z.infer<typeof controlCenterPaymentExceptionSchema>;

export const controlCenterFinanceResponseSchema = z.object({
  data: z.object({
    activeSubscriptions: controlCenterMetricSchema,
    contractedMrr: controlCenterMetricSchema,
    aiCost: controlCenterMetricSchema,
    aiCostPerActiveUser: controlCenterMetricSchema,
    whatsappCost: controlCenterMetricSchema,
    infrastructureCost: controlCenterMetricSchema,
    receivedRevenue: controlCenterMetricSchema,
    profit: controlCenterMetricSchema,
    partnerDistribution: controlCenterMetricSchema,
    customerAcquisitionCost: controlCenterMetricSchema,
    revenueAtRisk30d: controlCenterMetricSchema,
    /** Coorte mensal de entrada com conversão e retenção (US-8.3). */
    entryCohorts: z.array(controlCenterEntryCohortSchema),
    /** Coortes omitidas por terem menos de 10 entradas. */
    suppressedCohorts: z.number().int().nonnegative(),
    renewalCalendar: z.array(controlCenterRenewalSliceSchema),
    subscriptionsAtRisk: z.array(controlCenterRenewalRiskSchema),
    churnByReason: z.array(controlCenterChurnReasonSchema),
    mrrByPlan: z.array(controlCenterPlanRevenueSchema),
    aiCostByModel: z.array(controlCenterAiModelCostSchema),
    /** Despesa do mês corrente, líquida de estornos (US-8.4). */
    totalExpense: controlCenterMetricSchema,
    /** Custo por usuário ativo/mês — o número do unit economics de Eduardo. */
    expensePerActiveUser: controlCenterMetricSchema,
    costByCategory: z.array(controlCenterCostByCategorySchema),
    costByMonth: z.array(controlCenterCostByMonthSchema),

    // ---- Liquidação recebida (US-8.5) ----
    /**
     * Receita **recebida** por mês. Vive ao lado de `renewalCalendar` (contratada) e
     * **nunca** é somada com ela — ver `controlCenterReceivedByMonthSchema`.
     */
    receivedRevenueByMonth: z.array(controlCenterReceivedByMonthSchema),
    /**
     * Inadimplência do período: cobranças que falharam sobre o total de tentativas
     * (falhas + liquidações) no mês corrente.
     */
    delinquencyRate: controlCenterMetricSchema,
    /** Prazo médio, em dias, entre o início do período contratado e a liquidação. */
    averageSettlementDays: controlCenterMetricSchema,
    /** Taxa retida pelo gateway no mês, em R$. É custo real e entra em `costByCategory`. */
    gatewayFee: controlCenterMetricSchema,
    /** A mesma taxa como % do bruto liquidado. `UNAVAILABLE` se o provedor não informa taxa. */
    gatewayFeePercent: controlCenterMetricSchema,
    /** Liquidações sem assinatura correspondente — nunca descartadas, sempre visíveis. */
    paymentExceptions: z.array(controlCenterPaymentExceptionSchema),
    /**
     * Regime de apuração do `profit` exibido. `CONTRATADO_PROXY` enquanto `payments`
     * (US-8.5) não existir — a tela precisa declarar isso, nunca chamar de caixa o que
     * não é. A **projeção** de resultado segue fora de escopo (Sprint 11).
     */
    profitBasis: profitBasisSchema,
  }),
  meta: controlCenterMetaSchema,
});
export type ControlCenterFinanceResponse = z.infer<typeof controlCenterFinanceResponseSchema>;

export const controlCenterAuditEventSchema = z.object({
  id: z.number().int().nonnegative(),
  actorId: z.uuid(),
  subjectId: z.uuid(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.uuid(),
  createdAt: z.iso.datetime(),
});

export const controlCenterComplianceResponseSchema = z.object({
  data: z.object({
    activeConsents: controlCenterMetricSchema,
    revokedConsents: controlCenterMetricSchema,
    auditedHealthReads: controlCenterMetricSchema,
    privacyRequests: controlCenterMetricSchema,
    recentAuditEvents: z.array(controlCenterAuditEventSchema),
  }),
  meta: controlCenterMetaSchema,
});
export type ControlCenterComplianceResponse = z.infer<typeof controlCenterComplianceResponseSchema>;

export const destructiveActionDeniedSchema = z.object({
  code: z.literal('STEP_UP_REQUIRED_NOT_IMPLEMENTED'),
  status: z.literal('UNAVAILABLE'),
  message: z.string(),
});
export type DestructiveActionDenied = z.infer<typeof destructiveActionDeniedSchema>;
