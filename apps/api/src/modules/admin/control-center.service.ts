import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  anamnesisStructuredSchema,
  preferredPeriodSchema,
  primaryGoalSchema,
  trainingLocationSchema,
  ControlCenterCapability as Capability,
  type ControlCenterEvolutionPoint,
  type ControlCenterFinanceResponse,
  type ControlCenterMarketingResponse,
  type ControlCenterMetric,
  type ControlCenterOverviewResponse,
  type ControlCenterPillarSummary,
  type ControlCenterStudentDetailResponse,
  type ControlCenterStudentsResponse,
  type ControlCenterSystemResponse,
  type ControlCenterTimelineEvent,
  type ControlCenterComplianceResponse,
} from '@movivo/shared';
import { and, count, desc, eq, gte, isNotNull, sql, type SQLWrapper } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { z } from 'zod';

import { AgentConfigRepository } from '../../core/agent-config/agent-config.repository';
import { DatabaseHealthService } from '../../core/database';
import { HealthCipherService } from '../../core/database/health-cipher.service';
import {
  aiJobs,
  anamnesisSessions,
  auditLogs,
  checkins,
  consents,
  conversations,
  handoffAlerts,
  knowledgeBase,
  protocols,
  protocolVersions,
  subscriptions,
  users,
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
import { AuditService } from './audit.service';
import { assessChurnRisk, CHURN_RISK_THRESHOLDS } from './churn-risk';

const TIMEZONE = 'America/Sao_Paulo' as const;
const MINIMUM_SEGMENT_SIZE = 10;
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
 * Preço de LLM por 1k tokens, em USD (ADR-005-R: GPT-4.1 principal, Claude Sonnet 4.5
 * fallback). Constante versionada em código de propósito: a tabela `model_pricing`
 * editável chega na Sprint 8 junto com `expenses`, porque as duas resolvem o mesmo
 * problema (custo) e devem ser desenhadas juntas. **Este é o único ponto do código com
 * preço de modelo** — trocar aqui troca em todo o painel.
 *
 * ponytail: constante em código, virar tabela `model_pricing` na Sprint 8.
 * // TODO: confirmar preço vigente e câmbio com Eduardo/Henrique.
 */
const USD_TO_BRL = 5.4;
const AI_PRICE_USD_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  'gpt-4.1': { input: 0.002, output: 0.008 },
  'gpt-4.1-mini': { input: 0.0004, output: 0.0016 },
  'claude-sonnet-4-5': { input: 0.003, output: 0.015 },
};

/** Casa o modelo persistido (`gpt-4.1-2025-04-14`) com a chave da tabela de preço. */
function aiPriceFor(model: string) {
  const normalized = model.toLowerCase();
  const key = Object.keys(AI_PRICE_USD_PER_1K_TOKENS)
    .filter((candidate) => normalized.startsWith(candidate))
    // Prefixo mais longo primeiro: `gpt-4.1-mini` não pode cair no preço de `gpt-4.1`.
    .sort((a, b) => b.length - a.length)[0];
  return key ? AI_PRICE_USD_PER_1K_TOKENS[key] : null;
}
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
} as const;

/**
 * Rótulo obrigatório da adesão (US-7.4, TASK-7.4.3): o que existe hoje é o aluno
 * **declarando** no check-in, não o treino concluído verificado — que depende de
 * `workout_completions` (Sprint 8) e continua marcado como indisponível, nunca zero.
 */
const DECLARED_ADHERENCE_NOTICE =
  'Adesão declarada via check-in: mede resposta ao check-in, não execução. Treino concluído verificado depende de workout_completions (Sprint 8).';

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
    const attention = atRisk > OVERVIEW_ATTENTION_THRESHOLDS.financeAtRiskBrl;

    return {
      pillar: 'FINANCE',
      label: 'Financeiro',
      state: attention ? 'ATTENTION' : 'OK',
      href: '/dashboard/financeiro',
      headline: { label: 'MRR contratado', metric: finance.data.contractedMrr },
      details: [
        { label: 'Receita em risco (30 dias)', metric: finance.data.revenueAtRisk30d },
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
      reason: attention
        ? `Receita em risco nos próximos 30 dias acima de R$ ${OVERVIEW_ATTENTION_THRESHOLDS.financeAtRiskBrl}.`
        : null,
    };
  }

  private async marketingPillarSummary(): Promise<ControlCenterPillarSummary> {
    const marketing = await this.marketing();
    const started = marketing.data.funnel.formStarted.value ?? 0;
    const submitted = marketing.data.funnel.formSubmitted.value ?? 0;
    const completionRate = started > 0 ? (submitted / started) * 100 : null;
    const attention =
      completionRate !== null &&
      completionRate < OVERVIEW_ATTENTION_THRESHOLDS.marketingMinCompletionPercent;

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
      ],
      reason: attention
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
    const activePersona = await this.agentConfig.activePayload();
    const blockedRate = this.blockedRate(row?.blocked ?? 0, row?.validated ?? 0);
    const attention =
      blockedRate.value !== null &&
      blockedRate.value > OVERVIEW_ATTENTION_THRESHOLDS.aiMaxBlockedPercent;

    return {
      pillar: 'AI',
      label: 'IA',
      state: attention ? 'ATTENTION' : 'OK',
      href: '/dashboard/ia/persona',
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
          label: 'Persona vigente',
          metric: this.metric(
            activePersona?.version ?? 0,
            'COUNT',
            activePersona ? 'AVAILABLE' : 'UNAVAILABLE',
            activePersona
              ? `Versão ${activePersona.version} publicada.`
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

      return {
        anamnesisFunnel,
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
        acquisition: this.unavailable(
          'COUNT',
          'Atribuição de campanha/UTM ainda não é persistida no banco transacional.',
        ),
        segments,
        suppressedSegments,
        minimumSegmentSize: MINIMUM_SEGMENT_SIZE as 10,
      };
    });
    return this.envelope(result, [
      'Somente dimensões estruturadas não sensíveis são agregadas.',
      'Métricas entre 1 e 9 e dimensões com qualquer célula menor que 10 são omitidas.',
      'Aquisição está indisponível até a persistência de UTM/campanha.',
      'O funil da anamnese cobre apenas sessões com desfecho definido (enviadas ou com link já expirado); sessões ainda abertas não contam como abandono.',
      `Sazonalidade de cadastro cobre os últimos ${INSIGHT_WINDOW_DAYS} dias em ${TIMEZONE}, sobre a criação da sessão de anamnese.`,
      'Faixa etária é derivada da data de nascimento da etapa 1 e só sai do banco já generalizada em faixas.',
    ]);
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
          'As etapas 2 e 3 só gravam o bloco quando concluídas (e o bloco de saúde é cifrado), então o campo exato de parada exige telemetria de formulário — dependência da Sprint 8.',
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
          protocolStatus: this.latestProtocolStatus(),
          lastInboundAt: sql<Date | null>`(
            select max(c.created_at) from ${conversations} c
            where c.user_id = ${users.id} and c.direction = 'INBOUND'
          )`,
          unansweredCheckinSentAt: sql<Date | null>`(
            select min(k.sent_at) from ${checkins} k
            where k.user_id = ${users.id} and k.sent_at is not null and k.responded_at is null
          )`,
          renewalAt: sql<Date | null>`(
            select coalesce(s.trial_ends_at, s.current_period_end) from ${subscriptions} s
            where s.user_id = ${users.id} order by s.created_at desc limit 1
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
    const students = rows
      .map(({ lastInboundAt, unansweredCheckinSentAt, renewalAt, ...student }) => ({
        ...student,
        churnRisk: assessChurnRisk({
          lastInboundAt: this.date(lastInboundAt),
          unansweredCheckinSentAt: this.date(unansweredCheckinSentAt),
          renewalAt: this.date(renewalAt),
        }),
      }))
      .sort((a, b) => b.churnRisk.score - a.churnRisk.score);
    return this.envelope(
      { students, aiBlockedRate: this.blockedRate(ai?.blocked ?? 0, ai?.validated ?? 0) },
      [
        'Risco de cancelamento é comercial: soma de três sinais nomeados (silêncio no canal, check-in sem resposta, renovação próxima), não um score preditivo.',
        `Limiares vigentes: ${CHURN_RISK_THRESHOLDS.silentDays} dias sem mensagem, ${CHURN_RISK_THRESHOLDS.unansweredCheckinDays} dias de check-in sem resposta, ${CHURN_RISK_THRESHOLDS.renewalWindowDays} dias até a renovação.`,
      ],
    );
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
          protocolStatus: this.latestProtocolStatus(),
          anamnesisStatus: sql<string | null>`(
            select a.status::text from ${anamnesisSessions} a
            where a.user_id = ${users.id} order by a.created_at desc limit 1
          )`,
          parqState: sql<string | null>`(
            select a.parq_state::text from ${anamnesisSessions} a
            where a.user_id = ${users.id} order by a.created_at desc limit 1
          )`,
          routine: sql<unknown>`(
            select a.data_block_3 from ${anamnesisSessions} a
            where a.user_id = ${users.id} order by a.created_at desc limit 1
          )`,
          lastInboundAt: sql<Date | null>`(
            select max(c.created_at) from ${conversations} c
            where c.user_id = ${users.id} and c.direction = 'INBOUND'
          )`,
          unansweredCheckinSentAt: sql<Date | null>`(
            select min(k.sent_at) from ${checkins} k
            where k.user_id = ${users.id} and k.sent_at is not null and k.responded_at is null
          )`,
          renewalAt: sql<Date | null>`(
            select coalesce(s.trial_ends_at, s.current_period_end) from ${subscriptions} s
            where s.user_id = ${users.id} order by s.created_at desc limit 1
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

    const events: Array<ControlCenterTimelineEvent | null> = [];
    for (const item of raw.anamnesisRows) {
      events.push(this.event(item.createdAt, 'ANAMNESIS', 'Formulário de anamnese iniciado', null));
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
          {
            title: 'Custo de infraestrutura e de WhatsApp',
            reason:
              'Nenhuma fatura de servidor ou de mensagem é ingerida hoje; qualquer número seria inventado.',
            dependency: 'Tabela de despesas (`expenses`) e ingestão de faturas',
            plannedFor: 'Sprint 8',
          },
          {
            title: 'Histórico de incidentes e disponibilidade real (uptime)',
            reason:
              'A plataforma mede a si mesma no instante da consulta; não existe registro do que ficou fora do ar antes.',
            dependency: 'Registro de incidentes e probe externo contínuo',
            plannedFor: 'Sprint 8',
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

      const aiRows = await tx
        .select({
          model: sql<string>`coalesce(${aiJobs.modelUsed}, 'DESCONHECIDO')`,
          jobs: sql<number>`count(*)::int`,
          tokensInput: sql<number>`coalesce(sum(${aiJobs.tokensInput}), 0)::int`,
          tokensOutput: sql<number>`coalesce(sum(${aiJobs.tokensOutput}), 0)::int`,
        })
        .from(aiJobs)
        .where(sql`${aiJobs.createdAt} >= now() - ${this.days(AI_COST_WINDOW_DAYS)}`)
        .groupBy(sql`1`);

      const active = row?.active ?? 0;
      const aiCostByModel = aiRows.map((model) => {
        const price = aiPriceFor(model.model);
        return {
          ...model,
          costBrl: price
            ? ((model.tokensInput / 1000) * price.input +
                (model.tokensOutput / 1000) * price.output) *
              USD_TO_BRL
            : null,
        };
      });
      const unpricedModels = aiCostByModel.filter((model) => model.costBrl === null);
      const pricedCost = aiCostByModel.reduce((sum, model) => sum + (model.costBrl ?? 0), 0);
      const aiCostUnavailable =
        aiCostByModel.length > 0 && unpricedModels.length === aiCostByModel.length;
      const aiCostDefinition = `Custo calculado dos últimos ${AI_COST_WINDOW_DAYS} dias: tokens de ai_jobs × preço por 1k tokens versionado em código (ADR-005-R), convertido a R$ pelo câmbio fixo de ${USD_TO_BRL}.`;
      const aiCost = aiCostUnavailable
        ? this.unavailable(
            'BRL',
            `Nenhum modelo com job no período está na tabela de preço versionada (${unpricedModels.map((model) => model.model).join(', ')}).`,
          )
        : this.metric(pricedCost, 'BRL', 'PROXY', aiCostDefinition);

      const atRiskTotal = atRiskRows.reduce((sum, item) => sum + this.number(item.amountBrl), 0);

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
        infrastructureCost: this.unavailable(
          'BRL',
          'Faturas de infraestrutura ainda não são ingeridas; depende da ingestão de custo de infra prevista para a Sprint 8.',
        ),
        receivedRevenue: this.unavailable(
          'BRL',
          'Subscriptions registra preço contratado, não liquidação financeira do gateway; depende da tabela `payments`, prevista para a Sprint 8.',
        ),
        profit: this.unavailable(
          'BRL',
          'Não existe lucro a exibir: a plataforma não registra nenhuma despesa; depende da tabela `expenses`, prevista para a Sprint 8.',
        ),
        partnerDistribution: this.unavailable(
          'BRL',
          'Distribuição por sócio depende de `partners` e do resultado apurado; prevista para a Sprint 8.',
        ),
        customerAcquisitionCost: this.unavailable(
          'BRL',
          'CAC depende de investimento em mídia (`ad_spend`) e de atribuição de campanha, ambos previstos para a Sprint 8.',
        ),
        revenueAtRisk30d: this.metric(
          atRiskTotal,
          'BRL',
          'PROXY',
          `Preço contratado das assinaturas ativas que vencem em ${AT_RISK_WINDOW_DAYS} dias sem nenhuma mensagem recebida do titular há ${RISK_SILENCE_DAYS} dias.`,
        ),
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
      };
    });
    return this.envelope(data, [
      'Nenhum identificador de titular é retornado; a lista de risco usa o id da assinatura.',
      `Calendário de renovação cobre ${RENEWAL_HORIZON_DAYS} dias de receita contratada a vencer — não é projeção de vendas novas.`,
      'MRR = preço do plano ÷ meses do plano; ARR = MRR × 12. Receita contratada, não caixa recebido.',
      'Custo de IA usa preço por modelo versionado em código e câmbio fixo; a tabela editável chega na Sprint 8.',
      'Lucro, receita recebida, custo de infra, CAC e distribuição por sócio estão marcados como indisponíveis com a dependência nomeada — nunca como zero.',
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

  private latestSubscriptionStatus() {
    return sql<string | null>`(
      select s.status::text from ${subscriptions} s
      where s.user_id = ${users.id} order by s.created_at desc limit 1
    )`;
  }

  private latestProtocolStatus() {
    return sql<string | null>`(
      select p.status::text from ${protocols} p
      where p.user_id = ${users.id} order by p.created_at desc limit 1
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
