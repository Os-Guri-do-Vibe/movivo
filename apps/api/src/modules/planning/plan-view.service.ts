/**
 * Leitura do plano para a página do aluno (`/plano/[token]`). Só lê; o acesso é por credencial
 * opaca verificada pelo controlador.
 */
import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte } from 'drizzle-orm';

import { ageInYears, type PlanRead, type TrainingPlanStructure } from '@movivo/shared';

import {
  bodyMeasurements,
  goalMilestones,
  goalTasks,
  nutritionPlans,
  planSessions,
  scheduledSessions,
  studentGoals,
  studentProfiles,
  trainingPlans,
  users,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { StudentStateReader } from '../student-state/student-state.reader';
import { mondayOf } from './calc/week-planner';
import { scheduleContextOf } from './inputs';
import { PLAN_STATE_SLICES, todayIn } from './plan-generation.service';
import { baseWeekOf } from './plan-publisher.service';
import type { PdfStudent } from './protocol-pdf';
import { parseStateView } from './state-view';

const UPCOMING_DAYS = 14;
const DAY_MS = 86_400_000;

@Injectable()
export class PlanViewService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly stateReader: StudentStateReader,
    private readonly methodology: PublishedMethodologyReader,
  ) {}

  /**
   * Semana-base do protocolo: a distribuição fixa de segunda a domingo (a mesma da revisão), com a
   * disponibilidade e as regras de hoje. Os dias marcados pelo profissional já entram fixados.
   */
  private async baseWeek(
    userId: string,
    structure: TrainingPlanStructure,
    today: string,
    now: Date,
  ): Promise<NonNullable<PlanRead['training']>['baseWeek']> {
    const state = await this.stateReader.read(userId, PLAN_STATE_SLICES, now);
    const view = parseStateView(state.slices as Record<string, unknown>);
    const schedule = scheduleContextOf(
      view,
      (await this.methodology.publishedOf('HYBRID'))?.parameters,
      (await this.methodology.publishedOf('RUNNING'))?.parameters,
    );
    return baseWeekOf(structure.sessions, schedule, mondayOf(today)).sessions.map(
      ({ weekday, slot, planSessionKey }) => ({ weekday, slot, planSessionKey }),
    );
  }

  /**
   * Dados do cabeçalho do PDF do protocolo. Ficam fora de `PlanRead` (a página pública por token
   * não carrega dado pessoal); só o PDF os mostra.
   */
  async readStudent(userId: string, now: Date = new Date()): Promise<PdfStudent> {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const [user] = await tx
        .select({ name: users.name, sex: users.biologicalSex })
        .from(users)
        .where(eq(users.id, userId));
      const [profile] = await tx
        .select({ profile: studentProfiles.profile })
        .from(studentProfiles)
        .where(eq(studentProfiles.userId, userId));
      const [firstWeight] = await tx
        .select({ value: bodyMeasurements.value })
        .from(bodyMeasurements)
        .where(and(eq(bodyMeasurements.userId, userId), eq(bodyMeasurements.kind, 'WEIGHT')))
        .orderBy(asc(bodyMeasurements.measuredOn), asc(bodyMeasurements.createdAt))
        .limit(1);
      const birthDate = profile?.profile.birthDate;
      return {
        fullName: user?.name?.trim() || null,
        ageYears: birthDate ? ageInYears(birthDate, now) : null,
        initialWeightKg: firstWeight?.value ?? null,
        heightCm: profile?.profile.heightCm ?? null,
        biologicalSex: user?.sex ?? null,
      };
    });
  }

  async read(userId: string, now: Date = new Date()): Promise<PlanRead | null> {
    let today = '';
    const plan = await this.db.runAsUser(userId, 'USER', async (tx): Promise<PlanRead | null> => {
      const [user] = await tx
        .select({ name: users.name, timezone: users.timezone })
        .from(users)
        .where(eq(users.id, userId));
      today = todayIn(user?.timezone ?? null, now);
      const [training] = await tx
        .select()
        .from(trainingPlans)
        .where(and(eq(trainingPlans.userId, userId), eq(trainingPlans.status, 'ACTIVE')));
      const [nutrition] = await tx
        .select()
        .from(nutritionPlans)
        .where(and(eq(nutritionPlans.userId, userId), eq(nutritionPlans.status, 'ACTIVE')));
      if (!training && !nutrition) return null;

      const [goal] = await tx
        .select()
        .from(studentGoals)
        .where(and(eq(studentGoals.userId, userId), eq(studentGoals.status, 'ACTIVE')))
        .limit(1);
      const milestones = goal
        ? await tx
            .select()
            .from(goalMilestones)
            .where(eq(goalMilestones.goalId, goal.id))
            .orderBy(asc(goalMilestones.ordinal))
        : [];
      const tasks = goal
        ? await tx
            .select()
            .from(goalTasks)
            .where(and(eq(goalTasks.goalId, goal.id), gte(goalTasks.windowEnd, today)))
        : [];

      const upcoming = training
        ? await tx
            .select({
              date: scheduledSessions.scheduledOn,
              slot: scheduledSessions.slot,
              status: scheduledSessions.status,
              planSessionKey: planSessions.key,
              title: planSessions.title,
              modality: planSessions.modality,
              minutes: planSessions.estimatedMinutes,
            })
            .from(scheduledSessions)
            .innerJoin(planSessions, eq(planSessions.id, scheduledSessions.planSessionId))
            .where(
              and(
                eq(scheduledSessions.userId, userId),
                eq(scheduledSessions.planId, training.id),
                gte(scheduledSessions.scheduledOn, today),
              ),
            )
            .orderBy(asc(scheduledSessions.scheduledOn))
        : [];
      const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + UPCOMING_DAYS * DAY_MS)
        .toISOString()
        .slice(0, 10);

      return {
        firstName: user?.name?.trim().split(/\s+/)[0] ?? null,
        strategy: goal?.strategy ?? null,
        milestones: milestones.map((m) => ({
          milestone: m.milestone,
          dueOn: m.dueOn,
          status: m.status as PlanRead['milestones'][number]['status'],
        })),
        tasks: tasks.map((t) => ({
          title: t.title,
          target: t.target,
          progress: t.progress,
          windowEnd: t.windowEnd,
          status: t.status as PlanRead['tasks'][number]['status'],
        })),
        training: training
          ? {
              version: training.version,
              startsOn: training.startsOn,
              structure: training.structure,
              upcoming: upcoming
                .filter((s) => s.date <= horizon)
                .map((s) => ({
                  ...s,
                  slot: s.slot as PlanRead['training'] extends infer T
                    ? T extends { upcoming: (infer U)[] }
                      ? U extends { slot: infer S }
                        ? S
                        : never
                      : never
                    : never,
                  status: s.status as never,
                  modality: s.modality as never,
                })),
              // Preenchida abaixo, fora da transação (lê o Estado do Aluno e a metodologia).
              baseWeek: [],
            }
          : null,
        nutrition: nutrition
          ? {
              version: nutrition.version,
              startsOn: nutrition.startsOn,
              structure: nutrition.structure,
            }
          : null,
      };
    });
    if (plan?.training) {
      plan.training.baseWeek = await this.baseWeek(userId, plan.training.structure, today, now);
    }
    return plan;
  }
}
