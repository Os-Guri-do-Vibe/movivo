/**
 * StudentStateReader — monta as FATIAS do Estado do Aluno que uma tarefa de agente pede.
 *
 * Lê sob a sessão RLS do próprio aluno (`runAsUser(..., 'USER')`): mesmo um bug na montagem do
 * contexto não consegue trazer linha de outro titular. Cada fatia é compacta e sem PII direta
 * (idade em vez de data de nascimento; nunca nome, telefone ou e-mail). Registros de saúde só
 * entram decifrados com consentimento de saúde ATIVO no momento da leitura.
 */
import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNull, lte } from 'drizzle-orm';

import {
  healthRecordPayloadSchema,
  type DailyTargets,
  type StudentConstraint,
} from '@movivo/shared';

import type { StateContext } from '../../core/agents/agent-context';
import type { StateSlice } from '../../core/agents/agent-task';
import { HealthCipherService } from '../../core/database/health-cipher.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import {
  bodyMeasurements,
  coachingDecisions,
  coachingProposals,
  foodLogs,
  goalMilestones,
  goalTasks,
  nutritionPlans,
  planSessions,
  safetyEvents,
  scheduledSessions,
  sessionExecutions,
  studentConstraints,
  studentGoals,
  studentHealthRecords,
  studentPreferences,
  studentProfiles,
  studentStateSnapshots,
  trainingPlans,
  users,
} from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';

const DAY_MS = 86_400_000;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function ageYears(birthDate: string, today: Date): number {
  const birth = new Date(`${birthDate}T00:00:00.000Z`);
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < birth.getUTCMonth() ||
    (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

@Injectable()
export class StudentStateReader {
  constructor(
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
    private readonly consent: HealthConsentService,
  ) {}

  async read(
    userId: string,
    slices: readonly StateSlice[],
    now: Date = new Date(),
  ): Promise<StateContext> {
    const wanted = new Set(slices);
    const healthAllowed = wanted.has('safety')
      ? await this.consent.hasActiveForUser(userId)
      : false;
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const out: StateContext['slices'] = {};
      const today = isoDay(now);
      for (const slice of wanted) {
        out[slice] = await this.slice(tx, slice, userId, now, today, healthAllowed);
      }
      const [snapshot] = await tx
        .select({ version: studentStateSnapshots.version })
        .from(studentStateSnapshots)
        .where(eq(studentStateSnapshots.userId, userId));
      return { slices: out, version: snapshot?.version ?? 0 };
    });
  }

  private slice(
    tx: TenantTransaction,
    slice: StateSlice,
    userId: string,
    now: Date,
    today: string,
    healthAllowed: boolean,
  ): Promise<unknown> {
    switch (slice) {
      case 'identity':
        return this.identity(tx, userId, now);
      case 'goals':
        return this.goals(tx, userId, today);
      case 'availability':
        return this.constraintsOf(tx, userId, ['AVAILABILITY', 'AVAILABILITY_OVERRIDE'], today);
      case 'restrictions':
        return this.constraintsOf(
          tx,
          userId,
          ['MOVEMENT_RESTRICTION', 'EQUIPMENT', 'DIETARY_RESTRICTION', 'FOOD_ALLERGY'],
          today,
        );
      case 'preferences':
        return this.preferences(tx, userId);
      case 'training':
        return this.training(tx, userId, now);
      case 'nutrition':
        return this.nutrition(tx, userId, now);
      case 'body':
        return this.body(tx, userId);
      case 'adherence':
        return this.adherence(tx, userId, now);
      case 'safety':
        return this.safety(tx, userId, healthAllowed);
      case 'recentDecisions':
        return this.recentDecisions(tx, userId);
    }
  }

  private async identity(tx: TenantTransaction, userId: string, now: Date) {
    const [user] = await tx
      .select({ sex: users.biologicalSex, timezone: users.timezone })
      .from(users)
      .where(eq(users.id, userId));
    const [profile] = await tx
      .select({ profile: studentProfiles.profile })
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, userId));
    const birthDate = profile?.profile.birthDate;
    return {
      ageYears: birthDate ? ageYears(birthDate, now) : null,
      biologicalSex: user?.sex ?? null,
      heightCm: profile?.profile.heightCm ?? null,
      timezone: user?.timezone ?? null,
      lifeContext: profile?.profile.lifeContext ?? null,
    };
  }

  private async goals(tx: TenantTransaction, userId: string, today: string) {
    const [goal] = await tx
      .select()
      .from(studentGoals)
      .where(and(eq(studentGoals.userId, userId), eq(studentGoals.status, 'ACTIVE')))
      .orderBy(desc(studentGoals.version))
      .limit(1);
    if (!goal) return null;
    const milestones = await tx
      .select({
        ordinal: goalMilestones.ordinal,
        milestone: goalMilestones.milestone,
        dueOn: goalMilestones.dueOn,
        status: goalMilestones.status,
      })
      .from(goalMilestones)
      .where(eq(goalMilestones.goalId, goal.id))
      .orderBy(goalMilestones.ordinal);
    const tasks = await tx
      .select({
        kind: goalTasks.kind,
        title: goalTasks.title,
        target: goalTasks.target,
        progress: goalTasks.progress,
        status: goalTasks.status,
        windowEnd: goalTasks.windowEnd,
      })
      .from(goalTasks)
      .where(
        and(
          eq(goalTasks.goalId, goal.id),
          lte(goalTasks.windowStart, today),
          gte(goalTasks.windowEnd, today),
        ),
      );
    return {
      goalId: goal.id,
      declared: goal.declared,
      strategy: goal.strategy,
      startedOn: goal.startedOn,
      reviewOn: goal.reviewOn,
      milestones,
      currentTasks: tasks,
    };
  }

  private async constraintsOf(
    tx: TenantTransaction,
    userId: string,
    kinds: readonly StudentConstraint['kind'][],
    today: string,
  ) {
    const rows = await tx
      .select({
        constraint: studentConstraints.constraint,
        validUntil: studentConstraints.validUntil,
      })
      .from(studentConstraints)
      .where(and(eq(studentConstraints.userId, userId), isNull(studentConstraints.supersededAt)));
    return rows
      .filter((row) => kinds.includes(row.constraint.kind))
      .filter((row) => row.validUntil === null || row.validUntil >= today)
      .map((row) => row.constraint);
  }

  private async preferences(tx: TenantTransaction, userId: string) {
    return tx
      .select({
        domain: studentPreferences.domain,
        key: studentPreferences.key,
        value: studentPreferences.value,
        strength: studentPreferences.strength,
        origin: studentPreferences.origin,
        confidence: studentPreferences.confidence,
      })
      .from(studentPreferences)
      .where(and(eq(studentPreferences.userId, userId), isNull(studentPreferences.supersededAt)));
  }

  private async training(tx: TenantTransaction, userId: string, now: Date) {
    const [profile] = await tx
      .select({ profile: studentProfiles.profile })
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, userId));
    const [plan] = await tx
      .select()
      .from(trainingPlans)
      .where(and(eq(trainingPlans.userId, userId), eq(trainingPlans.status, 'ACTIVE')));
    const sessions = plan
      ? await tx
          .select({
            key: planSessions.key,
            modality: planSessions.modality,
            title: planSessions.title,
            priority: planSessions.priority,
            weeklyFrequency: planSessions.weeklyFrequency,
            estimatedMinutes: planSessions.estimatedMinutes,
            estimatedLoad: planSessions.estimatedLoad,
          })
          .from(planSessions)
          .where(eq(planSessions.planId, plan.id))
      : [];
    const since = isoDay(new Date(now.getTime() - 21 * DAY_MS));
    const executions = await tx
      .select({
        performedOn: sessionExecutions.performedOn,
        modality: sessionExecutions.modality,
        status: sessionExecutions.status,
        rpe: sessionExecutions.rpe,
        durationMinutes: sessionExecutions.durationMinutes,
        load: sessionExecutions.load,
        painReports: sessionExecutions.painReports,
        loggedLate: sessionExecutions.loggedLate,
      })
      .from(sessionExecutions)
      .where(and(eq(sessionExecutions.userId, userId), gte(sessionExecutions.performedOn, since)))
      .orderBy(desc(sessionExecutions.performedOn));
    const upcoming = await tx
      .select({
        scheduledOn: scheduledSessions.scheduledOn,
        slot: scheduledSessions.slot,
        status: scheduledSessions.status,
        planSessionId: scheduledSessions.planSessionId,
      })
      .from(scheduledSessions)
      .where(
        and(
          eq(scheduledSessions.userId, userId),
          gte(scheduledSessions.scheduledOn, isoDay(now)),
          lte(scheduledSessions.scheduledOn, isoDay(new Date(now.getTime() + 7 * DAY_MS))),
        ),
      );
    return {
      modalities: profile?.profile.modalities ?? [],
      externalSports: profile?.profile.externalSports ?? [],
      venues: profile?.profile.venues ?? [],
      activePlan: plan
        ? {
            planId: plan.id,
            version: plan.version,
            startsOn: plan.startsOn,
            summary: plan.structure.summary,
            phases: plan.structure.phases,
            modalityPriorities: plan.structure.modalityPriorities,
            sessions,
          }
        : null,
      last21Days: executions,
      next7Days: upcoming,
    };
  }

  private async nutrition(tx: TenantTransaction, userId: string, now: Date) {
    const [plan] = await tx
      .select()
      .from(nutritionPlans)
      .where(and(eq(nutritionPlans.userId, userId), eq(nutritionPlans.status, 'ACTIVE')));
    const since = isoDay(new Date(now.getTime() - 7 * DAY_MS));
    const logs = await tx
      .select({
        loggedOn: foodLogs.loggedOn,
        totals: foodLogs.totals,
        confirmed: foodLogs.confirmed,
      })
      .from(foodLogs)
      .where(and(eq(foodLogs.userId, userId), gte(foodLogs.loggedOn, since)));
    const byDay = new Map<string, { energyKcal: number; proteinG: number; meals: number }>();
    for (const log of logs.filter((l) => l.confirmed)) {
      const day = byDay.get(log.loggedOn) ?? { energyKcal: 0, proteinG: 0, meals: 0 };
      day.energyKcal += log.totals.energyKcal;
      day.proteinG += log.totals.proteinG;
      day.meals += 1;
      byDay.set(log.loggedOn, day);
    }
    const targets: { trainingDay: DailyTargets; restDay: DailyTargets } | null = plan
      ? { trainingDay: plan.structure.trainingDay, restDay: plan.structure.restDay }
      : null;
    return {
      activePlan: plan
        ? { planId: plan.id, version: plan.version, strategy: plan.structure.strategy, targets }
        : null,
      last7Days: [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, totals]) => ({
          day,
          energyKcal: Math.round(totals.energyKcal),
          proteinG: Math.round(totals.proteinG),
          meals: totals.meals,
        })),
    };
  }

  private async body(tx: TenantTransaction, userId: string) {
    const rows = await tx
      .select({
        kind: bodyMeasurements.kind,
        value: bodyMeasurements.value,
        measuredOn: bodyMeasurements.measuredOn,
      })
      .from(bodyMeasurements)
      .where(eq(bodyMeasurements.userId, userId))
      .orderBy(desc(bodyMeasurements.measuredOn));
    const byKind: Record<string, { latest: number; on: string; previous: number | null }> = {};
    for (const row of rows) {
      const entry = byKind[row.kind];
      if (!entry) byKind[row.kind] = { latest: row.value, on: row.measuredOn, previous: null };
      else if (entry.previous === null) entry.previous = row.value;
    }
    return byKind;
  }

  private async adherence(tx: TenantTransaction, userId: string, now: Date) {
    const since = isoDay(new Date(now.getTime() - 28 * DAY_MS));
    const scheduled = await tx
      .select({ status: scheduledSessions.status, priority: planSessions.priority })
      .from(scheduledSessions)
      .innerJoin(planSessions, eq(planSessions.id, scheduledSessions.planSessionId))
      .where(
        and(
          eq(scheduledSessions.userId, userId),
          gte(scheduledSessions.scheduledOn, since),
          lte(scheduledSessions.scheduledOn, isoDay(now)),
        ),
      );
    const done = scheduled.filter((s) => s.status === 'DONE' || s.status === 'PARTIAL').length;
    const key = scheduled.filter((s) => s.priority === 'KEY');
    return {
      windowDays: 28,
      planned: scheduled.length,
      done,
      missed: scheduled.filter((s) => s.status === 'MISSED').length,
      rate: scheduled.length > 0 ? Math.round((done / scheduled.length) * 100) / 100 : null,
      keySessionsPlanned: key.length,
      keySessionsDone: key.filter((s) => s.status === 'DONE' || s.status === 'PARTIAL').length,
    };
  }

  private async safety(tx: TenantTransaction, userId: string, healthAllowed: boolean) {
    const signals = await tx
      .select({
        kind: safetyEvents.kind,
        severity: safetyEvents.severity,
        scope: safetyEvents.scope,
      })
      .from(safetyEvents)
      .where(and(eq(safetyEvents.userId, userId), eq(safetyEvents.status, 'ACTIVE')));
    if (!healthAllowed) {
      return { activeSignals: signals, healthConsent: false, healthRecords: [] };
    }
    const records = await tx
      .select({ kind: studentHealthRecords.kind, payload: studentHealthRecords.payload })
      .from(studentHealthRecords)
      .where(
        and(eq(studentHealthRecords.userId, userId), eq(studentHealthRecords.status, 'ACTIVE')),
      );
    const healthRecords = [];
    for (const record of records) {
      const payload = healthRecordPayloadSchema.safeParse(
        JSON.parse(await this.cipher.decryptHealth(record.payload)),
      );
      if (payload.success) healthRecords.push({ kind: record.kind, ...payload.data });
    }
    return { activeSignals: signals, healthConsent: true, healthRecords };
  }

  private async recentDecisions(tx: TenantTransaction, userId: string) {
    return tx
      .select({
        actionType: coachingProposals.actionType,
        verdict: coachingDecisions.verdict,
        expectedOutcome: coachingProposals.expectedOutcome,
        decidedAt: coachingDecisions.createdAt,
      })
      .from(coachingDecisions)
      .innerJoin(coachingProposals, eq(coachingProposals.id, coachingDecisions.proposalId))
      .where(eq(coachingDecisions.userId, userId))
      .orderBy(desc(coachingDecisions.createdAt))
      .limit(10);
  }
}
