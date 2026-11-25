/**
 * Evolução do aluno para a equipe (Base de Alunos): semanas previsto × feito, carga e prontidão
 * dia a dia, medidas, progressão de força, dor e o que os agentes sabem dele. Leitura de dado de
 * saúde: exige a capability de saúde e cada abertura fica na trilha de auditoria.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';

import type { StudentEvolution } from '@movivo/shared';

import {
  bodyMeasurements,
  dailyCheckIns,
  cycleReassessments,
  executionSets,
  foodLogs,
  planSessions,
  scheduledSessions,
  sessionExecutions,
  users,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { AuditService } from '../admin/audit.service';
import { addDays, mondayOf } from '../planning/calc/week-planner';
import { todayIn } from '../planning/plan-generation.service';
import { StudentMemoryService } from '../student-state/student-memory.service';
import { computeLoadMetrics, dailySeries, readinessScore } from './load-metrics';
import { collectLoadInputs } from './load-metrics-data';
import { regionOf } from './pain-tasks';
import { collectWeeks } from './review-data';

const DAYS = 28;
const HISTORY_DAYS = 90;
const TOP_EXERCISES = 4;
const MAX_POINTS = 40;
const FINISHED = ['COMPLETED', 'PARTIAL'];

export interface Actor {
  userId: string;
  role: Parameters<TenantDatabase['runAsUser']>[1];
}

@Injectable()
export class StudentEvolutionService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly audit: AuditService,
    private readonly memory: StudentMemoryService,
  ) {}

  async read(actor: Actor, studentId: string, weeksCount = 12): Promise<StudentEvolution> {
    const data = await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      const [user] = await tx
        .select({ timezone: users.timezone })
        .from(users)
        .where(eq(users.id, studentId));
      if (!user) throw new NotFoundException();
      const today = todayIn(user.timezone, new Date());
      const from = addDays(mondayOf(today), -(weeksCount - 1) * 7);

      const weeks = await collectWeeks(tx, studentId, mondayOf(today), weeksCount);
      const planned = await tx
        .select({ date: scheduledSessions.scheduledOn, load: planSessions.estimatedLoad })
        .from(scheduledSessions)
        .innerJoin(planSessions, eq(planSessions.id, scheduledSessions.planSessionId))
        .where(
          and(
            eq(scheduledSessions.userId, studentId),
            inArray(scheduledSessions.status, ['PLANNED', 'DONE', 'PARTIAL', 'MISSED']),
            gte(scheduledSessions.scheduledOn, from),
            lte(scheduledSessions.scheduledOn, addDays(mondayOf(today), 6)),
          ),
        );
      const plannedByWeek = new Map<string, number>();
      for (const row of planned) {
        const key = mondayOf(row.date);
        plannedByWeek.set(key, (plannedByWeek.get(key) ?? 0) + row.load);
      }

      const inputs = await collectLoadInputs(tx, studentId, today, DAYS);
      const loadSeries = dailySeries(inputs.executions, today, DAYS);
      const checkByDay = new Map(inputs.checkIns.map((c) => [c.date, c]));
      const days = loadSeries.map((load, i) => {
        const date = addDays(today, i - DAYS + 1);
        const check = checkByDay.get(date);
        return {
          date,
          load,
          energy: check?.energy ?? null,
          sleep: check?.sleep ?? null,
          soreness: check?.soreness ?? null,
          mood: check?.mood ?? null,
          stress: check?.stress ?? null,
          readiness: check ? readinessScore(check) : null,
        };
      });
      const metrics = computeLoadMetrics({ asOf: today, ...inputs });

      const foodRows = await tx
        .select({ date: foodLogs.loggedOn, totals: foodLogs.totals })
        .from(foodLogs)
        .where(
          and(
            eq(foodLogs.userId, studentId),
            eq(foodLogs.confirmed, true),
            gte(foodLogs.loggedOn, addDays(today, -(DAYS - 1))),
          ),
        );
      const waterRows = await tx
        .select({ date: dailyCheckIns.onDate, waterMl: dailyCheckIns.waterMl })
        .from(dailyCheckIns)
        .where(
          and(
            eq(dailyCheckIns.userId, studentId),
            gte(dailyCheckIns.onDate, addDays(today, -(DAYS - 1))),
          ),
        );
      const waterByDay = new Map(waterRows.map((r) => [r.date, r.waterMl]));
      const nutritionByDay = new Map<
        string,
        { meals: number; energyKcal: number; proteinG: number; carbsG: number; fatG: number }
      >();
      for (const row of foodRows) {
        const day = nutritionByDay.get(row.date) ?? {
          meals: 0,
          energyKcal: 0,
          proteinG: 0,
          carbsG: 0,
          fatG: 0,
        };
        day.meals += 1;
        day.energyKcal += row.totals.energyKcal;
        day.proteinG += row.totals.proteinG;
        day.carbsG += row.totals.carbsG;
        day.fatG += row.totals.fatG;
        nutritionByDay.set(row.date, day);
      }
      const nutritionDays = [...nutritionByDay]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, day]) => ({
          date,
          meals: day.meals,
          energyKcal: Math.round(day.energyKcal),
          proteinG: Math.round(day.proteinG),
          carbsG: Math.round(day.carbsG),
          fatG: Math.round(day.fatG),
          waterMl: waterByDay.get(date) ?? null,
        }));

      const measured = await tx
        .select({
          kind: bodyMeasurements.kind,
          value: bodyMeasurements.value,
          date: bodyMeasurements.measuredOn,
        })
        .from(bodyMeasurements)
        .where(eq(bodyMeasurements.userId, studentId))
        .orderBy(asc(bodyMeasurements.measuredOn));
      const byKind = new Map<string, Array<{ date: string; value: number }>>();
      for (const m of measured) {
        byKind.set(m.kind, [...(byKind.get(m.kind) ?? []), { date: m.date, value: m.value }]);
      }

      const sinceHistory = addDays(today, -HISTORY_DAYS);
      const sets = await tx
        .select({
          date: sessionExecutions.performedOn,
          executionId: executionSets.executionId,
          exerciseId: executionSets.exerciseId,
          reps: executionSets.reps,
          loadKg: executionSets.loadKg,
        })
        .from(executionSets)
        .innerJoin(sessionExecutions, eq(sessionExecutions.id, executionSets.executionId))
        .where(
          and(
            eq(executionSets.userId, studentId),
            eq(executionSets.completed, true),
            gte(executionSets.setNumber, 1),
            inArray(sessionExecutions.status, FINISHED),
            gte(sessionExecutions.performedOn, sinceHistory),
          ),
        )
        .orderBy(asc(sessionExecutions.performedOn));
      const perExercise = new Map<string, Map<string, typeof sets>>();
      for (const row of sets) {
        const sessions = perExercise.get(row.exerciseId) ?? new Map<string, typeof sets>();
        sessions.set(row.executionId, [...(sessions.get(row.executionId) ?? []), row]);
        perExercise.set(row.exerciseId, sessions);
      }
      const strength = [...perExercise]
        .sort((a, b) => b[1].size - a[1].size)
        .slice(0, TOP_EXERCISES)
        .map(([exerciseId, sessions]) => ({
          exerciseId,
          points: [...sessions.values()].slice(-MAX_POINTS).map((rows) => {
            const top = [...rows].sort(
              (a, b) => (b.loadKg ?? 0) - (a.loadKg ?? 0) || (b.reps ?? 0) - (a.reps ?? 0),
            )[0];
            return {
              date: rows[0]?.date ?? today,
              topLoadKg: top?.loadKg ?? null,
              repsAtTop: top?.reps ?? null,
              tonnageKg: Math.round(
                rows.reduce((total, r) => total + (r.reps ?? 0) * (r.loadKg ?? 0), 0),
              ),
            };
          }),
        }));

      const painRows = await tx
        .select({ date: sessionExecutions.performedOn, reports: sessionExecutions.painReports })
        .from(sessionExecutions)
        .where(
          and(
            eq(sessionExecutions.userId, studentId),
            gte(sessionExecutions.performedOn, sinceHistory),
          ),
        )
        .orderBy(desc(sessionExecutions.performedOn));
      const pain = new Map<string, { reports: number; maxIntensity: number; lastOn: string }>();
      for (const row of painRows) {
        for (const report of row.reports) {
          const key = regionOf(report.region) ?? report.region.toLowerCase();
          const current = pain.get(key);
          pain.set(key, {
            reports: (current?.reports ?? 0) + 1,
            maxIntensity: Math.max(current?.maxIntensity ?? 0, report.intensity),
            lastOn: current?.lastOn ?? row.date,
          });
        }
      }

      const reassessments = await tx
        .select({
          cycleEndedOn: cycleReassessments.cycleEndedOn,
          status: cycleReassessments.status,
          submittedAt: cycleReassessments.submittedAt,
        })
        .from(cycleReassessments)
        .where(eq(cycleReassessments.userId, studentId))
        .orderBy(desc(cycleReassessments.cycleEndedOn))
        .limit(6);

      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: studentId,
        action: 'STUDENT_EVOLUTION_VIEWED',
        entityType: 'student',
        entityId: studentId,
        changes: { weeks: weeksCount },
      });

      return {
        today,
        weeks,
        plannedByWeek,
        days,
        nutritionDays,
        metrics,
        byKind,
        strength,
        pain,
        reassessments,
      };
    });

    const memory = await this.memory.active(studentId);
    return {
      asOf: data.today,
      weeks: data.weeks.map((w) => ({
        weekStart: w.weekStart,
        planned: w.planned,
        done: w.done,
        missed: w.missed,
        plannedLoad: data.plannedByWeek.get(w.weekStart) ?? 0,
        realizedLoad: w.load,
        avgRpe: w.avgRpe,
        painReports: w.painReports,
      })),
      days: data.days,
      nutritionDays: data.nutritionDays,
      load: {
        weeklyLoad: data.metrics.weeklyLoad,
        previousWeeklyLoad: data.metrics.previousWeeklyLoad,
        acwr: data.metrics.acwr,
        monotony: data.metrics.monotony,
        strain: data.metrics.strain,
        adherenceRatio: data.metrics.adherenceRatio,
        readiness: {
          score: data.metrics.readiness.score,
          baseline: data.metrics.readiness.baseline,
          delta: data.metrics.readiness.delta,
        },
        risks: data.metrics.risks,
      },
      measurements: [...data.byKind].map(([kind, points]) => ({
        kind,
        points: points.slice(-MAX_POINTS),
      })),
      strength: data.strength,
      pain: [...data.pain].map(([region, value]) => ({ region, ...value })),
      memory: memory.map((m) => ({
        kind: m.kind,
        text: m.text,
        importance: m.importance,
      })),
      reassessments: data.reassessments.map((r) => ({
        cycleEndedOn: r.cycleEndedOn,
        status: r.status,
        submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
      })),
    };
  }
}
