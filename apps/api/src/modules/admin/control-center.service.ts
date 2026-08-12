import { Injectable, NotFoundException } from '@nestjs/common';
import {
  anamnesisStructuredSchema,
  preferredPeriodSchema,
  primaryGoalSchema,
  trainingLocationSchema,
  type ControlCenterFinanceResponse,
  type ControlCenterMarketingResponse,
  type ControlCenterMetric,
  type ControlCenterOverviewResponse,
  type ControlCenterStudentDetailResponse,
  type ControlCenterStudentsResponse,
  type ControlCenterSupportResponse,
  type ControlCenterSystemResponse,
  type ControlCenterComplianceResponse,
} from '@movivo/shared';
import { and, count, desc, eq, isNotNull, sql } from 'drizzle-orm';

import { DatabaseHealthService } from '../../core/database';
import {
  aiJobs,
  anamnesisSessions,
  auditLogs,
  consents,
  handoffAlerts,
  protocols,
  subscriptions,
  users,
} from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import { RedisHealthService } from '../../core/redis';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { AuditService } from './audit.service';

const TIMEZONE = 'America/Sao_Paulo' as const;
const MINIMUM_SEGMENT_SIZE = 10;

type MetricUnit = ControlCenterMetric['unit'];

@Injectable()
export class ControlCenterService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly databaseHealth: DatabaseHealthService,
    private readonly redisHealth: RedisHealthService,
    private readonly audit: AuditService,
  ) {}

  async overview(): Promise<ControlCenterOverviewResponse> {
    const data = await this.db.runAsSystem(async (tx) => {
      const [billing] = await tx
        .select({
          active: sql<number>`count(*) filter (where ${subscriptions.status} = 'ACTIVE')::int`,
          trials: sql<number>`count(*) filter (where ${subscriptions.status} = 'TRIALING')::int`,
          contractedMrr: sql<string>`coalesce(sum(case
            when ${subscriptions.status} <> 'ACTIVE' then 0
            when ${subscriptions.plan} = 'MONTHLY' then ${subscriptions.priceCents} / 100.0
            when ${subscriptions.plan} = 'QUARTERLY' then ${subscriptions.priceCents} / 300.0
            when ${subscriptions.plan} = 'SEMIANNUAL' then ${subscriptions.priceCents} / 600.0
            when ${subscriptions.plan} = 'ANNUAL' then ${subscriptions.priceCents} / 1200.0
            else 0 end), 0)`,
        })
        .from(subscriptions);
      const [alerts] = await tx
        .select({
          total: sql<number>`(
            count(*) filter (where ${handoffAlerts.status} = 'OPEN' and ${handoffAlerts.level} = 'SAFETY')
            + (select count(*) from ${anamnesisSessions}
               where ${anamnesisSessions.parqState} = 'BLOQUEADO_AGUARDANDO_CLEARANCE')
          )::int`,
        })
        .from(handoffAlerts);
      return {
        activeSubscriptions: this.metric(
          billing?.active ?? 0,
          'COUNT',
          'AVAILABLE',
          'Assinaturas atualmente ativas.',
        ),
        trials: this.metric(
          billing?.trials ?? 0,
          'COUNT',
          'AVAILABLE',
          'Assinaturas atualmente em trial.',
        ),
        contractedMrr: this.metric(
          this.number(billing?.contractedMrr),
          'BRL',
          'AVAILABLE',
          'Receita mensal contratada normalizada pelo período do plano; não representa caixa recebido.',
        ),
        northStar: this.unavailable(
          'COUNT',
          'Treinos concluídos por usuário pago nos primeiros 30 dias exigem registro de treino granular.',
        ),
        criticalAlerts: this.metric(
          alerts?.total ?? 0,
          'COUNT',
          'AVAILABLE',
          'Alertas SAFETY abertos mais PAR-Q bloqueados aguardando decisão humana.',
        ),
      };
    });
    return this.envelope(data, [
      'North Star indisponível até existir um registro granular de treinos concluídos.',
      'MRR é receita contratada, não receita recebida.',
    ]);
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
      return {
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
    ]);
  }

  async students(actor: AuthenticatedUser): Promise<ControlCenterStudentsResponse> {
    const students = await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      const rows = await tx
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          phoneNumber: users.phoneNumber,
          status: users.status,
          subscriptionStatus: this.latestSubscriptionStatus(),
          protocolStatus: this.latestProtocolStatus(),
        })
        .from(users)
        .where(eq(users.role, 'USER'))
        .orderBy(desc(users.createdAt))
        .limit(200);
      await this.auditListAccess(tx, actor, 'STUDENTS_LIST_VIEWED', 'student_list', rows.length);
      return rows;
    });
    return this.envelope({ students });
  }

  async student(
    actor: AuthenticatedUser,
    studentId: string,
  ): Promise<ControlCenterStudentDetailResponse> {
    const student = await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
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
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: studentId,
        action: 'HEALTH_DATA_VIEWED',
        entityType: 'student_control_center',
        entityId: studentId,
        changes: { purpose: 'student_monitoring', role: actor.role },
      });
      return {
        ...row,
        currentProtocol: protocol
          ? { ...protocol, signedAt: protocol.signedAt?.toISOString() ?? null }
          : null,
        routine: this.projectRoutine(row.routine),
        workoutHistory: {
          status: 'UNAVAILABLE' as const,
          reason: 'A plataforma ainda não registra cada treino e sua progressão de carga.',
        },
      };
    });
    return this.envelope({ student }, [
      'Histórico granular de treino indisponível até existir instrumentação de workout.',
    ]);
  }

  async system(): Promise<ControlCenterSystemResponse> {
    const [database, redis, ai] = await Promise.all([
      this.databaseHealth.ping().catch(() => null),
      this.redisHealth.ping().catch(() => null),
      this.db.runAsSystem(async (tx) => {
        const [row] = await tx
          .select({
            total: sql<number>`count(*)::int`,
            failed: sql<number>`count(*) filter (where ${aiJobs.status} = 'FAILED')::int`,
            dlq: sql<number>`count(*) filter (where ${aiJobs.status} = 'DLQ')::int`,
            averageLatency: sql<
              string | null
            >`avg(${aiJobs.latencyMs}) filter (where ${aiJobs.latencyMs} is not null)`,
          })
          .from(aiJobs);
        return row;
      }),
    ]);
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
        aiJobs: this.metric(ai?.total ?? 0, 'COUNT', 'AVAILABLE', 'Jobs de IA persistidos.'),
        aiFailures: this.metric(
          ai?.failed ?? 0,
          'COUNT',
          'AVAILABLE',
          'Jobs de IA em estado FAILED.',
        ),
        aiDlq: this.metric(ai?.dlq ?? 0, 'COUNT', 'AVAILABLE', 'Jobs de IA em estado DLQ.'),
        aiAverageLatency:
          ai?.averageLatency == null
            ? this.unavailable(
                'MILLISECONDS',
                'Nenhum job de IA possui latência registrada para calcular a média.',
              )
            : this.metric(
                this.number(ai.averageLatency),
                'MILLISECONDS',
                'PROXY',
                'Média de latência dos jobs de IA que registraram latência; não substitui p95.',
              ),
        whatsappDeliveryCost: this.unavailable(
          'BRL',
          'O provedor de WhatsApp ainda não persiste custo por mensagem.',
        ),
        infrastructureCost: this.unavailable(
          'BRL',
          'Faturas de infraestrutura ainda não são ingeridas.',
        ),
      },
      ['Telemetria OpenTelemetry ainda não foi implementada; latência de IA é um proxy do banco.'],
    );
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
      const [ai] = await tx
        .select({ cost: sql<string>`coalesce(sum(${aiJobs.costBrl}), 0)` })
        .from(aiJobs);
      return {
        activeSubscriptions: this.metric(
          row?.active ?? 0,
          'COUNT',
          'AVAILABLE',
          'Assinaturas ativas, sem PII do titular.',
        ),
        contractedMrr: this.metric(
          this.number(row?.contractedMrr),
          'BRL',
          'AVAILABLE',
          'Receita mensal contratada normalizada pelo período do plano.',
        ),
        aiCost: this.metric(
          this.number(ai?.cost),
          'BRL',
          'AVAILABLE',
          'Soma do custo BRL persistido em jobs de IA.',
        ),
        whatsappCost: this.unavailable(
          'BRL',
          'O provedor de WhatsApp ainda não persiste custo por mensagem.',
        ),
        infrastructureCost: this.unavailable(
          'BRL',
          'Faturas de infraestrutura ainda não são ingeridas.',
        ),
        receivedRevenue: this.unavailable(
          'BRL',
          'Subscriptions registra preço contratado, não liquidação financeira do gateway.',
        ),
      };
    });
    return this.envelope(data, [
      'Nenhum identificador de titular é retornado.',
      'Custos de WhatsApp/infra e receita recebida aguardam fontes contábeis.',
    ]);
  }

  async support(actor: AuthenticatedUser): Promise<ControlCenterSupportResponse> {
    // Sob RLS: o papel `SUPPORT` tem policy própria de SELECT em `users`/`subscriptions`
    // restrita a `users.role = 'USER'` (ver `security-policies.ts`). Nada de bypass.
    const customers = await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      const rows = await tx
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          phoneNumber: users.phoneNumber,
          status: users.status,
          subscriptionStatus: this.latestSubscriptionStatus(),
        })
        .from(users)
        .where(eq(users.role, 'USER'))
        .orderBy(desc(users.createdAt))
        .limit(200);
      await this.auditListAccess(
        tx,
        actor,
        'SUPPORT_CUSTOMER_LIST_VIEWED',
        'support_customer_list',
        rows.length,
      );
      return rows;
    });
    return this.envelope({ customers }, [
      'A projeção de suporte não consulta anamnese, PAR-Q, protocolos, check-ins ou conversas.',
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
