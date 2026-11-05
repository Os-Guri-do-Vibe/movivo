/**
 * O estudo do dia, todo dia: junta check-in, relatos do chat, treino, alimentação, água, peso e
 * contato num único registro por aluno e dia (`student_day_digests`). Sem modelo: é o código que
 * lê os dados do aluno; os especialistas leem o resultado. Também guarda o que os agentes
 * fizeram naquele dia (ajuste de sessão, conversa, alerta) para a evolução poder ser interpretada.
 */
import { Injectable } from '@nestjs/common';
import { and, eq, gte } from 'drizzle-orm';

import {
  agentOutreaches,
  bodyMeasurements,
  conversations,
  dailyCheckIns,
  foodLogs,
  planSessions,
  scheduledSessions,
  sessionExecutions,
  studentDayDigests,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { mergeObservationScales, type DayScales } from '../student-state/observations';
import { ObservationService } from '../student-state/observation.service';
import { buildDayDigest, type DayDigest } from './day-digest';

const DAY_MS = 86_400_000;

export interface AgentAction {
  by: string;
  type: string;
  detail: string;
}

@Injectable()
export class DayDigestService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly observations: ObservationService,
  ) {}

  /**
   * Monta (ou refaz) o digest do dia. `isToday` liga a contagem de mensagens das últimas 24 horas;
   * em datas passadas ela fica nula, porque o fuso do aluno não é conhecido aqui.
   */
  async build(userId: string, date: string, options: { isToday: boolean; now?: Date }) {
    const now = options.now ?? new Date();
    const reports = await this.observations.between(userId, date, date);
    const since = new Date(now.getTime() - DAY_MS);

    const digest = await this.db.runAsUser(userId, 'USER', async (tx) => {
      const [check] = await tx
        .select()
        .from(dailyCheckIns)
        .where(and(eq(dailyCheckIns.userId, userId), eq(dailyCheckIns.onDate, date)));
      const sessions = await tx
        .select({ status: scheduledSessions.status, minutes: planSessions.estimatedMinutes })
        .from(scheduledSessions)
        .innerJoin(planSessions, eq(planSessions.id, scheduledSessions.planSessionId))
        .where(and(eq(scheduledSessions.userId, userId), eq(scheduledSessions.scheduledOn, date)));
      const executions = await tx
        .select({ status: sessionExecutions.status, rpe: sessionExecutions.rpe })
        .from(sessionExecutions)
        .where(and(eq(sessionExecutions.userId, userId), eq(sessionExecutions.performedOn, date)));
      const meals = await tx
        .select({ totals: foodLogs.totals })
        .from(foodLogs)
        .where(
          and(
            eq(foodLogs.userId, userId),
            eq(foodLogs.loggedOn, date),
            eq(foodLogs.confirmed, true),
          ),
        );
      const [weight] = await tx
        .select({ value: bodyMeasurements.value })
        .from(bodyMeasurements)
        .where(
          and(
            eq(bodyMeasurements.userId, userId),
            eq(bodyMeasurements.kind, 'WEIGHT'),
            eq(bodyMeasurements.measuredOn, date),
          ),
        );
      const inbound = options.isToday
        ? await tx
            .select({ id: conversations.id })
            .from(conversations)
            .where(
              and(
                eq(conversations.userId, userId),
                eq(conversations.direction, 'INBOUND'),
                eq(conversations.mirror, false),
                gte(conversations.createdAt, since),
              ),
            )
        : null;
      const outreach = options.isToday
        ? await tx
            .select({ id: agentOutreaches.id })
            .from(agentOutreaches)
            .where(and(eq(agentOutreaches.userId, userId), gte(agentOutreaches.sentAt, since)))
        : [];

      const base: DayScales = {
        energy: check?.energy ?? null,
        sleep: check?.sleep ?? null,
        soreness: check?.soreness ?? null,
        mood: check?.mood ?? null,
        stress: check?.stress ?? null,
      };
      const built = buildDayDigest({
        date,
        scales: mergeObservationScales(base, reports),
        nutritionCheck: (check?.nutrition as DayDigest['nutritionCheck']) ?? null,
        observations: reports,
        sessions,
        executions,
        meals: meals.map((m) => ({
          energyKcal: m.totals.energyKcal,
          proteinG: m.totals.proteinG,
        })),
        waterMl: check?.waterMl ?? null,
        weightKg: weight?.value ?? null,
        studentMessages: inbound ? inbound.length : null,
        agentOutreach: outreach.length,
      });

      const [existing] = await tx
        .select({ digest: studentDayDigests.digest })
        .from(studentDayDigests)
        .where(and(eq(studentDayDigests.userId, userId), eq(studentDayDigests.onDate, date)));
      const agentActions = (existing?.digest?.agentActions as AgentAction[] | undefined) ?? [];
      const full: DayDigest = { ...built, agentActions };
      await tx
        .insert(studentDayDigests)
        .values({ userId, onDate: date, digest: full as unknown as Record<string, unknown> })
        .onConflictDoUpdate({
          target: [studentDayDigests.userId, studentDayDigests.onDate],
          set: { digest: full as unknown as Record<string, unknown>, updatedAt: new Date() },
        });
      return full;
    });
    return digest;
  }

  /** Anota no digest do dia o que um agente fez (ajuste de sessão, conversa, alerta). */
  async appendAction(userId: string, date: string, action: AgentAction): Promise<void> {
    await this.db.runAsUser(userId, 'USER', async (tx) => {
      const [existing] = await tx
        .select({ digest: studentDayDigests.digest })
        .from(studentDayDigests)
        .where(and(eq(studentDayDigests.userId, userId), eq(studentDayDigests.onDate, date)));
      if (!existing) {
        await tx.insert(studentDayDigests).values({
          userId,
          onDate: date,
          digest: { date, agentActions: [action] },
        });
        return;
      }
      const actions = ((existing.digest.agentActions as AgentAction[] | undefined) ?? []).slice(-9);
      await tx
        .update(studentDayDigests)
        .set({
          digest: { ...existing.digest, agentActions: [...actions, action] },
          updatedAt: new Date(),
        })
        .where(and(eq(studentDayDigests.userId, userId), eq(studentDayDigests.onDate, date)));
    });
  }
}
