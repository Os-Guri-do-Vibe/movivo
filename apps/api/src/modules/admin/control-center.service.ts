import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  anamnesisStructuredSchema,
  createWhatsappInstanceSchema,
  type ControlCenterIntegrationResponse,
  attributionLabel,
  canonicalChannel,
  UNMAPPED_CHANNEL,
  ATTRIBUTION_WINDOW_DAYS,
  MATURE_COHORT_MONTHS,
  LTV_TO_CAC_TARGET,
  PAYBACK_TARGET_MONTHS,
  type AcquisitionChannel,
  type ChannelEconomics,
  type CampaignEconomics,
  type ControlCenterCampaignsResponse,
  type ChannelSignal,
  preferredPeriodSchema,
  primaryGoalSchema,
  trainingLocationSchema,
  ControlCenterCapability as Capability,
  ProfitBasis,
  type ExpenseCategory,
  type ControlCenterEvolutionPoint,
  type ControlCenterEntryCohort,
  type ControlCenterFinanceResponse,
  type ControlCenterMarketingResponse,
  type ControlCenterMetric,
  type ControlCenterTrialConversion,
  type ControlCenterNorthStar,
  type ControlCenterOverviewResponse,
  type ControlCenterPillarSummary,
  type ControlCenterStudentDetailResponse,
  type ControlCenterStudentsResponse,
  type ControlCenterSystemResponse,
  type ControlCenterTimelineEvent,
  type ControlCenterComplianceResponse,
} from '@movivo/shared';
import { and, count, desc, eq, gte, isNotNull, isNull, sql, type SQLWrapper } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { z } from 'zod';

import { AgentConfigRepository } from '../../core/agent-config/agent-config.repository';
import { DatabaseHealthService } from '../../core/database';
import { HealthCipherService } from '../../core/database/health-cipher.service';
import {
  adSpend,
  aiJobs,
  anamnesisSessions,
  auditLogs,
  checkins,
  consents,
  conversations,
  expenses,
  handoffAlerts,
  knowledgeBase,
  payments,
  protocols,
  protocolVersions,
  subscriptions,
  users,
  userStatusTransitions,
  workoutCompletions,
} from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import {
  REDIS_CLIENT,
  REDIS_KEY_BUILDER,
  RedisHealthService,
  type RedisKeyBuilder,
} from '../../core/redis';
import { ragUsageDay, ragUsageKeys } from '../ai-coach/rag/rag-usage.keys';
import { scrubPII } from '../ai-coach/llm/pii-scrubber';
import { roleHasCapabilities } from '../auth/capabilities';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { EVOLUTION_TRANSPORT, type EvolutionTransport } from '../whatsapp/evolution-transport';
import { AuditService } from './audit.service';
import { assessChurnRisk, CHURN_RISK_THRESHOLDS } from './churn-risk';
import { buildFinancialProjection } from './financial-projection';

const TIMEZONE = 'America/Sao_Paulo' as const;
const MINIMUM_SEGMENT_SIZE = 10;
/** North Star do produto (US-8.1): treinos concluidos nos primeiros 30 dias pagos, meta >=8. */
const NORTH_STAR_WINDOW_DAYS = 30;
const NORTH_STAR_TARGET = 8;
/** Horizonte do calendário de renovação (US-7.2). */
const RENEWAL_HORIZON_DAYS = 90;
/** Recorte de receita em risco dentro do calendário. */
const AT_RISK_WINDOW_DAYS = 30;
/**
 * Sinal de risco desta US, deliberadamente simples e independente: assinatura que
 * vence em 30 dias e cujo titular não manda mensagem há tantos dias. A heurística
 * composta de risco é da US-7.4 e não é dependência daqui.
 */
const RISK_SILENCE_DAYS = 14;
/** Janela de apuração de custo de IA e de churn recente. */
const AI_COST_WINDOW_DAYS = 30;

/**
 * Meses de contrato por plano — divisor que normaliza preço contratado em MRR.
 * Fórmula: `MRR = preço do plano / meses do plano`; `ARR = MRR * 12`.
 */
const PLAN_MONTHS: Record<string, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

/**
 * Câmbio USD→BRL. Continua constante em código: `model_pricing` guarda preço em moeda
 * do provedor (USD), não taxa de câmbio — cotação diária é problema de outra sprint.
 * // TODO: confirmar câmbio com Eduardo/Henrique.
 */
const USD_TO_BRL = 5.4;

/**
 * Preço de LLM — **origem trocada na US-8.4 / TASK-8.4.3**: era a constante versionada em
 * código da TASK-7.2.3, agora vem da tabela `model_pricing`, versionada por vigência.
 *
 * O casamento por prefixo (`gpt-4.1` casa `gpt-4.1-2025-04-14`, e `gpt-4.1-mini` ganha de
 * `gpt-4.1` por ser o prefixo mais longo) era feito em TS e agora é o `order by length`
 * do LATERAL. A vigência é comparada com a **data do job**, não com hoje: mudar o preço
 * hoje não altera o custo apurado de mês passado.
 */
const AI_PRICE_LATERAL = sql`left join lateral (
  select mp.input_price_per_1k_cents as input_cents, mp.output_price_per_1k_cents as output_cents
  from model_pricing mp
  where lower(coalesce(${aiJobs.modelUsed}, '')) like mp.model || '%'
    and mp.valid_from <= (${aiJobs.createdAt} at time zone ${TIMEZONE})::date
    and (mp.valid_to is null or mp.valid_to > (${aiJobs.createdAt} at time zone ${TIMEZONE})::date)
  order by length(mp.model) desc, mp.valid_from desc
  limit 1
) price on true`;
/** Janela das séries e do mapa de calor da Visão Geral. */
const INSIGHT_WINDOW_DAYS = 30;
const DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Período padrão da timeline do aluno (US-7.4). */
const STUDENT_TIMELINE_DAYS = 180;

/**
 * Limiares de "atenção" da Visão Geral (US-7.8), cada um num único ponto e comentado —
 * mesmo padrão de `CHURN_RISK_THRESHOLDS`. Não são metas de negócio validadas; são o
 * gatilho de quando uma linha para de ser "OK" e passa a pedir atenção do fundador.
 * ponytail: constantes fixas, sem histórico para calibrar — revisar com dado real.
 */
const OVERVIEW_ATTENTION_THRESHOLDS = {
  /** Receita em risco (30d) acima disto já é motivo de olhar o Financeiro. */
  financeAtRiskBrl: 300,
  /** Taxa de conclusão da anamnese abaixo disto indica funil com problema. */
  marketingMinCompletionPercent: 40,
  /** Taxa de resposta bloqueada pela IA acima disto indica prompt/modelo falhando. */
  aiMaxBlockedPercent: 5,
  /**
   * US-8.8 — limiares das linhas novas. **Default a ser confirmado pelo fundador**,
   * mesmo tratamento dos limiares acima (a tela é dele):
   *  - lucro do período negativo é atenção. Zero não é: mês sem despesa lançada cai em
   *    `UNAVAILABLE` antes de chegar aqui.
   *  - CAC do canal principal acima disto quebra a meta LTV/CAC ≥ 3 de Eduardo para o
   *    plano mensal de R$ 39 (39 × 3 = 117). Vira atenção.
   */
  financeMinProfitBrl: 0,
  marketingMaxChannelCacBrl: 117,
} as const;

/**
 * Rótulo obrigatório da adesão (US-7.4, TASK-7.4.3): o que existe hoje é o aluno
 * **declarando** no check-in, não o treino concluído verificado — que depende de
 * `workout_completions` — que passou a existir na US-8.1 e sai na North Star, em campo
 * próprio. O rótulo continua porque as duas grandezas seguem diferentes (US-8.8).
 */
const DECLARED_ADHERENCE_NOTICE =
  'Adesão declarada via check-in: mede resposta ao check-in, não execução. Treino concluído verificado é medido à parte, na North Star (`workout_completions`).';

/** Forma persistida das respostas de check-in (`checkins.responses_cipher`). */
const checkinDeclaredSchema = z.object({
  fatigue: z.string().optional(),
  workouts: z.string().optional(),
  adjustment: z.string().optional(),
  painReport: z.string().optional(),
});

type MetricUnit = ControlCenterMetric['unit'];

@Injectable()
export class ControlCenterService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly databaseHealth: DatabaseHealthService,
    private readonly redisHealth: RedisHealthService,
    private readonly audit: AuditService,
    private readonly cipher: HealthCipherService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly redisKeys: RedisKeyBuilder,
    private readonly agentConfig: AgentConfigRepository,
    @Inject(EVOLUTION_TRANSPORT) private readonly evolution: EvolutionTransport,
  ) {}

  /**
   * Visão Geral (US-7.8): não tem métrica própria — resume os pilares. Uma linha por
   * pilar, cada uma reaproveitando o número que o próprio pilar já expõe (nunca um
   * cálculo paralelo que possa divergir do que a tela de destino mostra). Um pilar sem
   * capability **não entra no payload**: a linha nem é calculada, não só escondida.
   *
   * Os KPIs/gráficos/heatmap que a Visão Geral antiga acumulava foram redistribuídos ou
   * aposentados nesta US: `newStudentsDaily` perdeu razão de existir separado do funil e
   * da sazonalidade de cadastro que o Marketing já tem (US-7.3); `outboundMessagesDaily`/
   * `messageActivityHeatmap` cobriam volume de mensagem, hoje coberto pelo p95 de latência
   * de WhatsApp e pelo uso de RAG do pilar Sistema (US-7.5) — perda aceitável, não é dado
   * que se perde (continua em `conversations`), só não tem mais tela própria; se algum
   * fundador sentir falta do heatmap, ele é candidato natural a virar detalhe do pilar
   * Sistema num ticket futuro. `protocolsByApprovalStatus`/`pendingProtocolsQueue` viraram
   * o detalhe "fila do profissional" da linha Alunos. `criticalAlerts` (SAFETY + PAR-Q
   * bloqueado) segue existindo — é o sinal mais forte de `CRITICAL` que a plataforma tem.
   */
  async overview(actor: AuthenticatedUser): Promise<ControlCenterOverviewResponse> {
    const pillars: ControlCenterOverviewResponse['data']['pillars'] = [];

    if (roleHasCapabilities(actor.role, [Capability.STUDENTS_READ])) {
      pillars.push(await this.studentsPillarSummary(actor));
    }
    if (roleHasCapabilities(actor.role, [Capability.FINANCE_READ])) {
      pillars.push(await this.financePillarSummary());
    }
    if (roleHasCapabilities(actor.role, [Capability.MARKETING_READ])) {
      pillars.push(await this.marketingPillarSummary());
    }
    if (roleHasCapabilities(actor.role, [Capability.AI_CONFIG_READ])) {
      pillars.push(await this.aiPillarSummary());
    }
    if (roleHasCapabilities(actor.role, [Capability.SYSTEM_READ])) {
      pillars.push(await this.systemPillarSummary());
    }

    return this.envelope({ pillars }, [
      'Cada linha reaproveita o número que o próprio pilar de destino já exibe — nunca um cálculo paralelo.',
      'Um pilar sem a capability do papel não é calculado no servidor, não só escondido na tela.',
    ]);
  }

  private async studentsPillarSummary(
    actor: AuthenticatedUser,
  ): Promise<ControlCenterPillarSummary> {
    const students = await this.students(actor);
    const total = students.data.students.length;
    const atRisk = students.data.students.filter((student) => student.churnRisk.score > 0).length;

    let criticalAlerts = 0;
    if (roleHasCapabilities(actor.role, [Capability.STUDENTS_HEALTH_READ])) {
      const [alerts] = await this.db.runAsSystem((tx) =>
        tx
          .select({
            total: sql<number>`(
            count(*) filter (where ${handoffAlerts.status} = 'OPEN' and ${handoffAlerts.level} = 'SAFETY')
            + (select count(*) from ${anamnesisSessions}
               where ${anamnesisSessions.parqState} = 'BLOQUEADO_AGUARDANDO_CLEARANCE')
          )::int`,
          })
          .from(handoffAlerts),
      );
      criticalAlerts = alerts?.total ?? 0;
    }

    const state: ControlCenterPillarSummary['state'] =
      criticalAlerts > 0 ? 'CRITICAL' : atRisk > 0 ? 'ATTENTION' : 'OK';
    const reason =
      criticalAlerts > 0
        ? `${criticalAlerts} alerta(s) de segurança ou PAR-Q bloqueado aguardando decisão humana.`
        : atRisk > 0
          ? `${atRisk} aluno(s) com sinal de risco de cancelamento.`
          : null;

    return {
      pillar: 'STUDENTS',
      label: 'Alunos',
      state,
      href: '/dashboard/alunos',
      headline: {
        label: 'Alunos cadastrados',
        metric: this.metric(total, 'COUNT', 'AVAILABLE', 'Alunos visíveis no escopo do papel.'),
      },
      details: [
        // US-8.1 — North Star em número real. As três linhas vêm juntas de propósito:
        // a média sozinha, sem taxa de reporte, é lida como medida quando é piso.
        {
          label: `Treinos nos primeiros ${NORTH_STAR_WINDOW_DAYS} dias pagos (meta ≥${NORTH_STAR_TARGET})`,
          metric: students.data.northStar.averageCompletions,
        },
        {
          label: 'Taxa de reporte de treino',
          metric: students.data.northStar.reportingRate,
        },
        {
          label: 'Adesão declarada (resposta a check-in)',
          metric: students.data.declaredAdherenceRate,
        },
        {
          label: 'Em risco de cancelamento',
          metric: this.metric(
            atRisk,
            'COUNT',
            'AVAILABLE',
            'Alunos com ao menos um sinal de risco comercial (silêncio, check-in sem resposta ou renovação próxima).',
          ),
        },
        ...(roleHasCapabilities(actor.role, [Capability.STUDENTS_HEALTH_READ])
          ? [
              {
                label: 'Alertas de segurança e PAR-Q bloqueado',
                metric: this.metric(
                  criticalAlerts,
                  'COUNT',
                  'AVAILABLE' as const,
                  'Alertas SAFETY abertos mais PAR-Q bloqueado aguardando liberação humana.',
                ),
              },
            ]
          : []),
      ],
      reason,
    };
  }

  private async financePillarSummary(): Promise<ControlCenterPillarSummary> {
    const finance = await this.finance();
    const atRisk = finance.data.revenueAtRisk30d.value ?? 0;
    const churn90 = finance.data.churnByReason.reduce((sum, row) => sum + row.last90Days, 0);
    // US-8.8: lucro do período entra na linha-resumo. Lucro indisponível (sem despesa
    // lançada) não é atenção — é ausência de dado, e a métrica já diz isso na tela.
    const profit = finance.data.profit;
    const profitAttention =
      profit.value !== null && profit.value < OVERVIEW_ATTENTION_THRESHOLDS.financeMinProfitBrl;
    const attention = atRisk > OVERVIEW_ATTENTION_THRESHOLDS.financeAtRiskBrl || profitAttention;

    return {
      pillar: 'FINANCE',
      label: 'Financeiro',
      state: attention ? 'ATTENTION' : 'OK',
      href: '/dashboard/financeiro',
      headline: { label: 'MRR contratado', metric: finance.data.contractedMrr },
      details: [
        { label: 'Receita em risco (30 dias)', metric: finance.data.revenueAtRisk30d },
        { label: 'Lucro do período', metric: profit },
        {
          label: 'Cancelamentos (90 dias)',
          metric: this.metric(
            churn90,
            'COUNT',
            'AVAILABLE',
            'Assinaturas canceladas nos últimos 90 dias, somando todos os motivos declarados.',
          ),
        },
      ],
      reason: profitAttention
        ? 'Lucro do período negativo: a despesa lançada superou a receita.'
        : attention
          ? `Receita em risco nos próximos 30 dias acima de R$ ${OVERVIEW_ATTENTION_THRESHOLDS.financeAtRiskBrl}.`
          : null,
    };
  }

  private async marketingPillarSummary(): Promise<ControlCenterPillarSummary> {
    const marketing = await this.marketing();
    const started = marketing.data.funnel.formStarted.value ?? 0;
    const submitted = marketing.data.funnel.formSubmitted.value ?? 0;
    const completionRate = started > 0 ? (submitted / started) * 100 : null;
    // US-8.8: "canal principal" = o canal publicável com mais cadastros; se ele não tem
    // investimento em mídia, o CAC dele já vem UNAVAILABLE com o motivo (US-8.6) e a linha
    // exibe isso em vez de escolher outro canal só para ter número.
    const mainChannel = marketing.data.channelEconomics.reduce<ChannelEconomics | null>(
      (best, row) => (best === null || row.students > best.students ? row : best),
      null,
    );
    const cacAttention =
      mainChannel !== null &&
      mainChannel.cac.value !== null &&
      mainChannel.cac.value > OVERVIEW_ATTENTION_THRESHOLDS.marketingMaxChannelCacBrl;
    const attention =
      cacAttention ||
      (completionRate !== null &&
        completionRate < OVERVIEW_ATTENTION_THRESHOLDS.marketingMinCompletionPercent);

    return {
      pillar: 'MARKETING',
      label: 'Marketing',
      state: attention ? 'ATTENTION' : 'OK',
      href: '/dashboard/analytics',
      headline: { label: 'Cadastros iniciados', metric: marketing.data.funnel.formStarted },
      details: [
        {
          label: 'Taxa de conclusão da anamnese',
          metric:
            completionRate === null
              ? this.unavailable(
                  'PERCENT',
                  'Sem cadastros iniciados no período para calcular taxa.',
                )
              : this.metric(
                  completionRate,
                  'PERCENT',
                  'AVAILABLE',
                  'Formulários enviados sobre formulários iniciados.',
                ),
        },
        {
          label:
            mainChannel === null
              ? 'CAC do canal principal'
              : `CAC do canal principal (${mainChannel.channel})`,
          metric:
            mainChannel === null
              ? this.unavailable(
                  'BRL',
                  'Nenhum canal de origem atingiu o mínimo de cadastros para ser publicado.',
                )
              : mainChannel.cac,
        },
      ],
      reason: cacAttention
        ? `CAC do canal principal acima de R$ ${OVERVIEW_ATTENTION_THRESHOLDS.marketingMaxChannelCacBrl}, o teto que a meta LTV/CAC ≥ ${LTV_TO_CAC_TARGET} admite.`
        : attention
          ? `Taxa de conclusão da anamnese abaixo de ${OVERVIEW_ATTENTION_THRESHOLDS.marketingMinCompletionPercent}%.`
          : null,
    };
  }

  private async aiPillarSummary(): Promise<ControlCenterPillarSummary> {
    const since = new Date(Date.now() - INSIGHT_WINDOW_DAYS * 86_400_000);
    const [row] = await this.db.runAsSystem((tx) =>
      tx
        .select({
          total: sql<number>`count(*) filter (where ${conversations.direction} = 'OUTBOUND')::int`,
          blocked: sql<number>`count(*) filter (where ${conversations.validationPassed} = false)::int`,
          validated: sql<number>`count(*) filter (where ${conversations.validationPassed} is not null)::int`,
        })
        .from(conversations)
        .where(gte(conversations.createdAt, since)),
    );
    // Sprint 11: duas personas publicáveis (uma por público). O card do panorama deixou de
    // poder dizer "versão vigente" no singular — passa a contar quantos dos dois slots já
    // têm persona própria, com as versões no detalhe. Zero slots publicados continua sendo
    // o único caso `UNAVAILABLE` (aí a IA responde com o default de código).
    const [malePersona, femalePersona] = await Promise.all([
      this.agentConfig.activePayload('MALE'),
      this.agentConfig.activePayload('FEMALE'),
    ]);
    const publishedSlots = [malePersona, femalePersona].filter(Boolean).length;
    const blockedRate = this.blockedRate(row?.blocked ?? 0, row?.validated ?? 0);
    const attention =
      blockedRate.value !== null &&
      blockedRate.value > OVERVIEW_ATTENTION_THRESHOLDS.aiMaxBlockedPercent;

    return {
      pillar: 'AI',
      label: 'IA',
      state: attention ? 'ATTENTION' : 'OK',
      href: '/dashboard/ia/agente',
      headline: {
        label: `Conversas (${INSIGHT_WINDOW_DAYS} dias)`,
        metric: this.metric(
          row?.total ?? 0,
          'COUNT',
          'AVAILABLE',
          `Mensagens enviadas pela plataforma nos últimos ${INSIGHT_WINDOW_DAYS} dias.`,
        ),
      },
      details: [
        { label: 'Taxa de resposta bloqueada pela validação', metric: blockedRate },
        {
          label: 'Personas publicadas',
          metric: this.metric(
            publishedSlots,
            'COUNT',
            publishedSlots > 0 ? 'AVAILABLE' : 'UNAVAILABLE',
            publishedSlots > 0
              ? `Masculina: ${malePersona ? `versão ${malePersona.version}` : 'não publicada'}. ` +
                  `Feminina: ${femalePersona ? `versão ${femalePersona.version}` : 'não publicada'}. ` +
                  (publishedSlots === 1
                    ? 'O público sem persona própria recebe a do outro por enquanto.'
                    : '')
              : 'Nenhuma configuração publicada; a IA responde com o default de código.',
          ),
        },
      ],
      reason: attention
        ? `Taxa de resposta bloqueada pela validação acima de ${OVERVIEW_ATTENTION_THRESHOLDS.aiMaxBlockedPercent}%.`
        : null,
    };
  }

  private async systemPillarSummary(): Promise<ControlCenterPillarSummary> {
    const system = await this.system();
    const rank: Record<(typeof system.data.slos)[number]['status'], number> = {
      RED: 3,
      YELLOW: 2,
      UNKNOWN: 1,
      GREEN: 0,
    };
    const worst = system.data.slos.reduce((worstSlo, slo) =>
      rank[slo.status] > rank[worstSlo.status] ? slo : worstSlo,
    );
    const state: ControlCenterPillarSummary['state'] =
      worst.status === 'RED' ? 'CRITICAL' : worst.status === 'YELLOW' ? 'ATTENTION' : 'OK';

    return {
      pillar: 'SYSTEM',
      label: 'Sistema',
      state,
      href: '/dashboard/sistema',
      headline: {
        label: worst.title,
        metric: this.metric(
          worst.currentPercent ?? 0,
          'PERCENT',
          worst.currentPercent === null ? 'UNAVAILABLE' : 'AVAILABLE',
          worst.objective,
        ),
      },
      details: [
        {
          label: 'Orçamento de erro consumido',
          metric:
            worst.errorBudgetConsumedPercent === null
              ? this.unavailable('PERCENT', 'Sem amostra no período para este SLO.')
              : this.metric(
                  worst.errorBudgetConsumedPercent,
                  'PERCENT',
                  'AVAILABLE',
                  'Quanto da margem de erro permitida pela meta já foi consumido no período.',
                ),
        },
      ],
      reason: state === 'OK' ? null : `${worst.title}: fora da meta (${worst.objective}).`,
    };
  }

  async marketing(): Promise<ControlCenterMarketingResponse> {
    const result = await this.db.runAsSystem(async (tx) => {
      const [funnel] = await tx
        .select({
          formStarted: sql<number>`count(distinct ${anamnesisSessions.id})::int`,
          formSubmitted: sql<number>`count(distinct ${anamnesisSessions.id}) filter (where ${anamnesisSessions.submittedAt} is not null)::int`,
          protocolActive: sql<number>`count(distinct ${protocols.userId}) filter (where ${protocols.status} = 'ACTIVE')::int`,
          subscriptionActive: sql<number>`count(distinct ${subscriptions.userId}) filter (where ${subscriptions.status} = 'ACTIVE')::int`,
        })
        .from(anamnesisSessions)
        .leftJoin(protocols, eq(protocols.userId, anamnesisSessions.userId))
        .leftJoin(subscriptions, eq(subscriptions.userId, anamnesisSessions.userId));

      const anamnesisFunnel = await this.anamnesisFunnel(tx);
      const trialConversion = await this.trialConversion(tx);

      const seasonalityRows = await tx
        .select({
          dayOfWeek: this.localPart('dow', anamnesisSessions.createdAt),
          hour: this.localPart('hour', anamnesisSessions.createdAt),
          total: count(),
        })
        .from(anamnesisSessions)
        .where(
          gte(anamnesisSessions.createdAt, new Date(Date.now() - INSIGHT_WINDOW_DAYS * 86_400_000)),
        )
        // group by ordinal: repetir a expressão em select e groupBy reemite os
        // parâmetros do fuso e o Postgres recusa o GROUP BY (ver overview()).
        .groupBy(sql`1`, sql`2`);

      const dimensions = [
        ['PRIMARY_GOAL', 'primaryGoal', primaryGoalSchema],
        ['TRAINING_LOCATION', 'location', trainingLocationSchema],
        ['PREFERRED_PERIOD', 'preferredPeriod', preferredPeriodSchema],
      ] as const;
      const segments: ControlCenterMarketingResponse['data']['segments'] = [];
      let suppressedSegments = 0;
      for (const [dimension, jsonKey, valueSchema] of dimensions) {
        const value = sql<string>`${anamnesisSessions.dataBlock3}->>${jsonKey}`;
        const rows = await tx
          .select({ value, total: count() })
          .from(anamnesisSessions)
          .where(and(isNotNull(anamnesisSessions.dataBlock3), sql`${value} is not null`))
          .groupBy(value);
        const validRows = rows.filter((row) => valueSchema.safeParse(row.value).success);
        suppressedSegments += rows.length - validRows.length;
        if (validRows.some((row) => row.total < MINIMUM_SEGMENT_SIZE)) {
          // Supressão primária isolada permite recompor a célula pequena por
          // diferença. Omitir a dimensão inteira é conservador, mas elimina o
          // complemento inferível sem inventar ruído estatístico no MVP.
          suppressedSegments += validRows.length;
          continue;
        }
        for (const row of validRows) {
          segments.push({ dimension, value: row.value, count: row.total });
        }
      }

      // Faixa etária derivada de `data_block_1->>'birthDate'` (etapa 1, dado comum,
      // não cifrado). A faixa já é a generalização: a data exata nunca sai da query.
      const birthDate = sql<string>`${anamnesisSessions.dataBlock1}->>'birthDate'`;
      const ageBand = sql<string>`case
        when extract(year from age((${birthDate})::date)) < 25 then '18-24'
        when extract(year from age((${birthDate})::date)) < 35 then '25-34'
        when extract(year from age((${birthDate})::date)) < 45 then '35-44'
        when extract(year from age((${birthDate})::date)) < 55 then '45-54'
        else '55+' end`;
      const ageRows = await tx
        .select({ value: ageBand, total: count() })
        .from(anamnesisSessions)
        // O regex é defesa em profundidade: o cast só roda sobre o que já tem forma
        // de data civil, então um bloco corrompido não derruba o painel inteiro.
        .where(sql`${birthDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'`)
        .groupBy(sql`1`);
      if (ageRows.some((row) => row.total < MINIMUM_SEGMENT_SIZE)) {
        suppressedSegments += ageRows.length;
      } else {
        for (const row of ageRows) {
          segments.push({ dimension: 'AGE_BAND', value: row.value, count: row.total });
        }
      }

      // --- Aquisição por canal (US-8.2, TASK-8.2.3). Grava-se o bruto; a taxonomia
      // canônica é aplicada AQUI, na leitura. Fonte pronta para a US-8.6.
      const attributionRows = await tx
        .select({
          source: anamnesisSessions.utmSource,
          medium: anamnesisSessions.utmMedium,
          total: count(),
        })
        .from(anamnesisSessions)
        .where(isNotNull(anamnesisSessions.firstTouchAt))
        .groupBy(anamnesisSessions.utmSource, anamnesisSessions.utmMedium);

      const [notCaptured] = await tx
        .select({ total: count() })
        .from(anamnesisSessions)
        .where(isNull(anamnesisSessions.firstTouchAt));

      const byChannel = new Map<string, AcquisitionChannel>();
      for (const row of attributionRows) {
        const canonical = canonicalChannel(row.source, row.medium);
        // Não mapeado nunca é fundido com outro: a chave carrega o bruto, para que o
        // erro de marcação de campanha continue visível item a item.
        const key = canonical.mapped ? canonical.channel : `${UNMAPPED_CHANNEL}:${canonical.raw}`;
        const current = byChannel.get(key);
        byChannel.set(key, {
          channel: canonical.channel,
          mapped: canonical.mapped,
          raw: canonical.mapped ? canonical.channel : canonical.raw,
          count: (current?.count ?? 0) + row.total,
        });
      }
      const allChannels = [...byChannel.values()].sort((a, b) => b.count - a.count);
      const acquisitionChannels = allChannels.filter(
        (channel) => channel.count >= MINIMUM_SEGMENT_SIZE,
      );
      const suppressedChannels = allChannels.length - acquisitionChannels.length;
      const attributed = allChannels.reduce((sum, channel) => sum + channel.count, 0);

      // --- CAC / ROAS / LTV-CAC por origem (US-8.6). Coorte é madura quando entrou há pelo
      // menos `MATURE_COHORT_MONTHS` meses: mês corrente não sustenta estimativa de LTV.
      const cohorts = await this.entryCohorts(tx);
      const matureBefore = new Date();
      matureBefore.setUTCMonth(matureBefore.getUTCMonth() - MATURE_COHORT_MONTHS);
      const matureCohorts = cohorts.cohorts.filter(
        (cohort) => cohort.month <= matureBefore.toISOString().slice(0, 7),
      ).length;
      const economics = await this.channelEconomics(tx, acquisitionChannels, matureCohorts);

      return {
        anamnesisFunnel,
        acquisitionChannels,
        channelEconomics: economics.economics,
        mediaInvestmentBrl: economics.mediaInvestmentBrl,
        attributionWindowDays: ATTRIBUTION_WINDOW_DAYS,
        matureCohorts,
        suppressedChannels,
        attributionNotCaptured: notCaptured?.total ?? 0,
        attributed,
        signupSeasonality: this.fillHeatmap(seasonalityRows),
        funnel: {
          formStarted: this.marketingMetric(
            funnel?.formStarted ?? 0,
            'Sessões de formulário criadas.',
          ),
          formSubmitted: this.marketingMetric(
            funnel?.formSubmitted ?? 0,
            'Sessões de formulário enviadas.',
          ),
          protocolActive: this.marketingMetric(
            funnel?.protocolActive ?? 0,
            'Titulares distintos com protocolo ativo.',
          ),
          subscriptionActive: this.marketingMetric(
            funnel?.subscriptionActive ?? 0,
            'Titulares distintos com assinatura ativa.',
          ),
        },
        acquisition: this.marketingMetric(
          attributed,
          'Cadastros com origem de primeiro toque registrada (inclui `desconhecida` explícita).',
        ),
        trialConversion,
        segments,
        suppressedSegments,
        minimumSegmentSize: MINIMUM_SEGMENT_SIZE as 10,
      };
    });
    return this.envelope(result, [
      'Somente dimensões estruturadas não sensíveis são agregadas.',
      'Métricas entre 1 e 9 e dimensões com qualquer célula menor que 10 são omitidas.',
      'Aquisição cobre apenas cadastros iniciados a partir da US-8.2; os anteriores aparecem como origem não capturada, nunca como orgânico.',
      'Canais com menos de 10 cadastros são omitidos; valores fora da taxonomia aparecem como `nao_mapeado` com o valor bruto ao lado.',
      'O funil da anamnese cobre apenas sessões com desfecho definido (enviadas ou com link já expirado); sessões ainda abertas não contam como abandono.',
      `Sazonalidade de cadastro cobre os últimos ${INSIGHT_WINDOW_DAYS} dias em ${TIMEZONE}, sobre a criação da sessão de anamnese.`,
      'Faixa etária é derivada da data de nascimento da etapa 1 e só sai do banco já generalizada em faixas.',
      'Conversão trial→ativo lê `user_status_transitions`; "convertido" é hoje o proxy `TRIALING→ACTIVE` (pagamento autorizado), a ser trocado por primeiro pagamento liquidado quando `payments` existir.',
      `Funil de conversão suprimido por inteiro quando há menos de ${MINIMUM_SEGMENT_SIZE} entradas em trial.`,
      `CAC por canal usa janela de atribuição declarada: convertidos em até ${ATTRIBUTION_WINDOW_DAYS} dias após o cadastro, atribuídos ao canal de primeiro toque — nunca por mês-calendário de gasto.`,
      'Canal sem investimento registrado em `ad_spend` aparece como "sem investimento direto"; CAC e ROAS ficam indisponíveis, nunca R$ 0,00.',
      'ROAS usa receita RECEBIDA (`payments`), nunca receita contratada.',
      `LTV é receita recebida acumulada por convertido e só é publicado como disponível com ao menos 3 coortes de entrada maduras (${MATURE_COHORT_MONTHS}+ meses); abaixo disso é estimativa de baixa confiança.`,
      'Investimento em mídia é `ad_spend`; a categoria MARKETING de `expenses` cobre marketing que não é mídia direta por canal — as duas nunca descrevem o mesmo real.',
    ]);
  }

  /** Economia por `utm_campaign`, com o mesmo recorte e k-anonimato da visao por canal. */
  async campaigns(): Promise<ControlCenterCampaignsResponse> {
    return this.db.runAsSystem(async (tx) => {
      const cohorts = await this.entryCohorts(tx);
      const matureBefore = new Date();
      matureBefore.setUTCMonth(matureBefore.getUTCMonth() - MATURE_COHORT_MONTHS);
      const matureCohorts = cohorts.cohorts.filter(
        (cohort) => cohort.month <= matureBefore.toISOString().slice(0, 7),
      ).length;

      const originRows = await tx.execute<{
        source: string | null;
        medium: string | null;
        campaign: string;
        students: number;
        converted: number;
        received_cents: string;
      }>(sql`
        with origin as (
          select distinct on (a.user_id)
                 a.user_id, a.utm_source as source, a.utm_medium as medium,
                 a.utm_campaign as campaign, a.created_at as signed_up_at
          from ${anamnesisSessions} a
          where a.user_id is not null and a.first_touch_at is not null
            and a.utm_campaign is not null
          order by a.user_id, a.created_at
        ),
        conv as (
          select user_id, min(occurred_at) as converted_at
          from ${userStatusTransitions}
          where to_status = 'CONVERTED'
          group by user_id
        )
        select o.source, o.medium, o.campaign,
               count(*)::int as students,
               count(*) filter (
                 where c.converted_at is not null
                   and c.converted_at <= o.signed_up_at + ${ATTRIBUTION_WINDOW_DAYS} * interval '1 day'
               )::int as converted,
               coalesce(sum(pay.cents), 0)::text as received_cents
        from origin o
        left join conv c on c.user_id = o.user_id
        left join lateral (
          select coalesce(sum(p.amount_cents), 0) as cents
          from ${payments} p
          where p.user_id = o.user_id and p.status <> 'FAILED'
        ) pay on true
        group by 1, 2, 3
      `);

      const spendRows = await tx
        .select({
          channel: adSpend.channel,
          campaign: sql<string>`lower(trim(${adSpend.campaign}))`,
          cents: sql<string>`coalesce(sum(${adSpend.amountCents}), 0)::text`,
        })
        .from(adSpend)
        .groupBy(adSpend.channel, sql`lower(trim(${adSpend.campaign}))`);
      const investment = new Map(
        spendRows.map((row) => [`${row.channel}|${row.campaign}`, this.number(row.cents)]),
      );
      const mediaInvestmentBrl =
        spendRows.reduce((sum, row) => sum + this.number(row.cents), 0) / 100;
      const [observed] = await tx
        .select({
          months: sql<number>`count(distinct to_char(${payments.occurredAt} at time zone ${TIMEZONE}, 'YYYY-MM'))::int`,
        })
        .from(payments)
        .where(sql`${payments.status} <> 'FAILED'`);
      const observedMonths = Math.max(1, observed?.months ?? 0);
      const hasPayments = (observed?.months ?? 0) > 0;

      const all = originRows.map((row) => {
        const channel = canonicalChannel(row.source, row.medium).channel;
        return { ...row, channel };
      });
      const publishable = all.filter((row) => row.students >= MINIMUM_SEGMENT_SIZE);
      const campaigns: CampaignEconomics[] = publishable.map((row) => ({
        campaign: row.campaign,
        channel: row.channel,
        students: row.students,
        ...this.economicMetrics({
          label: `campanha ${row.campaign}`,
          converted: row.converted,
          receivedCents: this.number(row.received_cents),
          investmentCents: investment.get(`${row.channel}|${row.campaign}`) ?? 0,
          hasPayments,
          matureCohorts,
          observedMonths,
        }),
      }));

      return this.envelope({
        campaigns,
        suppressedCampaigns: all.length - publishable.length,
        minimumSegmentSize: MINIMUM_SEGMENT_SIZE as 10,
        attributionWindowDays: ATTRIBUTION_WINDOW_DAYS,
        matureCohorts,
        mediaInvestmentBrl,
      });
    });
  }

  /**
   * Funil por etapa do onboarding (US-7.3). `lastStep` é a etapa CORRENTE da sessão
   * (o `patchStep` avança para `step + 1`, com teto 3), então "concluiu a etapa N" é
   * `lastStep > N` — exceto na etapa 3, cuja conclusão é o próprio `submitted_at`.
   *
   * O denominador é a coorte com desfecho definido: uma sessão criada há dez minutos
   * não é abandono, é gente ainda preenchendo, e contá-la infla a queda do bloco 1.
   */
  private async anamnesisFunnel(
    tx: TenantTransaction,
  ): Promise<ControlCenterMarketingResponse['data']['anamnesisFunnel']> {
    const settled = sql`(${anamnesisSessions.submittedAt} is not null or ${anamnesisSessions.expiresAt} < now())`;
    const [row] = await tx
      .select({
        settledSessions: sql<number>`count(*)::int`,
        reached2: sql<number>`count(*) filter (where ${anamnesisSessions.lastStep} >= 2)::int`,
        reached3: sql<number>`count(*) filter (where ${anamnesisSessions.lastStep} >= 3)::int`,
        submitted: sql<number>`count(*) filter (where ${anamnesisSessions.submittedAt} is not null)::int`,
      })
      .from(anamnesisSessions)
      .where(settled);

    const settledSessions = row?.settledSessions ?? 0;
    const steps = [
      {
        step: 1 as const,
        label: 'Etapa 1 — cadastro',
        reached: settledSessions,
        completed: row?.reached2 ?? 0,
      },
      {
        step: 2 as const,
        label: 'Etapa 2 — anamnese',
        reached: row?.reached2 ?? 0,
        completed: row?.reached3 ?? 0,
      },
      {
        step: 3 as const,
        label: 'Etapa 3 — PAR-Q',
        reached: row?.reached3 ?? 0,
        completed: row?.submitted ?? 0,
      },
    ].map((step) => ({
      ...step,
      abandoned: Math.max(step.reached - step.completed, 0),
      abandonRate:
        step.reached === 0 ? null : Math.max(step.reached - step.completed, 0) / step.reached,
    }));

    // Mesma regra dos segmentos: uma célula entre 1 e 9 é recomponível por
    // subtração das vizinhas, então a dimensão inteira sai do ar.
    const publishable = steps.every((step) =>
      [step.reached, step.completed, step.abandoned].every(
        (value) => value === 0 || value >= MINIMUM_SEGMENT_SIZE,
      ),
    );
    if (!publishable || settledSessions < MINIMUM_SEGMENT_SIZE) {
      return {
        settledSessions: settledSessions < MINIMUM_SEGMENT_SIZE ? 0 : settledSessions,
        steps: [],
        worstStep: null,
        exitPoint: {
          status: 'UNAVAILABLE',
          step: null,
          checkpoint: null,
          count: null,
          reason: `Amostra insuficiente: alguma etapa ficaria com menos de ${MINIMUM_SEGMENT_SIZE} sessões e permitiria reidentificação.`,
        },
      };
    }

    const worst = steps.reduce((a, b) => ((b.abandonRate ?? -1) > (a.abandonRate ?? -1) ? b : a));
    return {
      settledSessions,
      steps,
      worstStep: worst.abandonRate === null ? null : worst.step,
      exitPoint: await this.exitPoint(tx, worst.step, settled),
    };
  }

  /**
   * Ponto de parada dentro da etapa de maior queda.
   *
   * Só a etapa 1 tem checkpoint persistido (`phone_e164` / `phone_verified_at`, US-6.5).
   * Nas etapas 2 e 3 o bloco só é gravado quando a etapa inteira é validada — e o bloco 2
   * ainda é cifrado —, então não existe granularidade por campo para ler. Isso é declarado
   * como indisponível em vez de estimado: o painel não inventa onde a pessoa parou.
   */
  private async exitPoint(
    tx: TenantTransaction,
    step: 1 | 2 | 3,
    settled: SQLWrapper,
  ): Promise<ControlCenterMarketingResponse['data']['anamnesisFunnel']['exitPoint']> {
    if (step !== 1) {
      return {
        status: 'UNAVAILABLE',
        step,
        checkpoint: null,
        count: null,
        reason:
          'As etapas 2 e 3 só gravam o bloco quando concluídas (e o bloco de saúde é cifrado), então o campo exato de parada exige telemetria de formulário por campo — que não entrou no escopo da Sprint 8 e ainda não tem sprint definida.',
      };
    }
    const [row] = await tx
      .select({
        identification: sql<number>`count(*) filter (where ${anamnesisSessions.phoneE164} is null)::int`,
        codeSent: sql<number>`count(*) filter (where ${anamnesisSessions.phoneE164} is not null and ${anamnesisSessions.phoneVerifiedAt} is null)::int`,
        afterVerification: sql<number>`count(*) filter (where ${anamnesisSessions.phoneVerifiedAt} is not null)::int`,
      })
      .from(anamnesisSessions)
      .where(and(settled, sql`${anamnesisSessions.lastStep} < 2`));

    const candidates = [
      { checkpoint: 'Identificação (nome, nascimento, telefone)', count: row?.identification ?? 0 },
      { checkpoint: 'Código de verificação do WhatsApp', count: row?.codeSent ?? 0 },
      {
        checkpoint: 'Consentimentos, após verificar o WhatsApp',
        count: row?.afterVerification ?? 0,
      },
    ];
    const top = candidates.reduce((a, b) => (b.count > a.count ? b : a));
    if (top.count < MINIMUM_SEGMENT_SIZE) {
      return {
        status: 'UNAVAILABLE',
        step,
        checkpoint: null,
        count: null,
        reason: `Nenhum ponto de parada da etapa 1 acumulou ao menos ${MINIMUM_SEGMENT_SIZE} sessões abandonadas.`,
      };
    }
    return {
      status: 'AVAILABLE',
      step,
      checkpoint: top.checkpoint,
      count: top.count,
      reason:
        'Checkpoint persistido da etapa 1 (posse do número, US-6.5) — é a maior granularidade que o banco guarda hoje.',
    };
  }

  /**
   * Lista base de alunos — identificação e situação comercial. Nenhum campo de saúde
   * (anamnese, PAR-Q, dor, check-in) trafega aqui: é a projeção que o papel `SUPPORT`
   * enxerga, e o recorte de suporte é esta mesma lista sob `STUDENTS_READ`. Saúde só
   * na ficha (`student()`), sob `STUDENTS_HEALTH_READ`.
   */
  async students(actor: AuthenticatedUser): Promise<ControlCenterStudentsResponse> {
    const { rows, ai } = await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      const found = await tx
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          phoneNumber: users.phoneNumber,
          status: users.status,
          subscriptionStatus: this.latestSubscriptionStatus(),
          subscriptionPlan: this.latestSubscriptionPlan(),
          protocolStatus: this.latestProtocolStatus(),
          // "Data de inscrição" = quando a MATRÍCULA foi concluída — a primeira anamnese
          // enviada, não a última (uma re-anamnese não deve mudar quando o aluno entrou).
          enrolledAt: sql<Date | null>`(
            select min(a.submitted_at) from ${anamnesisSessions} a
            where a.user_id = users.id and a.submitted_at is not null
          )`,
          lastInboundAt: sql<Date | null>`(
            select max(c.created_at) from ${conversations} c
            where c.user_id = users.id and c.direction = 'INBOUND'
          )`,
          unansweredCheckinSentAt: sql<Date | null>`(
            select min(k.sent_at) from ${checkins} k
            where k.user_id = users.id and k.sent_at is not null and k.responded_at is null
          )`,
          renewalAt: sql<Date | null>`(
            select coalesce(s.trial_ends_at, s.current_period_end) from ${subscriptions} s
            where s.user_id = users.id order by s.created_at desc limit 1
          )`,
        })
        .from(users)
        .where(eq(users.role, 'USER'))
        .orderBy(desc(users.createdAt))
        .limit(200);
      const [quality] = await tx
        .select({
          blocked: sql<number>`count(*) filter (where ${conversations.validationPassed} = false)::int`,
          validated: sql<number>`count(*) filter (where ${conversations.validationPassed} is not null)::int`,
        })
        .from(conversations);
      await this.auditListAccess(tx, actor, 'STUDENTS_LIST_VIEWED', 'student_list', found.length);
      return { rows: found, ai: quality };
    });
    const northStar = await this.northStar();
    const declaredAdherenceRate = await this.declaredAdherenceRate();
    const students = rows
      .map(({ lastInboundAt, unansweredCheckinSentAt, renewalAt, enrolledAt, ...student }) => ({
        ...student,
        enrolledAt: this.date(enrolledAt)?.toISOString() ?? null,
        churnRisk: assessChurnRisk({
          lastInboundAt: this.date(lastInboundAt),
          unansweredCheckinSentAt: this.date(unansweredCheckinSentAt),
          renewalAt: this.date(renewalAt),
        }),
      }))
      .sort((a, b) => b.churnRisk.score - a.churnRisk.score);
    return this.envelope(
      {
        students,
        aiBlockedRate: this.blockedRate(ai?.blocked ?? 0, ai?.validated ?? 0),
        northStar,
        declaredAdherenceRate,
      },
      [
        'Risco de cancelamento é comercial: soma de três sinais nomeados (silêncio no canal, check-in sem resposta, renovação próxima), não um score preditivo.',
        `Limiares vigentes: ${CHURN_RISK_THRESHOLDS.silentDays} dias sem mensagem, ${CHURN_RISK_THRESHOLDS.unansweredCheckinDays} dias de check-in sem resposta, ${CHURN_RISK_THRESHOLDS.renewalWindowDays} dias até a renovação.`,
        `North Star (treino verificado): média de treinos registrados nos primeiros ${NORTH_STAR_WINDOW_DAYS} dias de assinatura paga, meta ≥${NORTH_STAR_TARGET}. Coorte de ${northStar.cohortSize} aluno(s).`,
        'Adesão verificada e adesão declarada coexistem: a primeira conta treino registrado, a segunda conta resposta a check-in. A divergência entre elas é informação, não erro.',
        `Taxa de reporte de ${northStar.reportingRate.value ?? 0}%: abaixo de 100%, a North Star é um piso, não uma medida — quem nunca respondeu entra na média como zero.`,
      ],
    );
  }

  /**
   * North Star (US-8.1 / TASK-8.1.5): média de `workout_completions` na janela de 30
   * dias a partir do início da assinatura **paga**, contra a meta ≥8.
   *
   * `paid_start` é o `current_period_start` mais antigo de status pago — trial não conta
   * (a métrica é sobre usuário pago, `08-relatorio-lucas.md`).
   *
   * ponytail: a coorte inclui quem começou a pagar há menos de 30 dias, e essa pessoa
   * entra com a contagem parcial da janela ainda aberta — o efeito é puxar a média para
   * baixo, na direção conservadora, coerente com "contagem inflada é pior que ausente".
   * Se um dia a leitura por safra mensal for necessária, agrupar por
   * `date_trunc('month', paid_start)` aqui e nada mais no arquivo muda.
   */
  private async northStar(): Promise<ControlCenterNorthStar> {
    const [row] = await this.db.runAsSystem((tx) =>
      tx.execute<{
        cohort_size: number;
        total_completions: number;
        reporting: number;
        quick_reply: number;
        checkin: number;
        conversation: number;
      }>(sql`
        with cohort as (
          select user_id, min(current_period_start) as paid_start
          from ${subscriptions}
          where current_period_start is not null
            and status in ('ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED')
          group by user_id
        ),
        cohort_window as (
          select
            cohort.user_id,
            count(w.id)::int as total,
            count(w.id) filter (where w.source = 'WHATSAPP_QUICK_REPLY')::int as quick_reply,
            count(w.id) filter (where w.source = 'CHECKIN')::int as checkin,
            count(w.id) filter (where w.source = 'CONVERSATION')::int as conversation
          from cohort
          left join ${workoutCompletions} w
            on w.user_id = cohort.user_id
           and w.completed_at >= cohort.paid_start::date
           and w.completed_at < (cohort.paid_start + make_interval(days => ${NORTH_STAR_WINDOW_DAYS}))::date
          group by cohort.user_id
        )
        select
          count(*)::int as cohort_size,
          coalesce(sum(total), 0)::int as total_completions,
          count(*) filter (where total > 0)::int as reporting,
          coalesce(sum(quick_reply), 0)::int as quick_reply,
          coalesce(sum(checkin), 0)::int as checkin,
          coalesce(sum(conversation), 0)::int as conversation
        from cohort_window
      `),
    );
    const cohortSize = this.number(row?.cohort_size);
    const definition = `Média de treinos registrados nos primeiros ${NORTH_STAR_WINDOW_DAYS} dias de assinatura paga (meta ≥${NORTH_STAR_TARGET}). Treino verificado, não declarado.`;
    const reportingDefinition = `Percentual da coorte paga com ao menos 1 treino registrado na janela. Abaixo de 100%, a North Star é um piso.`;
    if (cohortSize === 0) {
      return {
        averageCompletions: this.unavailable(
          'COUNT',
          `${definition} Sem nenhum aluno pago na base ainda.`,
        ),
        target: NORTH_STAR_TARGET,
        reportingRate: this.unavailable('PERCENT', reportingDefinition),
        cohortSize: 0,
        bySource: [],
      };
    }
    const average = this.number(row?.total_completions) / cohortSize;
    const reporting = (this.number(row?.reporting) / cohortSize) * 100;
    return {
      averageCompletions: this.metric(
        Math.round(average * 100) / 100,
        'COUNT',
        'AVAILABLE',
        definition,
      ),
      target: NORTH_STAR_TARGET,
      reportingRate: this.metric(
        Math.round(reporting * 10) / 10,
        'PERCENT',
        'AVAILABLE',
        reportingDefinition,
      ),
      cohortSize,
      bySource: [
        { source: 'WHATSAPP_QUICK_REPLY' as const, completions: this.number(row?.quick_reply) },
        { source: 'CHECKIN' as const, completions: this.number(row?.checkin) },
        { source: 'CONVERSATION' as const, completions: this.number(row?.conversation) },
      ],
    };
  }

  /** Adesão **declarada** da Sprint 7: check-ins respondidos / enviados. Proxy, não treino. */
  private async declaredAdherenceRate(): Promise<ControlCenterMetric> {
    const [row] = await this.db.runAsSystem((tx) =>
      tx
        .select({
          sent: sql<number>`count(*) filter (where ${checkins.sentAt} is not null)::int`,
          responded: sql<number>`count(*) filter (where ${checkins.respondedAt} is not null)::int`,
        })
        .from(checkins),
    );
    const sent = this.number(row?.sent);
    const definition =
      'Adesão declarada: percentual de check-ins enviados que foram respondidos. Mede engajamento com a pergunta, não treino executado.';
    if (sent === 0) return this.unavailable('PERCENT', `${definition} Nenhum check-in enviado.`);
    const rate = (this.number(row?.responded) / sent) * 100;
    return this.metric(Math.round(rate * 10) / 10, 'PERCENT', 'AVAILABLE', definition);
  }

  /**
   * Ficha unificada (US-7.4). Uma tela substitui as quatro que o RT abria: cadastro,
   * protocolo, check-ins e conversas viram uma timeline cronológica única.
   *
   * O corte de saúde é **no servidor**: sem `STUDENTS_HEALTH_READ`, `health` é `null`,
   * a evolução declarada não é decifrada, e nenhum detalhe de check-in, PAR-Q ou
   * conteúdo de conversa entra no payload. A UI não é a barreira.
   */
  async student(
    actor: AuthenticatedUser,
    studentId: string,
    periodDays = STUDENT_TIMELINE_DAYS,
  ): Promise<ControlCenterStudentDetailResponse> {
    const canReadHealth = roleHasCapabilities(actor.role, [Capability.STUDENTS_HEALTH_READ]);
    const since = new Date(Date.now() - periodDays * 86_400_000);
    const raw = await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      const [row] = await tx
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          phoneNumber: users.phoneNumber,
          status: users.status,
          requiresProfessionalReview: users.requiresProfessionalReview,
          subscriptionStatus: this.latestSubscriptionStatus(),
          subscriptionPlan: this.latestSubscriptionPlan(),
          protocolStatus: this.latestProtocolStatus(),
          anamnesisStatus: sql<string | null>`(
            select a.status::text from ${anamnesisSessions} a
            where a.user_id = users.id order by a.created_at desc limit 1
          )`,
          parqState: sql<string | null>`(
            select a.parq_state::text from ${anamnesisSessions} a
            where a.user_id = users.id order by a.created_at desc limit 1
          )`,
          routine: sql<unknown>`(
            select a.data_block_3 from ${anamnesisSessions} a
            where a.user_id = users.id order by a.created_at desc limit 1
          )`,
          lastInboundAt: sql<Date | null>`(
            select max(c.created_at) from ${conversations} c
            where c.user_id = users.id and c.direction = 'INBOUND'
          )`,
          unansweredCheckinSentAt: sql<Date | null>`(
            select min(k.sent_at) from ${checkins} k
            where k.user_id = users.id and k.sent_at is not null and k.responded_at is null
          )`,
          renewalAt: sql<Date | null>`(
            select coalesce(s.trial_ends_at, s.current_period_end) from ${subscriptions} s
            where s.user_id = users.id order by s.created_at desc limit 1
          )`,
        })
        .from(users)
        .where(and(eq(users.id, studentId), eq(users.role, 'USER')))
        .limit(1);
      if (!row) throw new NotFoundException('Aluno não encontrado.');
      const [protocol] = await tx
        .select({
          id: protocols.id,
          version: protocols.version,
          currentWeek: protocols.currentWeek,
          totalWeeks: protocols.totalWeeks,
          signedAt: protocols.signedAt,
        })
        .from(protocols)
        .where(eq(protocols.userId, studentId))
        .orderBy(desc(protocols.createdAt))
        .limit(1);

      // --- Origens da timeline (6). Mescladas e ordenadas em memória: são recortes
      // pequenos por aluno, e um UNION em SQL só trocaria clareza por nada.
      const anamnesisRows = await tx
        .select({
          createdAt: anamnesisSessions.createdAt,
          submittedAt: anamnesisSessions.submittedAt,
          status: anamnesisSessions.status,
          utmSource: anamnesisSessions.utmSource,
          utmMedium: anamnesisSessions.utmMedium,
          utmCampaign: anamnesisSessions.utmCampaign,
          utmContent: anamnesisSessions.utmContent,
          referrerHost: anamnesisSessions.referrerHost,
          firstTouchAt: anamnesisSessions.firstTouchAt,
        })
        .from(anamnesisSessions)
        .where(eq(anamnesisSessions.userId, studentId))
        .orderBy(desc(anamnesisSessions.createdAt))
        .limit(10);
      const versionRows = await tx
        .select({
          createdAt: protocolVersions.createdAt,
          version: protocolVersions.version,
          changeReason: protocolVersions.changeReason,
          generatedBy: protocolVersions.generatedBy,
          signedAt: protocolVersions.signedAt,
        })
        .from(protocolVersions)
        .where(and(eq(protocolVersions.userId, studentId), gte(protocolVersions.createdAt, since)))
        .orderBy(desc(protocolVersions.createdAt))
        .limit(60);
      const checkinRows = await tx
        .select({
          weekNumber: checkins.weekNumber,
          sentAt: checkins.sentAt,
          respondedAt: checkins.respondedAt,
          completedAt: checkins.completedAt,
          responsesCipher: checkins.responsesCipher,
        })
        .from(checkins)
        .where(eq(checkins.userId, studentId))
        .orderBy(desc(checkins.weekNumber))
        .limit(60);
      const subscriptionRows = await tx
        .select({
          createdAt: subscriptions.createdAt,
          plan: subscriptions.plan,
          status: subscriptions.status,
          trialEndsAt: subscriptions.trialEndsAt,
          currentPeriodStart: subscriptions.currentPeriodStart,
          canceledAt: subscriptions.canceledAt,
          cancelReason: subscriptions.cancelReason,
        })
        .from(subscriptions)
        .where(eq(subscriptions.userId, studentId))
        .orderBy(desc(subscriptions.createdAt))
        .limit(20);
      const handoffRows = await tx
        .select({
          createdAt: handoffAlerts.createdAt,
          updatedAt: handoffAlerts.updatedAt,
          level: handoffAlerts.level,
          reason: handoffAlerts.reason,
          status: handoffAlerts.status,
        })
        .from(handoffAlerts)
        .where(and(eq(handoffAlerts.userId, studentId), gte(handoffAlerts.createdAt, since)))
        .orderBy(desc(handoffAlerts.createdAt))
        .limit(40);
      // Marco de conversa, não transcrição: um item por dia com o volume trocado.
      // `group by 1` pela posição — a mesma expressão reemitida colide no GROUP BY.
      const conversationDays = await tx
        .select({ day: this.localDay(conversations.createdAt), total: count() })
        .from(conversations)
        .where(and(eq(conversations.userId, studentId), gte(conversations.createdAt, since)))
        .groupBy(sql`1`);
      const blockedRows = await tx
        .select({
          createdAt: conversations.createdAt,
          content: conversations.content,
        })
        .from(conversations)
        .where(and(eq(conversations.userId, studentId), eq(conversations.validationPassed, false)))
        .orderBy(desc(conversations.createdAt))
        .limit(10);
      const [quality] = await tx
        .select({
          blocked: sql<number>`count(*) filter (where ${conversations.validationPassed} = false)::int`,
          validated: sql<number>`count(*) filter (where ${conversations.validationPassed} is not null)::int`,
        })
        .from(conversations)
        .where(eq(conversations.userId, studentId));

      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: studentId,
        action: 'HEALTH_DATA_VIEWED',
        entityType: 'student_control_center',
        entityId: studentId,
        changes: { purpose: 'student_monitoring', role: actor.role, health: canReadHealth },
      });
      return {
        row,
        protocol,
        anamnesisRows,
        versionRows,
        checkinRows,
        subscriptionRows,
        handoffRows,
        conversationDays,
        blockedRows,
        quality,
      };
    });

    const { row } = raw;
    // Decifra fora da transação (o `HealthCipherService` usa o cliente do core), e só
    // quando a capability existe: sem ela o ciphertext nem é aberto.
    const declared = canReadHealth ? await this.decryptCheckins(raw.checkinRows) : [];
    const evolution = declared.map(({ point }) => point);
    const painReports = declared.flatMap(({ point, painReport }) =>
      painReport ? [{ at: point.at, week: point.week, text: painReport }] : [],
    );

    // Origem do primeiro toque: a sessão mais antiga é a que traz o cadastro (US-8.2).
    const firstSession = raw.anamnesisRows.at(-1) ?? null;
    const acquisition =
      firstSession?.firstTouchAt != null
        ? {
            ...canonicalChannel(firstSession.utmSource, firstSession.utmMedium),
            campaign: firstSession.utmCampaign,
            content: firstSession.utmContent,
            referrerHost: firstSession.referrerHost,
            capturedAt: firstSession.firstTouchAt.toISOString(),
          }
        : null;
    const acquisitionText = attributionLabel(acquisition);

    const events: Array<ControlCenterTimelineEvent | null> = [];
    for (const item of raw.anamnesisRows) {
      events.push(
        this.event(
          item.createdAt,
          'ANAMNESIS',
          'Formulário de anamnese iniciado',
          // Marco de cadastro carrega a origem — inclusive a ausência dela.
          item === firstSession ? `Origem: ${acquisitionText}` : null,
        ),
      );
      if (item.submittedAt) {
        events.push(
          this.event(item.submittedAt, 'ANAMNESIS', 'Formulário de anamnese enviado', item.status),
        );
      }
    }
    if (raw.protocol) {
      events.push(
        this.event(
          raw.protocol.signedAt,
          'PROTOCOL',
          `Protocolo v${raw.protocol.version} assinado pelo responsável técnico`,
          null,
        ),
      );
    }
    for (const version of raw.versionRows) {
      events.push(
        this.event(
          version.createdAt,
          'PROTOCOL',
          `Versão ${version.version} do protocolo gerada`,
          [version.changeReason, version.generatedBy && `modelo ${version.generatedBy}`]
            .filter(Boolean)
            .join(' · ') || null,
        ),
      );
      if (version.signedAt) {
        events.push(
          this.event(version.signedAt, 'PROTOCOL', `Versão ${version.version} assinada`, null),
        );
      }
    }
    for (const [index, checkin] of raw.checkinRows.entries()) {
      events.push(
        this.event(
          checkin.sentAt,
          'CHECKIN',
          `Check-in da semana ${checkin.weekNumber} enviado`,
          null,
        ),
      );
      events.push(
        this.event(
          checkin.respondedAt ?? checkin.completedAt,
          'CHECKIN',
          `Check-in da semana ${checkin.weekNumber} respondido`,
          canReadHealth ? (declared[index]?.summary ?? null) : null,
        ),
      );
    }
    for (const subscription of raw.subscriptionRows) {
      events.push(
        this.event(
          subscription.createdAt,
          'SUBSCRIPTION',
          `Assinatura ${subscription.plan} criada`,
          subscription.status,
        ),
      );
      events.push(
        this.event(subscription.trialEndsAt, 'SUBSCRIPTION', 'Fim do período de teste', null),
      );
      events.push(
        this.event(
          subscription.currentPeriodStart,
          'SUBSCRIPTION',
          'Início do período pago vigente',
          null,
        ),
      );
      events.push(
        this.event(
          subscription.canceledAt,
          'SUBSCRIPTION',
          'Assinatura cancelada',
          subscription.cancelReason,
        ),
      );
    }
    for (const handoff of raw.handoffRows) {
      events.push(
        this.event(
          handoff.createdAt,
          'HANDOFF',
          `Atendimento humano aberto (${handoff.level})`,
          handoff.reason,
        ),
      );
      if (handoff.status === 'RESOLVED') {
        events.push(
          this.event(handoff.updatedAt, 'HANDOFF', 'Atendimento humano resolvido', handoff.reason),
        );
      }
    }
    for (const day of raw.conversationDays) {
      events.push(
        this.event(
          new Date(`${day.day}T12:00:00.000Z`),
          'CONVERSATION',
          `${Number(day.total)} mensagens trocadas no dia`,
          null,
        ),
      );
    }
    const timeline = events
      .filter((event): event is ControlCenterTimelineEvent => event !== null)
      .filter((event) => event.at >= since.toISOString())
      .sort((a, b) => b.at.localeCompare(a.at));

    const checkinsSent = raw.checkinRows.filter((checkin) => checkin.sentAt).length;
    const checkinsResponded = raw.checkinRows.filter(
      (checkin) => checkin.respondedAt ?? checkin.completedAt,
    ).length;
    const scrubUser = { name: row.name, phoneNumber: row.phoneNumber, email: row.email };

    const student = {
      id: row.id,
      name: row.name,
      email: row.email,
      phoneNumber: row.phoneNumber,
      status: row.status,
      subscriptionStatus: row.subscriptionStatus,
      subscriptionPlan: row.subscriptionPlan,
      // Mesma semântica de `students()`: a matrícula é a PRIMEIRA anamnese enviada.
      enrolledAt: firstSession?.submittedAt?.toISOString() ?? null,
      protocolStatus: row.protocolStatus,
      requiresProfessionalReview: row.requiresProfessionalReview,
      anamnesisStatus: row.anamnesisStatus,
      churnRisk: assessChurnRisk({
        lastInboundAt: this.date(row.lastInboundAt),
        unansweredCheckinSentAt: this.date(row.unansweredCheckinSentAt),
        renewalAt: this.date(row.renewalAt),
      }),
      currentProtocol: raw.protocol
        ? { ...raw.protocol, signedAt: raw.protocol.signedAt?.toISOString() ?? null }
        : null,
      acquisition,
      routine: this.projectRoutine(row.routine),
      workoutHistory: {
        status: 'UNAVAILABLE' as const,
        reason: 'A plataforma ainda não registra cada treino e sua progressão de carga.',
      },
      timeline,
      adherence: {
        checkinsSent,
        checkinsResponded,
        responseRate:
          checkinsSent === 0
            ? this.unavailable(
                'PERCENT',
                'Nenhum check-in enviado ainda; não há denominador para a taxa de resposta.',
              )
            : this.metric(
                (checkinsResponded / checkinsSent) * 100,
                'PERCENT',
                'PROXY',
                DECLARED_ADHERENCE_NOTICE,
              ),
      },
      aiQuality: {
        blockedRate: this.blockedRate(raw.quality?.blocked ?? 0, raw.quality?.validated ?? 0),
        blocked: raw.quality?.blocked ?? 0,
        validated: raw.quality?.validated ?? 0,
        occurrences: canReadHealth
          ? raw.blockedRows.map((occurrence) => ({
              at: occurrence.createdAt.toISOString(),
              content: scrubPII(occurrence.content, scrubUser),
            }))
          : [],
      },
      health: canReadHealth ? { parqState: row.parqState, painReports, evolution } : null,
    };

    return this.envelope({ student }, [
      'Histórico granular de treino indisponível até existir instrumentação de workout.',
      DECLARED_ADHERENCE_NOTICE,
      canReadHealth
        ? 'Dados de saúde decifrados sob RLS e registrados na trilha de auditoria.'
        : 'Seção de saúde ausente deste payload: o acesso não inclui a capacidade de leitura de dado de saúde.',
      `Timeline cobre os últimos ${periodDays} dias.`,
    ]);
  }

  /**
   * Abre as respostas de check-in cifradas. A anotação clínica não existe aqui: o que
   * o aluno declarou é percepção de esforço, treinos declarados e pedido de ajuste.
   */
  private async decryptCheckins(
    rows: Array<{
      weekNumber: number;
      respondedAt: Date | null;
      completedAt: Date | null;
      sentAt: Date | null;
      responsesCipher: Buffer | null;
    }>,
  ) {
    const declared: Array<{
      point: ControlCenterEvolutionPoint;
      painReport: string | null;
      summary: string | null;
    }> = [];
    for (const row of rows) {
      const at = row.respondedAt ?? row.completedAt ?? row.sentAt;
      if (!row.responsesCipher || !at) continue;
      const parsed = checkinDeclaredSchema.safeParse(
        JSON.parse(await this.cipher.decryptHealth(row.responsesCipher)),
      );
      if (!parsed.success) continue;
      const { fatigue, workouts, adjustment, painReport } = parsed.data;
      const summary =
        [
          fatigue && `esforço percebido ${fatigue}`,
          workouts && `treinos declarados ${workouts}`,
          adjustment && `pedido de ajuste ${adjustment}`,
        ]
          .filter(Boolean)
          .join(' · ') || null;
      declared.push({
        point: {
          week: row.weekNumber,
          at: at.toISOString(),
          fatigue: fatigue ?? null,
          workouts: workouts ?? null,
          adjustment: adjustment ?? null,
        },
        painReport: painReport ?? null,
        summary,
      });
    }
    return declared.sort((a, b) => a.point.week - b.point.week);
  }

  private event(
    at: Date | null,
    kind: ControlCenterTimelineEvent['kind'],
    title: string,
    detail: string | null,
  ): ControlCenterTimelineEvent | null {
    return at ? { at: at.toISOString(), kind, title, detail } : null;
  }

  private blockedRate(blocked: number, validated: number): ControlCenterMetric {
    if (validated === 0) {
      return this.unavailable(
        'PERCENT',
        'Nenhuma resposta passou pela validação de compliance ainda; não há denominador.',
      );
    }
    return this.metric(
      (blocked / validated) * 100,
      'PERCENT',
      'AVAILABLE',
      'Respostas bloqueadas pela validação de compliance sobre o total validado. Concentração num aluno indica que o AI Coach está falhando com aquele perfil.',
    );
  }

  private date(value: Date | string | null): Date | null {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /**
   * Pilar Sistema (US-7.5). Duas leituras na mesma tela: o **SLO board** responde
   * "está tudo bem?" a quem não é engenheiro, e os percentis por modelo respondem
   * "onde exatamente" a quem é.
   *
   * Nada aqui depende de OpenTelemetry: `ai_jobs.latency_ms` e
   * `conversations.latency_ms` já são persistidos, e p50/p95/p99 é um
   * `percentile_cont` — OTel continua necessário para **tracing distribuído**, que é
   * outro problema e aparece em `pendingCapabilities`, não como um indicador vazio.
   */
  async system(): Promise<ControlCenterSystemResponse> {
    const since = new Date(Date.now() - INSIGHT_WINDOW_DAYS * 86_400_000);
    const [database, redis, db, rag] = await Promise.all([
      this.databaseHealth.ping().catch(() => null),
      this.redisHealth.ping().catch(() => null),
      this.db.runAsSystem(async (tx) => {
        const [ai] = await tx
          .select({
            total: sql<number>`count(*)::int`,
            completed: sql<number>`count(*) filter (where ${aiJobs.status} = 'COMPLETED')::int`,
            failed: sql<number>`count(*) filter (where ${aiJobs.status} = 'FAILED')::int`,
            dlq: sql<number>`count(*) filter (where ${aiJobs.status} = 'DLQ')::int`,
            samples: sql<number>`count(${aiJobs.latencyMs})::int`,
            p50: this.percentile(0.5, aiJobs.latencyMs),
            p95: this.percentile(0.95, aiJobs.latencyMs),
            p99: this.percentile(0.99, aiJobs.latencyMs),
            // SLO de entrega: protocolo gerado do enfileiramento à conclusão.
            protocolsDelivered: sql<number>`count(*) filter (
              where ${aiJobs.jobType} = 'PROTOCOL_GENERATION'
                and ${aiJobs.status} = 'COMPLETED'
                and ${aiJobs.completedAt} is not null)::int`,
            protocolsWithinSla: sql<number>`count(*) filter (
              where ${aiJobs.jobType} = 'PROTOCOL_GENERATION'
                and ${aiJobs.status} = 'COMPLETED'
                and ${aiJobs.completedAt} is not null
                and ${aiJobs.completedAt} - ${aiJobs.createdAt} <= interval '2 hours')::int`,
          })
          .from(aiJobs)
          .where(gte(aiJobs.createdAt, since));

        const byModel = await tx
          .select({
            model: sql<string | null>`${aiJobs.modelUsed}`,
            jobType: sql<string>`${aiJobs.jobType}`,
            samples: sql<number>`count(${aiJobs.latencyMs})::int`,
            p50: this.percentile(0.5, aiJobs.latencyMs),
            p95: this.percentile(0.95, aiJobs.latencyMs),
            p99: this.percentile(0.99, aiJobs.latencyMs),
          })
          .from(aiJobs)
          .where(and(gte(aiJobs.createdAt, since), isNotNull(aiJobs.latencyMs)))
          .groupBy(aiJobs.modelUsed, aiJobs.jobType);

        // group by ordinal: ver comentário em `overview()` — `localDay` reemite
        // seus próprios parâmetros e repetir a expressão no GROUP BY quebra.
        const aiDaily = await tx
          .select({
            day: this.localDay(aiJobs.createdAt),
            total: this.percentile(0.95, aiJobs.latencyMs),
          })
          .from(aiJobs)
          .where(and(gte(aiJobs.createdAt, since), isNotNull(aiJobs.latencyMs)))
          .groupBy(sql`1`);

        const [whatsapp] = await tx
          .select({
            samples: sql<number>`count(${conversations.latencyMs})::int`,
            p50: this.percentile(0.5, conversations.latencyMs),
            p95: this.percentile(0.95, conversations.latencyMs),
            p99: this.percentile(0.99, conversations.latencyMs),
            withinSla: sql<number>`count(*) filter (where ${conversations.latencyMs} <= 30000)::int`,
          })
          .from(conversations)
          .where(
            and(
              gte(conversations.createdAt, since),
              eq(conversations.direction, 'OUTBOUND'),
              isNotNull(conversations.latencyMs),
            ),
          );

        const whatsappDaily = await tx
          .select({
            day: this.localDay(conversations.createdAt),
            total: this.percentile(0.95, conversations.latencyMs),
          })
          .from(conversations)
          .where(
            and(
              gte(conversations.createdAt, since),
              eq(conversations.direction, 'OUTBOUND'),
              isNotNull(conversations.latencyMs),
            ),
          )
          .groupBy(sql`1`);

        const [corpus] = await tx.select({ total: sql<number>`count(*)::int` }).from(knowledgeBase);

        return { ai, byModel, aiDaily, whatsapp, whatsappDaily, corpus };
      }),
      this.ragUsage(),
    ]);

    const ai = db.ai;
    const jobsWithOutcome = (ai?.completed ?? 0) + (ai?.failed ?? 0) + (ai?.dlq ?? 0);
    return this.envelope(
      {
        databaseLatency: database
          ? this.metric(
              database.latencyMs,
              'MILLISECONDS',
              'AVAILABLE',
              'Latência do SELECT 1 via PgBouncer.',
            )
          : this.unavailable('MILLISECONDS', 'Probe do PostgreSQL falhou.'),
        redisLatency: redis
          ? this.metric(
              redis.latencyMs,
              'MILLISECONDS',
              'AVAILABLE',
              'Latência do PING ao master descoberto por Sentinel.',
            )
          : this.unavailable('MILLISECONDS', 'Probe do Redis falhou.'),
        aiJobs: this.metric(
          ai?.total ?? 0,
          'COUNT',
          'AVAILABLE',
          `Jobs de IA criados nos últimos ${INSIGHT_WINDOW_DAYS} dias.`,
        ),
        aiFailures: this.metric(
          ai?.failed ?? 0,
          'COUNT',
          'AVAILABLE',
          'Jobs de IA em estado FAILED na janela.',
        ),
        aiDlq: this.metric(
          ai?.dlq ?? 0,
          'COUNT',
          'AVAILABLE',
          'Jobs de IA que esgotaram o retry e viraram tarefa humana (DLQ) na janela.',
        ),
        aiLatency: this.percentiles(
          ai,
          'Tempo que o modelo levou para responder — só a chamada de IA, sem fila nem WhatsApp.',
          'Nenhum job de IA registrou latência na janela.',
        ),
        aiLatencyByModel: db.byModel.map((row) => ({
          model: row.model ?? 'não registrado',
          jobType: row.jobType,
          samples: row.samples,
          p50: this.nullableNumber(row.p50),
          p95: this.nullableNumber(row.p95),
          p99: this.nullableNumber(row.p99),
        })),
        aiLatencyP95Daily: this.fillDays(this.roundSeries(db.aiDaily)),
        whatsappLatency: this.percentiles(
          db.whatsapp,
          'Tempo que o aluno de fato espera pela resposta no WhatsApp — inclui fila, IA e envio.',
          'Nenhuma mensagem enviada registrou latência ponta-a-ponta na janela.',
        ),
        whatsappLatencyP95Daily: this.fillDays(this.roundSeries(db.whatsappDaily)),
        ragQueries: rag
          ? this.metric(
              rag.queries,
              'COUNT',
              'AVAILABLE',
              `Consultas do AI Coach à base de conhecimento nos últimos ${INSIGHT_WINDOW_DAYS} dias.`,
            )
          : this.unavailable(
              'COUNT',
              'Os contadores de uso do RAG vivem no Redis e não puderam ser lidos agora.',
            ),
        ragUsefulRetrievalRate:
          rag && rag.queries > 0
            ? this.metric(
                (rag.useful / rag.queries) * 100,
                'PERCENT',
                'AVAILABLE',
                'De cada 100 consultas, quantas encontraram um trecho relevante o bastante para ser usado na resposta. O resto é respondido sem material de apoio.',
              )
            : this.unavailable(
                'PERCENT',
                'Sem consultas ao RAG na janela (ou contadores indisponíveis); não há denominador.',
              ),
        ragCorpusChunks: this.metric(
          db.corpus?.total ?? 0,
          'COUNT',
          'AVAILABLE',
          'Trechos de conhecimento indexados e disponíveis para consulta.',
        ),
        slos: [
          this.slo({
            key: 'PROTOCOL_DELIVERY',
            title: 'Protocolo entregue em até 2 horas',
            objective: 'De cada 100 protocolos gerados, ao menos 95 ficam prontos em até 2 horas.',
            explanation:
              'Mede o tempo entre o pedido do protocolo e a conclusão da geração. É a promessa feita ao aluno no cadastro.',
            targetPercent: 95,
            good: ai?.protocolsWithinSla ?? 0,
            total: ai?.protocolsDelivered ?? 0,
          }),
          this.slo({
            key: 'COACH_RESPONSE',
            title: 'Resposta do AI Coach em até 30 segundos',
            objective:
              'De cada 100 respostas enviadas no WhatsApp, ao menos 95 chegam em até 30 segundos.',
            explanation:
              'Conta o tempo que o aluno espera, do envio da pergunta até a resposta chegar — não só o tempo do modelo.',
            targetPercent: 95,
            good: db.whatsapp?.withinSla ?? 0,
            total: db.whatsapp?.samples ?? 0,
          }),
          this.slo({
            key: 'AI_JOB_SUCCESS',
            title: 'Trabalhos de IA que terminam bem',
            objective: 'Ao menos 99 de cada 100 trabalhos de IA terminam sem erro.',
            explanation:
              'Cada geração de protocolo, resposta ou ajuste de check-in é um trabalho. Aqui entram os que falharam de vez.',
            targetPercent: 99,
            good: ai?.completed ?? 0,
            total: jobsWithOutcome,
          }),
          this.slo({
            key: 'AI_JOB_NO_DLQ',
            title: 'Trabalhos que não viraram tarefa manual',
            objective:
              'Menos de 1 em cada 200 trabalhos (0,5%) esgota as tentativas e precisa de alguém para resolver.',
            explanation:
              'Trabalho em DLQ é o que o sistema tentou várias vezes e desistiu: alguém da equipe precisa agir. É o custo operacional escondido.',
            targetPercent: 99.5,
            good: jobsWithOutcome - (ai?.dlq ?? 0),
            total: jobsWithOutcome,
          }),
        ],
        pendingCapabilities: [
          // US-8.8: "Custo de infraestrutura e de WhatsApp" saiu daqui — virou número na
          // US-8.4 (`expenses`) e é exibido no pilar Financeiro.
          {
            title: 'Histórico de incidentes e disponibilidade real (uptime)',
            reason:
              'A plataforma mede a si mesma no instante da consulta; não existe registro do que ficou fora do ar antes.',
            dependency: 'Registro de incidentes e probe externo contínuo',
            // Reapontado na US-8.8: o lote de Sistema inteiro foi movido para a Sprint 9.
            plannedFor: 'Sprint 9',
          },
          {
            title: 'Rastro ponta-a-ponta de uma requisição (tracing distribuído)',
            reason:
              'Dá para ver quanto demorou cada etapa isolada, mas não seguir uma mesma mensagem por todos os serviços.',
            dependency: 'Instrumentação OpenTelemetry e coletor',
            plannedFor: 'Fase 6 — Infraestrutura',
          },
        ],
      },
      [
        `Percentis, SLOs e uso do RAG cobrem os últimos ${INSIGHT_WINDOW_DAYS} dias em ${TIMEZONE}.`,
        'Latência de IA é o tempo do modelo; latência de WhatsApp é o tempo que o aluno espera. São coisas diferentes e aparecem separadas.',
        'Percentis saem de `percentile_cont` sobre a latência já persistida em cada job e em cada mensagem — não dependem de OpenTelemetry.',
        'Uso do RAG vem de contadores agregados no Redis: nenhuma pergunta de aluno é armazenada para esta métrica.',
        'Orçamento de erro acima de 100% significa meta estourada no período: é sinal de parar de entregar novidade e consertar.',
      ],
    );
  }

  /**
   * Painel "Sistema → Integração" — ferramenta INTERNA de teste do fluxo de WhatsApp
   * via EvolutionAPI. Sem tabela própria: a EvolutionAPI é a única fonte de verdade de
   * qual instância existe (`currentInstanceName` via `/instance/fetchInstances`) e do
   * estado real de conexão (`connectionState`, vocabulário confirmado open/connecting/
   * close). O backend é um proxy fino.
   */
  async integration(): Promise<ControlCenterIntegrationResponse> {
    if (!this.evolution.hasCredentials()) {
      return this.envelope({
        whatsapp: {
          configured: false,
          instanceName: null,
          status: 'NOT_CONFIGURED' as const,
          qrCodeBase64: null,
        },
      });
    }
    const instanceName = await this.evolution.currentInstanceName().catch(() => null);
    const status = instanceName
      ? await this.evolution.connectionState(instanceName).catch(() => 'DISCONNECTED' as const)
      : ('NOT_CONFIGURED' as const);
    // Enquanto aguarda o scan, busca o QR ATUAL a cada consulta (inclusive no polling
    // do painel) — sem isso o QR só existia na resposta de `createInstance()` e
    // qualquer refresh o perdia pra sempre, deixando o painel preso em "Conectando…"
    // sem nada pra escanear (bug real, corrigido 2026-08-18). Só em `CONNECTING`: em
    // `DISCONNECTED` chamar o mesmo endpoint reiniciaria a conexão a cada poll.
    const qrCodeBase64 =
      status === 'CONNECTING' && instanceName
        ? await this.evolution.fetchQrCode(instanceName).catch(() => null)
        : null;
    // Reasserção idempotente do webhook de ENTRADA (US-3.1-EVO). Fica aqui porque este é o
    // único ponto do sistema que já observa a transição para `CONNECTED` — o painel faz
    // polling deste método a cada 3s. O transporte lembra quais instâncias já registrou,
    // então isso NÃO vira um POST a cada poll. Best-effort: o painel nunca falha por causa
    // do webhook (`ensureWebhookConfigured` já engole o erro e loga).
    if (status === 'CONNECTED' && instanceName) {
      await this.evolution.ensureWebhookConfigured(instanceName);
    }
    return this.envelope({
      whatsapp: { configured: true, instanceName, status, qrCodeBase64 },
    });
  }

  async createWhatsappInstance(rawBody: unknown): Promise<ControlCenterIntegrationResponse> {
    const parsed = createWhatsappInstanceSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_INPUT', issues: parsed.error.issues });
    }
    const result = await this.evolution.createInstance(parsed.data.instanceName);
    return this.envelope({
      whatsapp: {
        configured: true,
        instanceName: parsed.data.instanceName,
        status: result.status,
        qrCodeBase64: result.qrCodeBase64,
      },
    });
  }

  /** `percentile_cont` ignora nulos por definição — o filtro fica na cláusula WHERE. */
  private percentile(fraction: number, column: SQLWrapper) {
    return sql<
      string | number | null
    >`percentile_cont(${fraction}) within group (order by ${column})`;
  }

  private percentiles(
    row: { samples: number; p50: unknown; p95: unknown; p99: unknown } | undefined,
    definition: string,
    emptyReason: string,
  ) {
    const samples = row?.samples ?? 0;
    if (!row || samples === 0) {
      return {
        samples: 0,
        p50: this.unavailable('MILLISECONDS', emptyReason),
        p95: this.unavailable('MILLISECONDS', emptyReason),
        p99: this.unavailable('MILLISECONDS', emptyReason),
      };
    }
    const at = (label: string, value: unknown) =>
      this.metric(
        this.number(value as string | number | null),
        'MILLISECONDS',
        'AVAILABLE',
        `${label} ${definition} Amostra: ${samples} registros na janela.`,
      );
    return {
      samples,
      p50: at('Metade das vezes é mais rápido que isso.', row.p50),
      p95: at('95 de cada 100 vezes é mais rápido que isso.', row.p95),
      p99: at('99 de cada 100 vezes é mais rápido que isso.', row.p99),
    };
  }

  /**
   * Semáforo + orçamento de erro. O orçamento é a folga que a meta concede:
   * meta de 95% permite 5% de falha, e consumir 41% desse orçamento significa
   * ter gasto 41% da folga do período. Acima de 100%, a meta já foi estourada.
   */
  private slo(input: {
    key: string;
    title: string;
    objective: string;
    explanation: string;
    targetPercent: number;
    good: number;
    total: number;
  }) {
    const { good, total, targetPercent } = input;
    if (total === 0) {
      return {
        ...this.sloBase(input),
        currentPercent: null,
        samples: 0,
        errorBudgetConsumedPercent: null,
        status: 'UNKNOWN' as const,
      };
    }
    const currentPercent = (Math.max(good, 0) / total) * 100;
    const budget = 100 - targetPercent;
    const consumed = budget <= 0 ? 0 : ((100 - currentPercent) / budget) * 100;
    const errorBudgetConsumedPercent = Math.max(0, Math.round(consumed * 10) / 10);
    return {
      ...this.sloBase(input),
      currentPercent: Math.round(currentPercent * 100) / 100,
      samples: total,
      errorBudgetConsumedPercent,
      status:
        errorBudgetConsumedPercent >= 100
          ? ('RED' as const)
          : errorBudgetConsumedPercent >= 75
            ? ('YELLOW' as const)
            : ('GREEN' as const),
    };
  }

  private sloBase(input: {
    key: string;
    title: string;
    objective: string;
    explanation: string;
    targetPercent: number;
  }) {
    return {
      key: input.key,
      title: input.title,
      objective: input.objective,
      explanation: input.explanation,
      targetPercent: input.targetPercent,
    };
  }

  /**
   * Contadores diários de RAG no Redis. Falha de leitura devolve `null` — o painel
   * mostra "indisponível", nunca zero (zero seria lido como "o RAG não é usado").
   */
  private async ragUsage(): Promise<{ queries: number; useful: number } | null> {
    try {
      const days: string[] = [];
      for (let offset = INSIGHT_WINDOW_DAYS - 1; offset >= 0; offset -= 1) {
        days.push(ragUsageDay(new Date(Date.now() - offset * 86_400_000)));
      }
      const keys = days.map((day) => ragUsageKeys(this.redisKeys, day));
      const values = await this.redis.mget([
        ...keys.map((key) => key.queries),
        ...keys.map((key) => key.useful),
      ]);
      const sum = (slice: Array<string | null>) =>
        slice.reduce((total, value) => total + this.number(value), 0);
      return {
        queries: sum(values.slice(0, days.length)),
        useful: sum(values.slice(days.length)),
      };
    } catch {
      return null;
    }
  }

  /** Percentil é fracionário; a série do contrato é de inteiros não negativos. */
  private roundSeries(rows: Array<{ day: string; total: unknown }>) {
    return rows.map((row) => ({
      day: row.day,
      total: Math.max(0, Math.round(this.number(row.total as string | number | null))),
    }));
  }

  private nullableNumber(value: string | number | null | undefined): number | null {
    return value == null ? null : this.number(value);
  }

  async finance(): Promise<ControlCenterFinanceResponse> {
    const data = await this.db.runAsSystem(async (tx) => {
      const [row] = await tx
        .select({
          active: sql<number>`count(*) filter (where ${subscriptions.status} = 'ACTIVE')::int`,
          contractedMrr: sql<string>`coalesce(sum(case
            when ${subscriptions.status} <> 'ACTIVE' then 0
            when ${subscriptions.plan} = 'MONTHLY' then ${subscriptions.priceCents} / 100.0
            when ${subscriptions.plan} = 'QUARTERLY' then ${subscriptions.priceCents} / 300.0
            when ${subscriptions.plan} = 'SEMIANNUAL' then ${subscriptions.priceCents} / 600.0
            when ${subscriptions.plan} = 'ANNUAL' then ${subscriptions.priceCents} / 1200.0
            else 0 end), 0)`,
        })
        .from(subscriptions);

      // MRR/ARR por plano: o SQL soma o preço contratado, a normalização por meses do
      // plano fica em `PLAN_MONTHS` — uma fórmula só, legível, fora do texto SQL.
      const planRows = await tx
        .select({
          plan: subscriptions.plan,
          active: sql<number>`count(*)::int`,
          contractedBrl: sql<string>`coalesce(sum(${subscriptions.priceCents}), 0) / 100.0`,
        })
        .from(subscriptions)
        .where(eq(subscriptions.status, 'ACTIVE'))
        .groupBy(subscriptions.plan);

      // Calendário de renovação: `current_period_end` agrupado por mês civil e plano.
      // group by ordinal — a expressão de mês reemite parâmetros próprios (ver overview()).
      const renewalRows = await tx
        .select({
          month: sql<string>`to_char(${subscriptions.currentPeriodEnd} at time zone ${TIMEZONE}, 'YYYY-MM')`,
          plan: subscriptions.plan,
          subscriptions: sql<number>`count(*)::int`,
          amountBrl: sql<string>`coalesce(sum(${subscriptions.priceCents}), 0) / 100.0`,
        })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.status, 'ACTIVE'),
            sql`${subscriptions.currentPeriodEnd} >= now()`,
            sql`${subscriptions.currentPeriodEnd} < now() + ${this.days(RENEWAL_HORIZON_DAYS)}`,
          ),
        )
        .groupBy(sql`1`, subscriptions.plan)
        .orderBy(sql`1`, subscriptions.plan);

      const atRiskRows = await tx
        .select({
          subscriptionId: subscriptions.id,
          plan: subscriptions.plan,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
          amountBrl: sql<string>`${subscriptions.priceCents} / 100.0`,
        })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.status, 'ACTIVE'),
            sql`${subscriptions.currentPeriodEnd} >= now()`,
            sql`${subscriptions.currentPeriodEnd} < now() + ${this.days(AT_RISK_WINDOW_DAYS)}`,
            sql`not exists (
              select 1 from ${conversations} c
              where c.user_id = ${subscriptions.userId}
                and c.direction = 'INBOUND'
                and c.created_at >= now() - ${this.days(RISK_SILENCE_DAYS)}
            )`,
          ),
        )
        .orderBy(subscriptions.currentPeriodEnd)
        .limit(100);

      // `cancel_reason` é gravado desde a Sprint 4 e esta é a primeira leitura no produto.
      const churnRows = await tx
        .select({
          reason: sql<string>`coalesce(nullif(btrim(${subscriptions.cancelReason}), ''), 'NAO_INFORMADO')`,
          total: sql<number>`count(*)::int`,
          last90Days: sql<number>`count(*) filter (
            where ${subscriptions.canceledAt} >= now() - ${this.days(RENEWAL_HORIZON_DAYS)}
          )::int`,
        })
        .from(subscriptions)
        .where(isNotNull(subscriptions.canceledAt))
        .groupBy(sql`1`)
        .orderBy(sql`2 desc`);

      // Custo de IA por modelo com preço vigente **na data de cada job** (ver
      // `AI_PRICE_LATERAL`). Sai do query builder porque LATERAL não é expresso por ele;
      // o custo é somado linha a linha, então dois preços no mesmo mês somam certo.
      const aiRows = (await tx.execute(sql`
        select
          coalesce(${aiJobs.modelUsed}, 'DESCONHECIDO') as model,
          count(*)::int as jobs,
          coalesce(sum(${aiJobs.tokensInput}), 0)::int as tokens_input,
          coalesce(sum(${aiJobs.tokensOutput}), 0)::int as tokens_output,
          count(price.input_cents)::int as priced_jobs,
          coalesce(sum(
            (coalesce(${aiJobs.tokensInput}, 0) / 1000.0) * price.input_cents / 100.0
            + (coalesce(${aiJobs.tokensOutput}, 0) / 1000.0) * price.output_cents / 100.0
          ), 0)::float8 as cost_usd
        from ${aiJobs}
        ${AI_PRICE_LATERAL}
        where ${aiJobs.createdAt} >= now() - ${this.days(AI_COST_WINDOW_DAYS)}
        group by 1
      `)) as unknown as Array<{
        model: string;
        jobs: number;
        tokens_input: number;
        tokens_output: number;
        priced_jobs: number;
        cost_usd: number;
      }>;

      // Despesas lançadas (US-8.4). Estorno é linha negativa: `sum` já devolve o líquido.
      const expenseRows = await tx
        .select({
          month: sql<string>`to_char(${expenses.occurredOn}, 'YYYY-MM')`,
          category: expenses.category,
          amountCents: sql<string>`sum(${expenses.amountCents})`,
        })
        .from(expenses)
        .where(sql`${expenses.occurredOn} >= date_trunc('month', now() - interval '11 months')`)
        .groupBy(sql`1`, expenses.category)
        .orderBy(sql`1`);

      // ---- Liquidação recebida (US-8.5) ----
      // Estorno/chargeback é linha NEGATIVA em `payments`, então `sum` já devolve o
      // líquido do mês sem nenhum CASE — a mesma propriedade que `expenses` tem.
      const paymentRows = await tx
        .select({
          month: sql<string>`to_char(${payments.occurredAt} at time zone ${TIMEZONE}, 'YYYY-MM')`,
          grossCents: sql<string>`coalesce(sum(${payments.amountCents}), 0)`,
          netCents: sql<string>`coalesce(sum(${payments.netAmountCents}), 0)`,
          settlements: sql<number>`count(*) filter (where ${payments.status} = 'SETTLED')::int`,
          failures: sql<number>`count(*) filter (where ${payments.status} = 'FAILED')::int`,
        })
        .from(payments)
        .where(sql`${payments.occurredAt} >= date_trunc('month', now() - interval '11 months')`)
        .groupBy(sql`1`)
        .orderBy(sql`1`);

      // Prazo de liquidação: dias entre o início do período contratado e a entrada do
      // dinheiro. Só sobre liquidação VINCULADA — a órfã não tem período de referência.
      const [settlementLag] = await tx
        .select({
          days: sql<
            string | null
          >`avg(extract(epoch from (${payments.occurredAt} - ${subscriptions.currentPeriodStart})) / 86400.0)`,
        })
        .from(payments)
        .innerJoin(subscriptions, eq(payments.subscriptionId, subscriptions.id))
        .where(
          and(
            eq(payments.status, 'SETTLED'),
            isNotNull(subscriptions.currentPeriodStart),
            sql`${payments.occurredAt} >= now() - ${this.days(RENEWAL_HORIZON_DAYS)}`,
          ),
        );

      // Fila de exceção: liquidação autenticada sem assinatura correspondente. Nunca é
      // descartada — fica aqui até alguém conciliar à mão. Sem PII: não tem titular.
      const paymentExceptionRows = await tx
        .select({
          paymentId: payments.id,
          gateway: payments.gateway,
          status: payments.status,
          amountCents: payments.amountCents,
          occurredAt: payments.occurredAt,
          receivedAt: payments.receivedAt,
        })
        .from(payments)
        .where(isNull(payments.subscriptionId))
        .orderBy(desc(payments.receivedAt))
        .limit(100);

      const currentMonth = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
      }).format(new Date());

      const active = row?.active ?? 0;
      const aiCostByModel = aiRows.map((model) => ({
        model: model.model,
        jobs: Number(model.jobs),
        tokensInput: Number(model.tokens_input),
        tokensOutput: Number(model.tokens_output),
        // Sem nenhum job precificado o custo é `null` (indisponível), nunca zero.
        costBrl: Number(model.priced_jobs) > 0 ? Number(model.cost_usd) * USD_TO_BRL : null,
      }));
      const unpricedModels = aiCostByModel.filter((model) => model.costBrl === null);
      const pricedCost = aiCostByModel.reduce((sum, model) => sum + (model.costBrl ?? 0), 0);
      const aiCostUnavailable =
        aiCostByModel.length > 0 && unpricedModels.length === aiCostByModel.length;
      const aiCostDefinition = `Custo calculado dos últimos ${AI_COST_WINDOW_DAYS} dias: tokens de ai_jobs × preço por 1k tokens vigente na data de cada job (tabela \`model_pricing\`), convertido a R$ pelo câmbio fixo de ${USD_TO_BRL}.`;
      const aiCost = aiCostUnavailable
        ? this.unavailable(
            'BRL',
            `Nenhum modelo com job no período tem preço vigente em \`model_pricing\` (${unpricedModels.map((model) => model.model).join(', ')}).`,
          )
        : this.metric(pricedCost, 'BRL', 'PROXY', aiCostDefinition);

      const entryCohorts = await this.entryCohorts(tx);

      const atRiskTotal = atRiskRows.reduce((sum, item) => sum + this.number(item.amountBrl), 0);

      // ---- Despesa, custo por categoria/mês e resultado (US-8.4) ----
      const brl = (cents: string | number | null) => this.number(cents) / 100;
      const costByCategory = Object.entries(
        expenseRows.reduce<Record<string, number>>((acc, item) => {
          acc[item.category] = (acc[item.category] ?? 0) + brl(item.amountCents);
          return acc;
        }, {}),
      )
        .map(([category, amountBrl]) => ({ category: category as ExpenseCategory, amountBrl }))
        .sort((a, b) => b.amountBrl - a.amountBrl);
      const costByMonth = Object.entries(
        expenseRows.reduce<Record<string, number>>((acc, item) => {
          acc[item.month] = (acc[item.month] ?? 0) + brl(item.amountCents);
          return acc;
        }, {}),
      )
        .map(([month, amountBrl]) => ({ month, amountBrl }))
        .sort((a, b) => a.month.localeCompare(b.month));
      const hasExpenses = expenseRows.length > 0;
      const contractedMrrBrl = this.number(row?.contractedMrr);

      // ---- Receita recebida × contratada (US-8.5) ----
      // As duas séries nascem de fontes distintas e são devolvidas em campos distintos.
      // Nada aqui as combina, e é essa separação que torna a soma indevida impossível na
      // tela (regra 3 da sprint): a diferença entre elas É a informação.
      const receivedRevenueByMonth = paymentRows.map((item) => ({
        month: item.month,
        grossBrl: brl(item.grossCents),
        netBrl: brl(item.netCents),
        settlements: Number(item.settlements),
      }));
      const monthPayments = paymentRows.find((item) => item.month === currentMonth);
      const hasPayments = paymentRows.length > 0;
      const receivedGrossBrl = brl(monthPayments?.grossCents ?? 0);
      const receivedNetBrl = brl(monthPayments?.netCents ?? 0);
      /** Taxa do gateway = bruto − líquido. Não há terceira coluna que possa divergir. */
      const gatewayFeeBrl = receivedGrossBrl - receivedNetBrl;
      const attempts =
        Number(monthPayments?.settlements ?? 0) + Number(monthPayments?.failures ?? 0);

      // Taxa do gateway entra em Custos como despesa real da categoria que já existe. Não
      // é lançada em `expenses` (ninguém digita taxa de cartão): vem de `payments`, que é
      // a fonte primária. Somar as duas fontes na mesma categoria não duplica nada.
      const gatewayFeeByMonth = paymentRows
        .map((item) => ({
          month: item.month,
          amountBrl: brl(item.grossCents) - brl(item.netCents),
        }))
        .filter((item) => item.amountBrl !== 0);
      if (gatewayFeeByMonth.length > 0) {
        const totalFee = gatewayFeeByMonth.reduce((sum, item) => sum + item.amountBrl, 0);
        const existing = costByCategory.find((item) => item.category === 'GATEWAY_PAGAMENTO');
        if (existing) existing.amountBrl += totalFee;
        else costByCategory.push({ category: 'GATEWAY_PAGAMENTO', amountBrl: totalFee });
        costByCategory.sort((a, b) => b.amountBrl - a.amountBrl);
        for (const fee of gatewayFeeByMonth) {
          const month = costByMonth.find((item) => item.month === fee.month);
          if (month) month.amountBrl += fee.amountBrl;
          else costByMonth.push({ month: fee.month, amountBrl: fee.amountBrl });
        }
        costByMonth.sort((a, b) => a.month.localeCompare(b.month));
      }

      const monthExpense = costByMonth.find((item) => item.month === currentMonth)?.amountBrl ?? 0;

      return {
        activeSubscriptions: this.metric(
          active,
          'COUNT',
          'AVAILABLE',
          'Assinaturas ativas, sem PII do titular.',
        ),
        contractedMrr: this.metric(
          this.number(row?.contractedMrr),
          'BRL',
          'AVAILABLE',
          'Receita mensal contratada normalizada pelo período do plano (MRR = preço do plano ÷ meses do plano).',
        ),
        aiCost,
        aiCostPerActiveUser:
          active === 0 || aiCostUnavailable
            ? this.unavailable(
                'BRL',
                'Sem assinatura ativa (ou sem modelo precificado) não há denominador para o custo de IA por usuário.',
              )
            : this.metric(
                pricedCost / active,
                'BRL',
                'PROXY',
                `Custo de IA dos últimos ${AI_COST_WINDOW_DAYS} dias dividido pelas assinaturas ativas.`,
              ),
        whatsappCost: this.unavailable(
          'BRL',
          'O provedor de WhatsApp ainda não persiste custo por mensagem.',
        ),
        infrastructureCost: hasExpenses
          ? this.metric(
              costByCategory.find((item) => item.category === 'INFRA')?.amountBrl ?? 0,
              'BRL',
              'AVAILABLE',
              'Soma das despesas lançadas na categoria INFRA nos últimos 12 meses (líquido de estornos).',
            )
          : this.unavailable(
              'BRL',
              'Nenhuma despesa lançada ainda — `expenses` existe, mas está vazia.',
            ),
        totalExpense: hasExpenses
          ? this.metric(
              monthExpense,
              'BRL',
              'AVAILABLE',
              'Despesa do mês corrente por competência (`occurred_on`), líquida de estornos.',
            )
          : this.unavailable('BRL', 'Nenhuma despesa lançada ainda.'),
        expensePerActiveUser:
          !hasExpenses || active === 0
            ? this.unavailable(
                'BRL',
                'Sem despesa lançada (ou sem assinatura ativa como denominador) não há custo por usuário.',
              )
            : this.metric(
                monthExpense / active,
                'BRL',
                'AVAILABLE',
                'Despesa do mês corrente dividida pelas assinaturas ativas — o custo por usuário ativo/mês do unit economics.',
              ),
        /**
         * Receita **recebida** do mês, do que liquidou no gateway. Grandeza distinta de
         * `contractedMrr` — as duas convivem na tela e nunca são somadas.
         */
        receivedRevenue: hasPayments
          ? this.metric(
              receivedGrossBrl,
              'BRL',
              'AVAILABLE',
              'Bruto efetivamente liquidado no gateway no mês corrente, por data de liquidação (`occurred_at`), já líquido de estornos e chargebacks (que entram como linha negativa). Não é receita contratada.',
            )
          : this.unavailable(
              'BRL',
              'Nenhuma liquidação registrada ainda — `payments` existe, mas está vazia (nenhum webhook de pagamento chegou).',
            ),
        /**
         * Lucro do período = receita recebida − despesa do mês corrente.
         *
         * **Regime CAIXA** desde a US-8.5: a receita agora vem de `payments` (liquidação
         * real), não mais do `contractedMrr` como proxy. Sem nenhuma liquidação registrada
         * o regime cai de volta para `CONTRATADO_PROXY` e a métrica volta a ser `PROXY` —
         * a tela jamais chama de caixa um número que não é.
         *
         * Usa o BRUTO recebido, não o líquido: a taxa do gateway já está somada em
         * `monthExpense` (via `costByMonth`), então subtrair o líquido a contaria duas vezes.
         */
        profit: !hasExpenses
          ? this.unavailable(
              'BRL',
              'Nenhuma despesa lançada ainda: `expenses` existe, mas exibir lucro sem custo seria inventar.',
            )
          : hasPayments
            ? this.metric(
                receivedGrossBrl - monthExpense,
                'BRL',
                'AVAILABLE',
                'Lucro do mês corrente em regime de CAIXA = receita recebida (liquidação do gateway) − despesa do mês, incluindo a taxa do gateway como custo.',
              )
            : this.metric(
                contractedMrrBrl - monthExpense,
                'BRL',
                'PROXY',
                'Lucro do mês corrente = MRR contratado − despesa lançada no mês. Regime provisório: receita CONTRATADA (proxy), não recebida — nenhuma liquidação foi registrada em `payments` ainda.',
              ),
        partnerDistribution: this.unavailable(
          'BRL',
          'Distribuição por sócio passou a existir na US-8.7 e é exibida em Sócios & Distribuição, sob `control_center.partners.read` (somente ADMIN) — fora do alcance do papel financeiro por decisão de governança, não por falta de dado.',
        ),
        customerAcquisitionCost: this.unavailable(
          'BRL',
          'CAC passou a existir na US-8.6 e é publicado por canal em Marketing → Aquisição & Canais, com a janela de atribuição declarada. Não há CAC consolidado aqui porque o investimento é registrado por canal.',
        ),
        revenueAtRisk30d: this.metric(
          atRiskTotal,
          'BRL',
          'PROXY',
          `Preço contratado das assinaturas ativas que vencem em ${AT_RISK_WINDOW_DAYS} dias sem nenhuma mensagem recebida do titular há ${RISK_SILENCE_DAYS} dias.`,
        ),
        entryCohorts: entryCohorts.cohorts,
        suppressedCohorts: entryCohorts.suppressed,
        renewalCalendar: renewalRows.map((slice) => ({
          month: slice.month,
          plan: slice.plan,
          subscriptions: slice.subscriptions,
          amountBrl: this.number(slice.amountBrl),
        })),
        subscriptionsAtRisk: atRiskRows.map((item) => ({
          subscriptionId: item.subscriptionId,
          plan: item.plan,
          currentPeriodEnd: (item.currentPeriodEnd ?? new Date()).toISOString(),
          amountBrl: this.number(item.amountBrl),
          riskSignal: `Sem mensagem recebida há ${RISK_SILENCE_DAYS} dias`,
        })),
        churnByReason: churnRows,
        mrrByPlan: planRows.map((plan) => {
          const mrr = this.number(plan.contractedBrl) / (PLAN_MONTHS[plan.plan] ?? 1);
          return {
            plan: plan.plan,
            activeSubscriptions: plan.active,
            mrrBrl: mrr,
            arrBrl: mrr * 12,
          };
        }),
        aiCostByModel,
        costByCategory,
        costByMonth,

        // ---- Liquidação recebida (US-8.5) ----
        receivedRevenueByMonth,
        projection: buildFinancialProjection(costByMonth, receivedRevenueByMonth, currentMonth),
        delinquencyRate:
          attempts === 0
            ? this.unavailable(
                'PERCENT',
                'Nenhuma cobrança tentada no mês corrente — sem denominador não há taxa de inadimplência (zero seria lido como "ninguém deixou de pagar").',
              )
            : this.metric(
                (Number(monthPayments?.failures ?? 0) / attempts) * 100,
                'PERCENT',
                'AVAILABLE',
                'Cobranças que falharam sobre o total de tentativas (falhas + liquidações) do mês corrente, por data do evento no gateway.',
              ),
        averageSettlementDays:
          settlementLag?.days == null
            ? this.unavailable(
                'COUNT',
                'Nenhuma liquidação vinculada a uma assinatura com período iniciado no horizonte — não há de onde medir o prazo.',
              )
            : this.metric(
                this.number(settlementLag.days),
                'COUNT',
                'AVAILABLE',
                `Média, em dias, entre o início do período contratado e a liquidação no gateway, sobre as cobranças liquidadas dos últimos ${RENEWAL_HORIZON_DAYS} dias.`,
              ),
        gatewayFee: hasPayments
          ? this.metric(
              gatewayFeeBrl,
              'BRL',
              'AVAILABLE',
              'Taxa retida pelo gateway no mês corrente = bruto liquidado − líquido creditado. Aparece também em Custos, na categoria GATEWAY_PAGAMENTO.',
            )
          : this.unavailable('BRL', 'Nenhuma liquidação registrada ainda.'),
        // Taxa exatamente zero quase sempre significa "o provedor não informou a taxa", e
        // não "não houve taxa". Marcar indisponível é mais honesto que exibir 0%.
        gatewayFeePercent:
          !hasPayments || receivedGrossBrl === 0 || gatewayFeeBrl === 0
            ? this.unavailable(
                'PERCENT',
                'O gateway não informou taxa nas liquidações do mês (bruto igual ao líquido) — exibir 0% seria afirmar que não há taxa.',
              )
            : this.metric(
                (gatewayFeeBrl / receivedGrossBrl) * 100,
                'PERCENT',
                'AVAILABLE',
                'Taxa efetiva do gateway no mês = taxa retida ÷ bruto liquidado.',
              ),
        paymentExceptions: paymentExceptionRows.map((item) => ({
          paymentId: item.paymentId,
          gateway: item.gateway,
          status: item.status,
          amountBrl: item.amountCents / 100,
          occurredAt: (item.occurredAt ?? new Date()).toISOString(),
          receivedAt: (item.receivedAt ?? new Date()).toISOString(),
        })),

        /** Regime declarado na tela. Ver o comentário de `profit`. */
        profitBasis: hasPayments ? ProfitBasis.CAIXA : ProfitBasis.CONTRATADO_PROXY,
      };
    });
    return this.envelope(data, [
      'Nenhum identificador de titular é retornado; a lista de risco usa o id da assinatura.',
      `Calendário de renovação cobre ${RENEWAL_HORIZON_DAYS} dias de receita contratada a vencer — não é projeção de vendas novas.`,
      'MRR = preço do plano ÷ meses do plano; ARR = MRR × 12. Receita contratada, não caixa recebido.',
      'Custo de IA usa o preço de `model_pricing` vigente na data de cada job (não o preço de hoje) e câmbio fixo.',
      'Receita CONTRATADA e receita RECEBIDA são grandezas distintas e nunca devem ser somadas: a diferença entre elas é inadimplência, falha de cartão e prazo de liquidação.',
      'Lucro sai em regime de CAIXA assim que existe liquidação em `payments`; sem nenhuma, volta a exibir o proxy de receita contratada com o regime declarado. O campo `profitBasis` diz qual dos dois está valendo.',
      'A taxa do gateway vem de `payments` (bruto − líquido) e entra em Custos na categoria GATEWAY_PAGAMENTO; o lucro usa o bruto recebido para não descontar a taxa duas vezes.',
      'Liquidação sem assinatura correspondente não é descartada: fica em `paymentExceptions` até ser conciliada à mão.',
      'Estorno e chargeback são linha nova de sinal contrário em `payments` — a linha da cobrança original nunca é alterada, e por isso as somas já saem líquidas.',
      'Custo por categoria/mês cobre 12 meses por competência (`occurred_on`), líquido de estornos — correção de lançamento é estorno + relançamento, nunca edição.',
      'Projeção de resultado continua fora de escopo (Sprint 11): esta tela mostra resultado realizado, nunca projetado.',
      'CAC e distribuição por sócio existem, mas fora desta tela: CAC é por canal em Marketing (US-8.6) e a distribuição fica em Sócios & Distribuição, sob capability restrita ao ADMIN (US-8.7).',
      'Coorte mensal de entrada: mês da primeira entrada em trial; "retido" = assinatura hoje ACTIVE. Coortes com menos de 10 entradas são omitidas.',
      'Coorte marcada como reconstruída vem do backfill de `subscriptions` (actor BACKFILL), não de evento observado — comparar com coorte observada exige essa ressalva.',
    ]);
  }

  async compliance(): Promise<ControlCenterComplianceResponse> {
    const data = await this.db.runAsSystem(async (tx) => {
      const [consentCounts] = await tx
        .select({
          active: sql<number>`count(*) filter (where ${consents.accepted} = true and ${consents.revokedAt} is null)::int`,
          revoked: sql<number>`count(*) filter (where ${consents.revokedAt} is not null)::int`,
        })
        .from(consents);
      const [healthReads] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(eq(auditLogs.action, 'HEALTH_DATA_VIEWED'));
      const recent = await tx
        .select({
          id: auditLogs.id,
          actorId: auditLogs.actorId,
          subjectId: auditLogs.userId,
          action: auditLogs.action,
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt))
        .limit(100);
      return {
        activeConsents: this.metric(
          consentCounts?.active ?? 0,
          'COUNT',
          'AVAILABLE',
          'Provas de consentimento aceitas e não revogadas.',
        ),
        revokedConsents: this.metric(
          consentCounts?.revoked ?? 0,
          'COUNT',
          'AVAILABLE',
          'Provas de consentimento revogadas.',
        ),
        auditedHealthReads: this.metric(
          healthReads?.total ?? 0,
          'COUNT',
          'AVAILABLE',
          'Eventos imutáveis de leitura de dados de saúde.',
        ),
        privacyRequests: this.unavailable(
          'COUNT',
          'Solicitações LGPD ainda não possuem workflow persistido.',
        ),
        recentAuditEvents: recent.map((event) => ({
          ...event,
          createdAt: event.createdAt.toISOString(),
        })),
      };
    });
    return this.envelope(data, [
      'A projeção omite IP, user-agent, conteúdo e alterações detalhadas.',
      'Workflow de solicitações LGPD ainda não existe.',
    ]);
  }

  /**
   * Trilha de acesso EM MASSA a PII (Sato — achado A3). `student()` audita o acesso
   * individual com o titular no `user_id`; numa lista de até 200 titulares não existe um
   * titular único, então o evento é registrado sobre o próprio ator (`user_id = actorId`),
   * com a quantidade de registros devolvidos. O `created_at` vem do `DEFAULT now()` e o
   * encadeamento de hash, do trigger — a linha é imutável como qualquer outra da trilha.
   */
  private async auditListAccess(
    tx: TenantTransaction,
    actor: AuthenticatedUser,
    action: string,
    entityType: string,
    recordCount: number,
  ): Promise<void> {
    await this.audit.append(tx, {
      actorId: actor.userId,
      userId: actor.userId,
      action,
      entityType,
      entityId: actor.userId,
      changes: { purpose: 'control_center_list', role: actor.role, recordCount },
    });
  }

  /**
   * `${users.id}` (Column) interpolado dentro do template NÃO qualifica com a tabela
   * (achado 2026-08-25) — vira `"id"` cru no SQL gerado, e como toda tabela tem sua
   * própria coluna `id`, o Postgres resolve pro escopo mais interno (`s.id`/`p.id`),
   * nunca pro `users.id` da query externa. Resultado: `s.user_id = s.id` — comparação
   * sempre falsa, subquery sempre vazia, campo sempre `null` sem erro nenhum (silencioso
   * o bastante pra passar despercebido em produção). Fix: literal `users.id` como texto
   * no template, não interpolação de Column — sempre correlaciona com o `FROM users`
   * externo, que estas três funções assumem existir sem alias em todo call site.
   */
  private latestSubscriptionStatus() {
    return sql<string | null>`(
      select s.status::text from ${subscriptions} s
      where s.user_id = users.id order by s.created_at desc limit 1
    )`;
  }

  private latestSubscriptionPlan() {
    return sql<string | null>`(
      select s.plan::text from ${subscriptions} s
      where s.user_id = users.id order by s.created_at desc limit 1
    )`;
  }

  private latestProtocolStatus() {
    return sql<string | null>`(
      select p.status::text from ${protocols} p
      where p.user_id = users.id order by p.created_at desc limit 1
    )`;
  }

  private projectRoutine(value: unknown) {
    const parsed = anamnesisStructuredSchema.safeParse(value);
    if (!parsed.success) return null;
    const routine = parsed.data;
    return {
      primaryGoal: routine.primaryGoal,
      trainingStatus: routine.trainingStatus,
      experience: routine.experience,
      daysPerWeek: routine.daysPerWeek,
      preferredDays: routine.preferredDays,
      sessionDuration: routine.sessionDuration,
      location: routine.location,
      preferredPeriod: routine.preferredPeriod,
    };
  }

  /**
   * Dia civil em `America/Sao_Paulo`. O agrupamento precisa ser no fuso do
   * envelope, senão a virada do dia sai deslocada em 3h no gráfico.
   */
  private localDay(column: SQLWrapper) {
    return sql<string>`to_char(${column} at time zone ${TIMEZONE}, 'YYYY-MM-DD')`;
  }

  /** Intervalo literal em dias. Só recebe constante de código, nunca entrada de usuário. */
  private days(count: number) {
    return sql.raw(`interval '${count} days'`);
  }

  private localPart(part: 'dow' | 'hour', column: SQLWrapper) {
    return sql<number>`extract(${sql.raw(part)} from ${column} at time zone ${TIMEZONE})::int`;
  }

  /**
   * Preenche com zero os dias sem evento: um gráfico de linha com buracos
   * sugere queda inexistente. As chaves são geradas no mesmo fuso do `to_char`.
   */
  private fillDays(rows: Array<{ day: string; total: number }>) {
    const counts = new Map(rows.map((row) => [row.day, Number(row.total)]));
    const points: Array<{ date: string; value: number }> = [];
    for (let offset = INSIGHT_WINDOW_DAYS - 1; offset >= 0; offset -= 1) {
      const date = DAY_FORMATTER.format(new Date(Date.now() - offset * 86_400_000));
      points.push({ date, value: counts.get(date) ?? 0 });
    }
    return points;
  }

  /**
   * Grade completa 7x24 — o heatmap do frontend não precisa inferir célula ausente.
   *
   * Célula entre 1 e 9 é suprimida (vira 0): dia-da-semana × hora de cadastro é
   * quase-identificador, e uma célula com uma pessoa diz literalmente "alguém se
   * cadastrou terça às 20h". Vale a mesma regra dos segmentos (US-7.3: **0** células
   * exibidas com n < 10). Nenhuma marginal (total por dia/hora) é publicada junto,
   * então a supressão não é recomponível por subtração.
   */
  private fillHeatmap(rows: Array<{ dayOfWeek: number; hour: number; total: number }>) {
    const counts = new Map(rows.map((row) => [`${row.dayOfWeek}:${row.hour}`, Number(row.total)]));
    const cells: Array<{ dayOfWeek: number; hour: number; value: number }> = [];
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        const total = counts.get(`${dayOfWeek}:${hour}`) ?? 0;
        cells.push({ dayOfWeek, hour, value: total < MINIMUM_SEGMENT_SIZE ? 0 : total });
      }
    }
    return cells;
  }

  /**
   * CTE compartilhada pelo funil e pelas coortes (US-8.3): primeira entrada em trial e
   * primeira conversão por titular, mais a marca de reconstrução. `min()` porque o marco pode
   * repetir ao longo da vida do titular (renovação, nova assinatura) e a coorte é de **entrada**.
   */
  private readonly lifecycleCte = sql`
    with entry as (
      select user_id,
             min(occurred_at) as started,
             bool_or(actor = 'BACKFILL') as reconstructed
      from ${userStatusTransitions}
      where to_status = 'TRIAL_STARTED'
      group by user_id
    ),
    conv as (
      select user_id, min(occurred_at) as converted_at
      from ${userStatusTransitions}
      where to_status = 'CONVERTED'
      group by user_id
    )
  `;

  /**
   * Funil trial→ativo (US-8.3/TASK-8.3.4). `percentile_cont` ignora nulo, então o tempo
   * mediano é calculado só sobre quem converteu — a mediana de "dias até converter" não tem
   * definição para quem não converteu, e preenchê-la com zero ou com a janela aberta mentiria.
   *
   * k-anonimato: abaixo de `MINIMUM_SEGMENT_SIZE` entradas a coorte inteira fica indisponível.
   * Publicar 3 entradas e 1 conversão em uma base pequena é reidentificação direta.
   */
  private async trialConversion(tx: TenantTransaction): Promise<ControlCenterTrialConversion> {
    const [row] = await tx.execute<{
      trials: number;
      converted: number;
      median_days: string | null;
      reconstructed: number;
    }>(sql`
      ${this.lifecycleCte}
      select
        count(*)::int as trials,
        count(conv.user_id)::int as converted,
        percentile_cont(0.5) within group (
          order by extract(epoch from (conv.converted_at - entry.started)) / 86400.0
        ) as median_days,
        count(*) filter (where entry.reconstructed)::int as reconstructed
      from entry
      -- Conversão anterior à entrada não é conversão desta coorte (dado reconstruído com
      -- datas fora de ordem existe): sem o predicado a mediana sairia negativa.
      left join conv on conv.user_id = entry.user_id and conv.converted_at >= entry.started
    `);

    const trials = row?.trials ?? 0;
    const converted = row?.converted ?? 0;
    if (trials < MINIMUM_SEGMENT_SIZE) {
      return {
        status: 'UNAVAILABLE',
        trialsStarted: null,
        converted: null,
        conversionRatePercent: null,
        medianDaysToConversion: null,
        reconstructedEntries: 0,
        reason: `Menos de ${MINIMUM_SEGMENT_SIZE} entradas em trial registradas: publicar a taxa permitiria reidentificação.`,
      };
    }
    return {
      status: 'AVAILABLE',
      trialsStarted: trials,
      converted,
      conversionRatePercent: Math.round((converted / trials) * 1000) / 10,
      medianDaysToConversion:
        row?.median_days === null || row?.median_days === undefined
          ? null
          : Math.round(this.number(row.median_days) * 10) / 10,
      reconstructedEntries: row?.reconstructed ?? 0,
      reason: null,
    };
  }

  /**
   * Retenção por coorte mensal de entrada (US-8.3/TASK-8.3.4). "Retido" = assinatura hoje em
   * `ACTIVE` — a definição comercial de Eduardo, não uma leitura de engajamento.
   *
   * ponytail: o join com `subscriptions` assume uma assinatura por titular, que é o que o
   * `SubscriptionService.startTrial` garante hoje (idempotente por titular). Se um dia existir
   * mais de uma, trocar por `distinct on (user_id) ... order by created_at desc`.
   */
  private async entryCohorts(tx: TenantTransaction): Promise<{
    cohorts: ControlCenterEntryCohort[];
    suppressed: number;
  }> {
    const rows = await tx.execute<{
      month: string;
      cohort_size: number;
      converted: number;
      retained: number;
      reconstructed: boolean;
    }>(sql`
      ${this.lifecycleCte}
      select
        to_char(entry.started at time zone ${TIMEZONE}, 'YYYY-MM') as month,
        count(*)::int as cohort_size,
        count(conv.user_id)::int as converted,
        count(*) filter (where s.status = 'ACTIVE')::int as retained,
        bool_or(entry.reconstructed) as reconstructed
      from entry
      left join conv on conv.user_id = entry.user_id and conv.converted_at >= entry.started
      left join ${subscriptions} s on s.user_id = entry.user_id
      group by 1
      order by 1
    `);

    const all = [...rows];
    const publishable = all.filter((row) => row.cohort_size >= MINIMUM_SEGMENT_SIZE);
    return {
      suppressed: all.length - publishable.length,
      cohorts: publishable.map((row) => ({
        month: row.month,
        cohortSize: row.cohort_size,
        converted: row.converted,
        conversionRatePercent: Math.round((row.converted / row.cohort_size) * 1000) / 10,
        retained: row.retained,
        retentionPercent: Math.round((row.retained / row.cohort_size) * 1000) / 10,
        reconstructed: row.reconstructed,
      })),
    };
  }

  /**
   * CAC, ROAS e LTV/CAC por canal de origem (US-8.6 / TASK-8.6.2 e 8.6.3).
   *
   * ## Janela de atribuição, não mês-calendário
   * Quem viu o anúncio em maio pode converter em junho. Dividir gasto de maio por conversão
   * de maio é a armadilha (a) da US: aqui o denominador é a **coorte de origem** — o titular
   * conta no canal de onde veio, e só se converteu em até `ATTRIBUTION_WINDOW_DAYS` dias do
   * cadastro. A janela vai na resposta (`attributionWindowDays`), nunca fica implícita.
   *
   * ## Canal sem investimento não vale zero
   * Orgânico e indicação não têm gasto. `investmentBrl: null` + `NO_DIRECT_INVESTMENT`, e
   * as métricas derivadas ficam `UNAVAILABLE` — `CAC R$ 0,00` seria um número bonito e falso,
   * e a divisão por zero produziria infinito.
   *
   * ## ROAS sobre receita RECEBIDA
   * Numerador vem de `payments` (US-8.5), o que liquidou de fato, nunca de
   * `subscriptions.price_cents`. ROAS sobre dinheiro que não entrou faz escalar anúncio ruim.
   *
   * ## k-anonimato
   * Só entram os canais já publicáveis (`students >= MINIMUM_SEGMENT_SIZE`), e a agregação é
   * por canal — não existe caminho daqui até o titular.
   *
   * ponytail: o escopo é acumulado (vida toda), não recorte de período. Numerador e
   * denominador são a MESMA base, então a razão é honesta; filtro por período entra quando a
   * tela ganhar seletor de datas.
   */
  private async channelEconomics(
    tx: TenantTransaction,
    publishable: AcquisitionChannel[],
    matureCohorts: number,
  ): Promise<{ economics: ChannelEconomics[]; mediaInvestmentBrl: number }> {
    const originRows = await tx.execute<{
      source: string | null;
      medium: string | null;
      students: number;
      converted: number;
      received_cents: string;
    }>(sql`
      with origin as (
        select distinct on (a.user_id)
               a.user_id, a.utm_source as source, a.utm_medium as medium,
               a.created_at as signed_up_at
        from ${anamnesisSessions} a
        where a.user_id is not null and a.first_touch_at is not null
        order by a.user_id, a.created_at
      ),
      conv as (
        select user_id, min(occurred_at) as converted_at
        from ${userStatusTransitions}
        where to_status = 'CONVERTED'
        group by user_id
      )
      select o.source, o.medium,
             count(*)::int as students,
             count(*) filter (
               where c.converted_at is not null
                 and c.converted_at <= o.signed_up_at + ${ATTRIBUTION_WINDOW_DAYS} * interval '1 day'
             )::int as converted,
             coalesce(sum(pay.cents), 0)::text as received_cents
      from origin o
      left join conv c on c.user_id = o.user_id
      -- Estorno e chargeback já são linha negativa em \`payments\`: somar a coluna devolve o
      -- líquido recebido sem nenhum CASE. Só \`FAILED\` fica de fora (nunca entrou dinheiro).
      left join lateral (
        select coalesce(sum(p.amount_cents), 0) as cents
        from ${payments} p
        where p.user_id = o.user_id and p.status <> 'FAILED'
      ) pay on true
      group by 1, 2
    `);

    const spendRows = await tx
      .select({
        channel: adSpend.channel,
        cents: sql<string>`coalesce(sum(${adSpend.amountCents}), 0)::text`,
      })
      .from(adSpend)
      .groupBy(adSpend.channel);
    const spendByChannel = new Map(spendRows.map((row) => [row.channel, this.number(row.cents)]));
    const mediaInvestmentBrl =
      spendRows.reduce((sum, row) => sum + this.number(row.cents), 0) / 100;

    // Meses distintos com liquidação — divisor do ARPU mensal usado no payback.
    const [observed] = await tx
      .select({
        months: sql<number>`count(distinct to_char(${payments.occurredAt} at time zone ${TIMEZONE}, 'YYYY-MM'))::int`,
      })
      .from(payments)
      .where(sql`${payments.status} <> 'FAILED'`);
    const observedMonths = Math.max(1, observed?.months ?? 0);
    const hasPayments = (observed?.months ?? 0) > 0;

    // Mesma chave de `marketing()`: não mapeado nunca é fundido com outro canal.
    const byKey = new Map<string, { students: number; converted: number; receivedCents: number }>();
    for (const row of originRows) {
      const canonical = canonicalChannel(row.source, row.medium);
      const key = canonical.mapped ? canonical.channel : `${UNMAPPED_CHANNEL}:${canonical.raw}`;
      const current = byKey.get(key) ?? { students: 0, converted: 0, receivedCents: 0 };
      byKey.set(key, {
        students: current.students + row.students,
        converted: current.converted + row.converted,
        receivedCents: current.receivedCents + this.number(row.received_cents),
      });
    }

    const economics = publishable.map((channel): ChannelEconomics => {
      const key = channel.mapped ? channel.channel : `${UNMAPPED_CHANNEL}:${channel.raw}`;
      const totals = byKey.get(key) ?? { students: 0, converted: 0, receivedCents: 0 };
      // Só canal canônico recebe investimento: `nao_mapeado` é erro de marcação, e lançar
      // gasto contra ele esconderia justamente o erro que a US-8.2 quis deixar visível.
      const investmentCents = channel.mapped ? (spendByChannel.get(channel.channel) ?? 0) : 0;
      return {
        channel: channel.channel,
        mapped: channel.mapped,
        students: channel.count,
        ...this.economicMetrics({
          label: 'canal',
          converted: totals.converted,
          receivedCents: totals.receivedCents,
          investmentCents,
          hasPayments,
          matureCohorts,
          observedMonths,
        }),
      };
    });

    return { economics, mediaInvestmentBrl };
  }

  /** Formula unica para canal e campanha; evita divergencia silenciosa entre paineis. */
  private economicMetrics(input: {
    label: string;
    converted: number;
    receivedCents: number;
    investmentCents: number;
    hasPayments: boolean;
    matureCohorts: number;
    observedMonths: number;
  }): Omit<ChannelEconomics, 'channel' | 'mapped' | 'students'> {
    const invested = input.investmentCents > 0;
    const investmentBrl = invested ? input.investmentCents / 100 : null;
    const receivedBrl = input.receivedCents / 100;
    const noInvestment = `Sem investimento direto registrado em \`ad_spend\` para ${input.label} — não há numerador.`;
    const cac =
      !invested || investmentBrl === null
        ? this.unavailable('BRL', noInvestment)
        : input.converted === 0
          ? this.unavailable(
              'BRL',
              `Investimento registrado, mas nenhum convertido em ${input.label} dentro da janela de ${ATTRIBUTION_WINDOW_DAYS} dias.`,
            )
          : this.metric(
              investmentBrl / input.converted,
              'BRL',
              'AVAILABLE',
              `Investimento em mídia ÷ convertidos de ${input.label}.`,
            );
    const receivedRevenue = input.hasPayments
      ? this.metric(
          receivedBrl,
          'BRL',
          'AVAILABLE',
          `Receita efetivamente liquidada atribuída a ${input.label}, líquida de estornos e chargebacks.`,
        )
      : this.unavailable('BRL', 'Nenhuma liquidação registrada em `payments` ainda.');
    const roas =
      !invested || investmentBrl === null
        ? this.unavailable('RATIO', noInvestment)
        : !input.hasPayments
          ? this.unavailable('RATIO', 'Sem liquidação registrada não existe retorno a dividir.')
          : this.metric(
              receivedBrl / investmentBrl,
              'RATIO',
              'AVAILABLE',
              `Receita recebida atribuída a ${input.label} ÷ investimento em mídia.`,
            );
    const ltvStatus = input.matureCohorts >= 3 ? 'AVAILABLE' : 'PROXY';
    const ltvBase = `LTV de ${input.label} sustentado por ${input.matureCohorts} coorte(s) com ao menos ${MATURE_COHORT_MONTHS} meses.`;
    const ltv =
      !input.hasPayments || input.converted === 0
        ? this.unavailable(
            'BRL',
            `Sem convertidos com liquidação em ${input.label} não há base para LTV.`,
          )
        : this.metric(receivedBrl / input.converted, 'BRL', ltvStatus, ltvBase);
    const ltvToCac =
      ltv.value === null || cac.value === null || cac.value === 0
        ? this.unavailable('RATIO', invested ? 'Falta LTV ou CAC para a razão.' : noInvestment)
        : this.metric(
            ltv.value / cac.value,
            'RATIO',
            ltvStatus,
            `LTV ÷ CAC de ${input.label}, meta ≥ ${LTV_TO_CAC_TARGET}.`,
          );
    const monthlyArpu = ltv.value === null ? null : ltv.value / input.observedMonths;
    const paybackMonths =
      cac.value === null || monthlyArpu === null || monthlyArpu <= 0
        ? this.unavailable(
            'MONTHS',
            invested
              ? 'Sem CAC ou receita mensal por convertido não há prazo de retorno.'
              : noInvestment,
          )
        : this.metric(
            cac.value / monthlyArpu,
            'MONTHS',
            ltvStatus,
            `CAC ÷ receita média mensal por convertido, meta ≤ ${PAYBACK_TARGET_MONTHS} meses.`,
          );
    let signal: ChannelSignal = 'UNKNOWN';
    if (ltvToCac.value !== null && paybackMonths.value !== null) {
      signal =
        ltvToCac.value >= LTV_TO_CAC_TARGET && paybackMonths.value <= PAYBACK_TARGET_MONTHS
          ? 'GREEN'
          : ltvToCac.value >= 1
            ? 'ATTENTION'
            : 'CRITICAL';
    }
    return {
      converted: input.converted,
      investmentBrl,
      investmentStatus: invested ? 'INVESTED' : 'NO_DIRECT_INVESTMENT',
      cac,
      receivedRevenue,
      roas,
      ltv,
      ltvToCac,
      paybackMonths,
      signal,
    };
  }

  private metric(
    value: number,
    unit: MetricUnit,
    status: ControlCenterMetric['status'],
    definition: string,
  ): ControlCenterMetric {
    return { value, unit, status, definition };
  }

  private marketingMetric(value: number, definition: string): ControlCenterMetric {
    if (value > 0 && value < MINIMUM_SEGMENT_SIZE) {
      return this.unavailable(
        'COUNT',
        `${definition} Suprimida por privacidade (n<${MINIMUM_SEGMENT_SIZE}).`,
      );
    }
    return this.metric(value, 'COUNT', 'AVAILABLE', definition);
  }

  private unavailable(unit: MetricUnit, definition: string): ControlCenterMetric {
    return { value: null, unit, status: 'UNAVAILABLE', definition };
  }

  private number(value: string | number | null | undefined): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private envelope<T>(data: T, dataQuality: string[] = []) {
    return {
      data,
      meta: { generatedAt: new Date().toISOString(), timezone: TIMEZONE, dataQuality },
    };
  }
}
