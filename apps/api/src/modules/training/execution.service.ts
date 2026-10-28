/**
 * Execução do treino: o que o aluno vê no dia e o que registra, em qualquer modalidade.
 *
 * Tudo roda sob a sessão RLS do próprio aluno (`runAsUser`): um id de outro titular simplesmente
 * não existe. A carga interna é sRPE (PSE × minutos) para força, corrida, HYROX e esporte
 * externo. Relato de dor passa pela sentinela de segurança na mesma transação do fechamento.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';

import type {
  EnduranceMetrics,
  ExecutionView,
  FinishExecutionRequest,
  LogExternalRequest,
  SaveMetricsRequest,
  SaveSetsRequest,
  TrainingDay,
} from '@movivo/shared';
import { sessionLoad } from '@movivo/shared';

import {
  executionMetrics,
  executionSets,
  planSessions,
  scheduledSessions,
  sessionExecutions,
  trainingPlans,
  users,
} from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import { PublishedPolicies } from '../coaching/policy/published-policies';
import { painSignals } from '../coaching/safety/sentinel-rules';
import { SafetyService } from '../coaching/safety/safety.service';
import { DomainEventRecorder } from '../domain-events/domain-event-recorder';
import { OutboxRelay } from '../domain-events/outbox-relay';
import { addDays, mondayOf } from '../planning/calc/week-planner';
import { todayIn } from '../planning/plan-generation.service';
import { FitParseError, parseFit } from './import/fit-parser';
import { GpxParseError, parseGpx } from './import/gpx-parser';

const PAIN_HISTORY_DAYS = 21;

type ExecutionRow = typeof sessionExecutions.$inferSelect;

@Injectable()
export class ExecutionService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly events: DomainEventRecorder,
    private readonly outbox: OutboxRelay,
    private readonly safety: SafetyService,
    private readonly policies: PublishedPolicies,
  ) {}

  // --- Leitura ---------------------------------------------------------------------------

  async day(userId: string, requested?: string, now: Date = new Date()): Promise<TrainingDay> {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const [user] = await tx
        .select({ name: users.name, timezone: users.timezone })
        .from(users)
        .where(eq(users.id, userId));
      const today = todayIn(user?.timezone ?? null, now);
      const date = requested ?? today;
      const weekStart = mondayOf(date);
      const weekEnd = addDays(weekStart, 6);

      const rows = await tx
        .select({
          scheduled: scheduledSessions,
          plan: planSessions,
        })
        .from(scheduledSessions)
        .innerJoin(planSessions, eq(planSessions.id, scheduledSessions.planSessionId))
        .where(
          and(
            eq(scheduledSessions.userId, userId),
            gte(scheduledSessions.scheduledOn, weekStart),
            lte(scheduledSessions.scheduledOn, weekEnd),
          ),
        )
        .orderBy(asc(scheduledSessions.scheduledOn), asc(scheduledSessions.createdAt));

      const planIds = [...new Set(rows.map((r) => r.scheduled.planId))];
      const plans = planIds.length
        ? await tx.select().from(trainingPlans).where(inArray(trainingPlans.id, planIds))
        : [];
      const structureOf = (planId: string, key: string) =>
        plans.find((p) => p.id === planId)?.structure.sessions.find((x) => x.key === key);

      const ids = rows.map((r) => r.scheduled.id);
      const executions = ids.length
        ? await tx
            .select()
            .from(sessionExecutions)
            .where(inArray(sessionExecutions.scheduledSessionId, ids))
        : [];
      const views = await this.viewsOf(tx, executions);

      const week = Array.from({ length: 7 }, (_, index) => {
        const dayDate = addDays(weekStart, index);
        return {
          date: dayDate,
          sessions: rows
            .filter((r) => r.scheduled.scheduledOn === dayDate)
            .map((r) => ({
              scheduledSessionId: r.scheduled.id,
              title: r.plan.title,
              modality: r.plan
                .modality as TrainingDay['week'][number]['sessions'][number]['modality'],
              status: r.scheduled
                .status as TrainingDay['week'][number]['sessions'][number]['status'],
            })),
        };
      });

      const selected = rows
        .filter((r) => r.scheduled.scheduledOn === date)
        .map((r) => {
          const execution = executions.find((e) => e.scheduledSessionId === r.scheduled.id);
          return {
            scheduledSessionId: r.scheduled.id,
            planSessionKey: r.plan.key,
            title: r.plan.title,
            purpose: structureOf(r.scheduled.planId, r.plan.key)?.purpose ?? '',
            modality: r.plan.modality as TrainingDay['selected'][number]['modality'],
            priority: r.plan.priority as TrainingDay['selected'][number]['priority'],
            estimatedMinutes: r.plan.estimatedMinutes,
            estimatedRpe: structureOf(r.scheduled.planId, r.plan.key)?.estimatedRpe ?? 0,
            scheduledOn: r.scheduled.scheduledOn,
            slot: r.scheduled.slot as TrainingDay['selected'][number]['slot'],
            status: r.scheduled.status as TrainingDay['selected'][number]['status'],
            content: r.plan.content,
            execution: execution ? (views.get(execution.id) ?? null) : null,
          };
        });

      return {
        firstName: user?.name?.trim().split(/\s+/)[0] ?? null,
        today,
        date,
        week,
        selected,
        hasPlan: rows.length > 0,
      };
    });
  }

  // --- Escrita ---------------------------------------------------------------------------

  /** Abre (ou devolve) a execução de uma sessão agendada. */
  async start(userId: string, scheduledSessionId: string, now: Date = new Date()) {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const [scheduled] = await tx
        .select()
        .from(scheduledSessions)
        .where(
          and(eq(scheduledSessions.id, scheduledSessionId), eq(scheduledSessions.userId, userId)),
        );
      if (!scheduled) throw new NotFoundException();
      const [plan] = await tx
        .select({ modality: planSessions.modality })
        .from(planSessions)
        .where(eq(planSessions.id, scheduled.planSessionId));
      if (!plan) throw new NotFoundException();

      const [existing] = await tx
        .select()
        .from(sessionExecutions)
        .where(eq(sessionExecutions.scheduledSessionId, scheduled.id));
      if (existing) return this.viewOf(tx, existing);

      const [user] = await tx
        .select({ timezone: users.timezone })
        .from(users)
        .where(eq(users.id, userId));
      const today = todayIn(user?.timezone ?? null, now);
      const [created] = await tx
        .insert(sessionExecutions)
        .values({
          userId,
          scheduledSessionId: scheduled.id,
          planSessionId: scheduled.planSessionId,
          modality: plan.modality,
          performedOn: scheduled.scheduledOn <= today ? scheduled.scheduledOn : today,
          status: 'IN_PROGRESS',
          source: 'LINK',
          startedAt: now,
          loggedLate: scheduled.scheduledOn < today,
        })
        .returning();
      if (!created) throw new Error('falha ao abrir a execução');
      return this.viewOf(tx, created);
    });
  }

  async saveSets(userId: string, executionId: string, request: SaveSetsRequest) {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const execution = await this.open(tx, userId, executionId);
      for (const set of request.sets) {
        await tx
          .insert(executionSets)
          .values({
            userId,
            executionId: execution.id,
            exerciseId: set.exerciseId,
            setNumber: set.setNumber,
            reps: set.reps,
            loadKg: set.loadKg,
            durationSeconds: set.durationSeconds,
            rir: set.rir,
            completed: set.completed,
          })
          .onConflictDoUpdate({
            target: [executionSets.executionId, executionSets.exerciseId, executionSets.setNumber],
            set: {
              reps: set.reps,
              loadKg: set.loadKg,
              durationSeconds: set.durationSeconds,
              rir: set.rir,
              completed: set.completed,
            },
          });
      }
      return this.viewOf(tx, execution);
    });
  }

  async saveMetrics(userId: string, executionId: string, request: SaveMetricsRequest) {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const execution = await this.open(tx, userId, executionId);
      await this.upsertMetrics(tx, userId, execution.id, request.metrics, request.confirmed);
      return this.viewOf(tx, execution);
    });
  }

  /** Lê um `.fit`/`.gpx`: grava as métricas SEM confirmação — o aluno confere antes de fechar. */
  async importFile(userId: string, executionId: string, filename: string, bytes: Uint8Array) {
    const lower = filename.toLowerCase();
    let parsed: ReturnType<typeof parseFit>;
    let source: 'FIT_FILE' | 'GPX_FILE';
    try {
      if (lower.endsWith('.fit')) {
        parsed = parseFit(bytes);
        source = 'FIT_FILE';
      } else if (lower.endsWith('.gpx')) {
        parsed = parseGpx(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
        source = 'GPX_FILE';
      } else {
        throw new BadRequestException('Envie um arquivo .fit ou .gpx.');
      }
    } catch (error) {
      if (error instanceof FitParseError || error instanceof GpxParseError) {
        throw new BadRequestException(`Não conseguimos ler o arquivo: ${error.message}.`);
      }
      throw error;
    }
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const execution = await this.open(tx, userId, executionId);
      await this.upsertMetrics(tx, userId, execution.id, parsed.metrics, false);
      await tx
        .update(sessionExecutions)
        .set({ source })
        .where(eq(sessionExecutions.id, execution.id));
      return this.viewOf(tx, { ...execution, source });
    });
  }

  async finish(
    userId: string,
    executionId: string,
    request: FinishExecutionRequest,
    now: Date = new Date(),
  ) {
    const view = await this.db.runAsUser(userId, 'USER', async (tx) => {
      const execution = await this.open(tx, userId, executionId);
      const metrics = await this.metricsOf(tx, execution.id);
      const imported = ['FIT_FILE', 'GPX_FILE', 'WHATSAPP_SCREENSHOT'].includes(execution.source);
      if (imported && metrics && !metrics.confirmed && request.status !== 'ABANDONED') {
        throw new BadRequestException('Confirme os números lidos do arquivo antes de concluir.');
      }
      const minutes =
        request.durationMinutes ??
        (metrics?.metrics.movingSeconds ? Math.round(metrics.metrics.movingSeconds / 60) : null);
      const load =
        request.rpe !== null && minutes !== null ? sessionLoad(request.rpe, minutes) : null;
      await tx
        .update(sessionExecutions)
        .set({
          status: request.status,
          rpe: request.rpe,
          durationMinutes: minutes,
          load,
          enjoyment: request.enjoyment,
          painReports: request.painReports,
          finishedAt: now,
        })
        .where(eq(sessionExecutions.id, execution.id));
      if (execution.scheduledSessionId) {
        await tx
          .update(scheduledSessions)
          .set({
            status:
              request.status === 'COMPLETED'
                ? 'DONE'
                : request.status === 'PARTIAL'
                  ? 'PARTIAL'
                  : 'SKIPPED',
          })
          .where(eq(scheduledSessions.id, execution.scheduledSessionId));
      }
      await this.afterClose(tx, userId, { ...execution, load }, request);
      const [updated] = await tx
        .select()
        .from(sessionExecutions)
        .where(eq(sessionExecutions.id, execution.id));
      return this.viewOf(tx, updated as ExecutionRow);
    });
    await this.outbox.flushSoon();
    return view;
  }

  /** Treino fora do plano (esporte externo, sessão avulsa): nasce concluído. */
  async logExternal(userId: string, request: LogExternalRequest, now: Date = new Date()) {
    const view = await this.db.runAsUser(userId, 'USER', async (tx) => {
      const [user] = await tx
        .select({ timezone: users.timezone })
        .from(users)
        .where(eq(users.id, userId));
      const today = todayIn(user?.timezone ?? null, now);
      if (request.performedOn > today) {
        throw new BadRequestException('Não dá para registrar um treino em data futura.');
      }
      let planSessionId: string | null = null;
      if (request.scheduledSessionId) {
        const [scheduled] = await tx
          .select()
          .from(scheduledSessions)
          .where(
            and(
              eq(scheduledSessions.id, request.scheduledSessionId),
              eq(scheduledSessions.userId, userId),
            ),
          );
        if (!scheduled) throw new NotFoundException();
        planSessionId = scheduled.planSessionId;
        await tx
          .update(scheduledSessions)
          .set({ status: 'DONE' })
          .where(eq(scheduledSessions.id, scheduled.id));
      }
      const load = sessionLoad(request.rpe, request.durationMinutes);
      const [created] = await tx
        .insert(sessionExecutions)
        .values({
          userId,
          scheduledSessionId: request.scheduledSessionId ?? null,
          planSessionId,
          modality: request.modality,
          performedOn: request.performedOn,
          status: 'COMPLETED',
          source: 'LINK',
          startedAt: now,
          finishedAt: now,
          rpe: request.rpe,
          durationMinutes: request.durationMinutes,
          load,
          painReports: request.painReports,
          loggedLate: request.performedOn < today,
        })
        .returning();
      if (!created) throw new Error('falha ao registrar o treino');
      if (request.metrics) await this.upsertMetrics(tx, userId, created.id, request.metrics, true);
      await this.afterClose(tx, userId, created, {
        status: 'COMPLETED',
        painReports: request.painReports,
      });
      return this.viewOf(tx, created);
    });
    await this.outbox.flushSoon();
    return view;
  }

  // --- Internos ---------------------------------------------------------------------------

  private async afterClose(
    tx: TenantTransaction,
    userId: string,
    execution: Pick<ExecutionRow, 'id' | 'modality' | 'performedOn'> & { load: number | null },
    request: Pick<FinishExecutionRequest, 'status' | 'painReports'>,
  ): Promise<void> {
    await this.events.record(tx, {
      userId,
      type: 'SessionExecuted',
      payload: {
        executionId: execution.id,
        modality: execution.modality,
        status: request.status,
        load: execution.load,
      },
    });
    if (request.painReports.length === 0) return;
    const since = addDays(execution.performedOn, -PAIN_HISTORY_DAYS);
    const previous = await tx
      .select({
        painReports: sessionExecutions.painReports,
        performedOn: sessionExecutions.performedOn,
      })
      .from(sessionExecutions)
      .where(and(eq(sessionExecutions.userId, userId), gte(sessionExecutions.performedOn, since)));
    const history = previous.flatMap((row) =>
      row.painReports.map((report) => ({ region: report.region, day: row.performedOn })),
    );
    const signals = painSignals(
      request.painReports,
      history,
      execution.performedOn,
      await this.policies.sentinel(),
    );
    if (signals.length > 0) await this.safety.raiseIn(tx, userId, signals, 'RULE');
  }

  private async open(tx: TenantTransaction, userId: string, executionId: string) {
    const [execution] = await tx
      .select()
      .from(sessionExecutions)
      .where(and(eq(sessionExecutions.id, executionId), eq(sessionExecutions.userId, userId)));
    if (!execution) throw new NotFoundException();
    if (execution.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Este treino já foi concluído.');
    }
    return execution;
  }

  private async metricsOf(tx: TenantTransaction, executionId: string) {
    const [row] = await tx
      .select()
      .from(executionMetrics)
      .where(eq(executionMetrics.executionId, executionId));
    return row ?? null;
  }

  private async upsertMetrics(
    tx: TenantTransaction,
    userId: string,
    executionId: string,
    metrics: EnduranceMetrics,
    confirmed: boolean,
  ): Promise<void> {
    await tx
      .insert(executionMetrics)
      .values({ userId, executionId, metrics, confirmed })
      .onConflictDoUpdate({
        target: executionMetrics.executionId,
        set: { metrics, confirmed },
      });
  }

  private async viewOf(tx: TenantTransaction, execution: ExecutionRow): Promise<ExecutionView> {
    const views = await this.viewsOf(tx, [execution]);
    const view = views.get(execution.id);
    if (!view) throw new Error('execução sem visão');
    return view;
  }

  private async viewsOf(
    tx: TenantTransaction,
    executions: readonly ExecutionRow[],
  ): Promise<Map<string, ExecutionView>> {
    const out = new Map<string, ExecutionView>();
    if (executions.length === 0) return out;
    const ids = executions.map((e) => e.id);
    const sets = await tx
      .select()
      .from(executionSets)
      .where(inArray(executionSets.executionId, ids));
    const metrics = await tx
      .select()
      .from(executionMetrics)
      .where(inArray(executionMetrics.executionId, ids));
    for (const execution of executions) {
      const m = metrics.find((row) => row.executionId === execution.id);
      out.set(execution.id, {
        id: execution.id,
        status: execution.status as ExecutionView['status'],
        source: execution.source as ExecutionView['source'],
        sets: sets
          .filter((s) => s.executionId === execution.id)
          .map((s) => ({
            exerciseId: s.exerciseId,
            setNumber: s.setNumber,
            reps: s.reps,
            loadKg: s.loadKg,
            durationSeconds: s.durationSeconds,
            rir: s.rir,
            completed: s.completed,
          })),
        metrics: m?.metrics ?? null,
        metricsConfirmed: m?.confirmed ?? false,
        rpe: execution.rpe,
        durationMinutes: execution.durationMinutes,
        enjoyment: execution.enjoyment,
      });
    }
    return out;
  }
}
