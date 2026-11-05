/**
 * Grava o snapshot de cada treino concluído (disposição do dia × desempenho × última vez que o
 * aluno fez a mesma sessão) e o devolve ao especialista que dá o retorno pós-treino. Idempotente
 * por execução.
 */
import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt } from 'drizzle-orm';

import type { EnduranceMetrics } from '@movivo/shared';

import {
  dailyCheckIns,
  executionMetrics,
  executionSets,
  planSessions,
  scheduledSessions,
  sessionExecutions,
  sessionSnapshots,
  studentDayDigests,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { mergeObservationScales, type DayScales } from '../student-state/observations';
import { ObservationService } from '../student-state/observation.service';
import {
  compareSessions,
  endurancePerformance,
  sessionKeyOf,
  strengthPerformance,
  type SessionPerformance,
  type SnapshotComparison,
  type SnapshotReadiness,
} from './session-snapshot';

const FINISHED = ['COMPLETED', 'PARTIAL'];
const HISTORY = 3;

export interface SessionSnapshotView {
  sessionKey: string;
  performedOn: string;
  readiness: SnapshotReadiness;
  performance: SessionPerformance;
  comparison: SnapshotComparison;
  /** As últimas vezes que fez a mesma sessão, da mais recente para a mais antiga. */
  history: Array<{ date: string; performance: SessionPerformance; readiness: SnapshotReadiness }>;
}

@Injectable()
export class SessionSnapshotService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly observations: ObservationService,
  ) {}

  /** Cria o snapshot se a execução terminou e ainda não tem um. Devolve `false` se não aplicável. */
  async capture(userId: string, executionId: string): Promise<boolean> {
    const [execution] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select()
        .from(sessionExecutions)
        .where(and(eq(sessionExecutions.id, executionId), eq(sessionExecutions.userId, userId))),
    );
    if (!execution || !FINISHED.includes(execution.status)) return false;
    const reports = await this.observations.between(
      userId,
      execution.performedOn,
      execution.performedOn,
    );

    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const [scheduled] = execution.scheduledSessionId
        ? await tx
            .select({ title: planSessions.title, content: planSessions.content })
            .from(scheduledSessions)
            .innerJoin(planSessions, eq(planSessions.id, scheduledSessions.planSessionId))
            .where(eq(scheduledSessions.id, execution.scheduledSessionId))
        : [];
      const sessionKey = sessionKeyOf(scheduled?.title ?? null, execution.modality);

      const [check] = await tx
        .select()
        .from(dailyCheckIns)
        .where(
          and(eq(dailyCheckIns.userId, userId), eq(dailyCheckIns.onDate, execution.performedOn)),
        );
      const base: DayScales = {
        energy: check?.energy ?? null,
        sleep: check?.sleep ?? null,
        soreness: check?.soreness ?? null,
        mood: check?.mood ?? null,
        stress: check?.stress ?? null,
      };
      const [digest] = await tx
        .select({ digest: studentDayDigests.digest })
        .from(studentDayDigests)
        .where(
          and(
            eq(studentDayDigests.userId, userId),
            eq(studentDayDigests.onDate, execution.performedOn),
          ),
        );
      const actions =
        (digest?.digest.agentActions as Array<{ by: string; type: string; detail: string }>) ?? [];
      const adjusted = actions.find(
        (a) => a.by === 'TRAINING' && (a.type === 'SHORTEN_SESSION' || a.type === 'RECOMMENDATION'),
      );
      const readiness: SnapshotReadiness = {
        ...mergeObservationScales(base, reports),
        sleepHours:
          reports.find((r) => r.kind === 'SLEEP' && r.valueNum !== null)?.valueNum ?? null,
        reportedBefore: reports.some((r) => r.phase === 'BEFORE'),
        agentAdjusted: adjusted ? adjusted.detail.slice(0, 160) : null,
      };

      let performance: SessionPerformance;
      if (execution.modality === 'STRENGTH') {
        const sets = await tx
          .select({
            reps: executionSets.reps,
            loadKg: executionSets.loadKg,
            rir: executionSets.rir,
            completed: executionSets.completed,
            setNumber: executionSets.setNumber,
          })
          .from(executionSets)
          .where(eq(executionSets.executionId, executionId));
        const planned =
          scheduled?.content.modality === 'STRENGTH'
            ? scheduled.content.exercises.reduce((total, e) => total + e.sets, 0)
            : null;
        performance = strengthPerformance({
          sets,
          setsPlanned: planned,
          rpe: execution.rpe,
          durationMinutes: execution.durationMinutes,
        });
      } else {
        const [metrics] = await tx
          .select({ metrics: executionMetrics.metrics })
          .from(executionMetrics)
          .where(eq(executionMetrics.executionId, executionId));
        performance = endurancePerformance({
          metrics: (metrics?.metrics ?? {}) as EnduranceMetrics,
          rpe: execution.rpe,
          durationMinutes: execution.durationMinutes,
        });
      }

      const [previous] = await tx
        .select()
        .from(sessionSnapshots)
        .where(
          and(
            eq(sessionSnapshots.userId, userId),
            eq(sessionSnapshots.sessionKey, sessionKey),
            lt(sessionSnapshots.performedOn, execution.performedOn),
          ),
        )
        .orderBy(desc(sessionSnapshots.performedOn))
        .limit(1);
      const comparison = compareSessions({
        now: performance,
        readiness,
        previous: previous
          ? {
              date: previous.performedOn,
              executionId: previous.executionId,
              performance: previous.performance as unknown as SessionPerformance,
            }
          : null,
      });

      const inserted = await tx
        .insert(sessionSnapshots)
        .values({
          userId,
          executionId,
          performedOn: execution.performedOn,
          modality: execution.modality,
          sessionKey,
          readiness: readiness as unknown as Record<string, unknown>,
          performance: performance as unknown as Record<string, unknown>,
          comparison: comparison as unknown as Record<string, unknown>,
        })
        .onConflictDoNothing()
        .returning({ id: sessionSnapshots.id });
      return inserted.length > 0;
    });
  }

  /** O snapshot desta execução com o histórico da mesma sessão; `null` se ainda não existe. */
  async view(userId: string, executionId: string): Promise<SessionSnapshotView | null> {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const [row] = await tx
        .select()
        .from(sessionSnapshots)
        .where(
          and(eq(sessionSnapshots.userId, userId), eq(sessionSnapshots.executionId, executionId)),
        );
      if (!row) return null;
      const earlier = await tx
        .select()
        .from(sessionSnapshots)
        .where(
          and(
            eq(sessionSnapshots.userId, userId),
            eq(sessionSnapshots.sessionKey, row.sessionKey),
            lt(sessionSnapshots.performedOn, row.performedOn),
          ),
        )
        .orderBy(desc(sessionSnapshots.performedOn))
        .limit(HISTORY);
      return {
        sessionKey: row.sessionKey,
        performedOn: row.performedOn,
        readiness: row.readiness as unknown as SnapshotReadiness,
        performance: row.performance as unknown as SessionPerformance,
        comparison: row.comparison as unknown as SnapshotComparison,
        history: earlier.map((e) => ({
          date: e.performedOn,
          performance: e.performance as unknown as SessionPerformance,
          readiness: e.readiness as unknown as SnapshotReadiness,
        })),
      };
    });
  }

  /** Últimas sessões do aluno (qualquer tipo), para o acompanhamento semanal do treinador. */
  async recent(userId: string, limit = 8) {
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select()
        .from(sessionSnapshots)
        .where(eq(sessionSnapshots.userId, userId))
        .orderBy(desc(sessionSnapshots.performedOn))
        .limit(limit),
    );
    return rows.reverse().map((r) => ({
      date: r.performedOn,
      sessionKey: r.sessionKey,
      readiness: r.readiness as unknown as SnapshotReadiness,
      performance: r.performance as unknown as SessionPerformance,
      pattern: (r.comparison as unknown as SnapshotComparison).pattern,
    }));
  }
}
