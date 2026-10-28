/**
 * Integração — geração e publicação do plano. Pré-requisito: `pnpm run infra:up`, com o
 * contêiner `movivo-api` parado (os workers dele disputariam os jobs).
 *
 * O AgentRunner é substituído por um treinador falso que devolve saídas válidas por construção:
 * o que se prova aqui é a ORQUESTRAÇÃO com Postgres real — decisão do motor de políticas,
 * publicação transacional, agenda da primeira semana, eventos, link do aluno e os caminhos de
 * exceção (segurança, política que exige humano, idempotência).
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { PlanSession } from '@movivo/shared';

import { AppModule } from '../src/app.module';
import { AgentRunner } from '../src/core/agents/agent-runner';
import { AccessLinkService } from '../src/core/database/access-link.service';
import {
  accessLinkTokens,
  bodyMeasurements,
  coachingDecisions,
  coachingProposals,
  decisionExecutions,
  domainEvents,
  exceptionCases,
  goalMilestones,
  nutritionPlans,
  planSessions,
  safetyEvents,
  scheduledSessions,
  studentConstraints,
  studentGoals,
  studentPreferences,
  studentProfiles,
  trainingPlans,
  users,
} from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { PublishedPolicies } from '../src/modules/coaching/policy/published-policies';
import { PlanGenerationService } from '../src/modules/planning/plan-generation.service';
import { PlanViewService } from '../src/modules/planning/plan-view.service';
import type { NutritionInput } from '../src/modules/planning/tasks/nutrition';
import type { StrategyInput } from '../src/modules/planning/tasks/strategy';
import type { StrengthInput } from '../src/modules/planning/tasks/strength';

let app: INestApplication;
let db: TenantDatabase;
let service: PlanGenerationService;
const created: string[] = [];
const TODAY = new Date('2026-11-04T15:00:00.000Z'); // quarta-feira

/** Treinador falso: saídas válidas por construção, a partir das entradas que o código montou. */
const fakeRunner = {
  async run(task: { id: string }, input: unknown) {
    const base = {
      modelRunIds: [] as string[],
      correctionRounds: 0,
      stateVersion: 0,
      methodologyVersions: {},
      costBrl: 0,
    };
    if (task.id === 'goals.define_strategy') {
      const i = input as StrategyInput;
      return {
        ...base,
        output: {
          strategy: {
            title: 'Ganho de força com consistência',
            rationale: ['Objetivo declarado e disponibilidade favorecem foco em força.'],
            energyStrategy: i.derived.adiposity === 'HIGH' ? 'RECOMPOSITION' : 'MAINTENANCE',
            modalityFocus: ['STRENGTH'],
            indicators: [
              {
                key: 'sessions',
                label: 'Sessões concluídas',
                source: 'ADHERENCE',
                direction: 'INCREASE',
              },
            ],
            reviewAfterWeeks: 6,
            openQuestions: [],
          },
          milestones: [
            {
              indicatorKey: 'sessions',
              description: 'Concluir 9 sessões em 3 semanas.',
              condition: { kind: 'AT_LEAST', value: 9 },
              dueInWeeks: 3,
            },
          ],
          tasks: [
            { kind: 'COMPLETE_SESSIONS', title: 'Treinar 3 vezes', cadence: 'WEEKLY', target: 3 },
          ],
          studentMessage: 'Vamos construir força com constância, no seu ritmo.',
          professionalNote: 'Sem observações.',
        },
      };
    }
    if (task.id === 'strength.build_block') {
      const i = input as StrengthInput;
      const picks = i.candidates.slice(0, 6);
      const sessions: PlanSession[] = Array.from({ length: i.sessionsPerWeek }, (_, index) => ({
        key: `FORCA_${index + 1}`,
        title: `Força ${index + 1}`,
        purpose: 'Desenvolver força com progressão de carga.',
        priority: index === 0 ? 'KEY' : 'IMPORTANT',
        weeklyFrequency: 1,
        estimatedMinutes: Math.min(i.minutesPerSession, 45),
        estimatedRpe: 6,
        content: {
          modality: 'STRENGTH',
          focus: 'Corpo todo',
          exercises: picks.map((c) => ({
            exerciseId: c.id,
            name: c.name,
            sets: 3,
            ...(c.measurement === 'DURATION'
              ? { durationSeconds: 30 }
              : { reps: { min: 8, max: 12 } }),
            loadStrategy: 'DOUBLE_PROGRESSION' as const,
            rir: 2,
            restSeconds: 90,
          })),
        },
      }));
      return {
        ...base,
        output: {
          summary: 'Bloco de força de corpo inteiro.',
          phases: [{ name: 'Base', focus: 'Adaptação', weeks: 4, endsWithDeload: false }],
          sessions,
          notes: ['Suba a carga quando completar o topo das repetições.'],
        },
      };
    }
    if (task.id === 'nutrition.build_plan') {
      const i = input as NutritionInput;
      const day = (b: NutritionInput['bounds']['restDay']) => {
        const kcal = Math.round((b.energyKcal.min + b.energyKcal.max) / 2);
        const protein = Math.max(b.proteinG.min, 100);
        const fat = Math.max(b.fatMinG ?? 55, 55);
        const carbs = Math.max(20, Math.round((kcal - protein * 4 - fat * 9) / 4));
        return {
          energyKcal: { min: b.energyKcal.min, max: b.energyKcal.max },
          proteinG: protein,
          carbsG: carbs,
          fatG: fat,
          fiberG: Math.max(b.fiberMinG ?? 25, 25),
          waterMl: Math.max(b.waterMinMl ?? 2_500, 2_500),
        };
      };
      const slots = i.usualMeals.slice(0, 4);
      const share = 1 / slots.length;
      return {
        ...base,
        output: {
          strategy: i.strategy,
          summary: 'Plano alimentar simples, com proteína distribuída ao longo do dia.',
          trainingDay: day(i.bounds.trainingDay),
          restDay: day(i.bounds.restDay),
          meals: slots.map((slot) => ({
            slot,
            energyShare: share,
            proteinG: 30,
            guidance: 'Inclua uma fonte de proteína.',
            examples: ['Arroz, feijão e ovos'],
          })),
          guidelines: ['Beba água ao longo do dia.'],
          supplements: [],
        },
      };
    }
    throw new Error(`tarefa inesperada no teste: ${task.id}`);
  },
};

async function createStudent(options: { signal?: boolean } = {}): Promise<string> {
  const phone = `+55119${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const userId = await db.runAsSystem(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        phoneNumber: phone,
        email: `${phone.replace(/\D/g, '')}@example.invalid`,
        name: 'Aluno Plano',
        biologicalSex: 'MALE',
      })
      .returning({ id: users.id });
    if (!user) throw new Error('falha ao criar aluno');
    const id = user.id;
    await tx.insert(studentProfiles).values({
      userId: id,
      profile: {
        birthDate: '1994-03-10',
        heightCm: 178,
        modalities: [
          {
            modality: 'STRENGTH',
            level: 'INTERMEDIATE',
            monthsPracticing: 24,
            sessionsPerWeek: 3,
            wantsToStart: false,
          },
        ],
        externalSports: [],
        venues: ['FULL_GYM'],
        lifeContext: {
          occupationRhythm: 'REGULAR',
          cookingCapacity: 'BASIC',
          mealsOutsideHomePerWeek: 4,
          foodBudget: 'MODERATE',
        },
      },
    });
    await tx.insert(studentGoals).values({
      userId: id,
      version: 1,
      declared: { primary: 'HYPERTROPHY', secondary: [], emphasis: 'AESTHETICS' },
      startedOn: '2026-11-04',
    });
    await tx.insert(studentConstraints).values({
      userId: id,
      kind: 'AVAILABILITY',
      constraint: {
        kind: 'AVAILABILITY',
        windows: [
          { weekday: 'MON', slot: 'EVENING', maxMinutes: 60 },
          { weekday: 'WED', slot: 'EVENING', maxMinutes: 60 },
          { weekday: 'FRI', slot: 'EVENING', maxMinutes: 60 },
          { weekday: 'SAT', slot: 'MORNING', maxMinutes: 90 },
        ],
        variesWeekly: false,
        maxSessionsPerWeek: 4,
      },
      origin: 'DECLARED',
      validFrom: '2026-11-04',
    });
    await tx.insert(studentPreferences).values([
      {
        userId: id,
        domain: 'FOOD',
        key: 'meals_per_day',
        value: 4,
        strength: 'STRONG',
        origin: 'DECLARED',
        confidence: 80,
      },
      {
        userId: id,
        domain: 'FOOD',
        key: 'usual_meals',
        value: 'BREAKFAST,LUNCH,AFTERNOON_SNACK,DINNER',
        strength: 'STRONG',
        origin: 'DECLARED',
        confidence: 80,
      },
    ]);
    await tx.insert(bodyMeasurements).values([
      { userId: id, kind: 'WEIGHT', value: 80, method: 'SCALE', measuredOn: '2026-11-04' },
      { userId: id, kind: 'WAIST', value: 84, method: 'SELF_TAPE', measuredOn: '2026-11-04' },
    ]);
    if (options.signal) {
      await tx.insert(safetyEvents).values({
        userId: id,
        kind: 'PARQ_POSITIVE',
        severity: 'URGENT',
        scope: 'ALL',
        detectedBy: 'RULE',
        evidence: 'PAR-Q com resposta de risco',
      });
    }
    return id;
  });
  created.push(userId);
  return userId;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AgentRunner)
    .useValue(fakeRunner)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  db = app.get(TenantDatabase);
  service = app.get(PlanGenerationService);
});

afterAll(async () => {
  vi.restoreAllMocks();
  if (db && created.length > 0) {
    await db.runAsSystem(async (tx) => {
      await tx.delete(domainEvents).where(inArray(domainEvents.userId, created));
      await tx.delete(accessLinkTokens).where(inArray(accessLinkTokens.userId, created));
      await tx.delete(users).where(inArray(users.id, created));
    });
  }
  await app?.close();
});

describe('geração do plano', () => {
  it('publica estratégia, plano de treino, plano de nutrição e a agenda', async () => {
    const userId = await createStudent();
    const result = await service.generate(userId, { now: TODAY });
    expect(result.status).toBe('PUBLISHED');

    const [goal] = await db.runAsSystem((tx) =>
      tx.select().from(studentGoals).where(eq(studentGoals.userId, userId)),
    );
    expect(goal?.strategy?.energyStrategy).toBe('MAINTENANCE');
    expect(goal?.strategyDecisionId).not.toBeNull();
    const milestones = await db.runAsSystem((tx) =>
      tx.select().from(goalMilestones).where(eq(goalMilestones.userId, userId)),
    );
    expect(milestones).toHaveLength(1);

    const [training] = await db.runAsSystem((tx) =>
      tx.select().from(trainingPlans).where(eq(trainingPlans.userId, userId)),
    );
    expect(training).toMatchObject({ status: 'ACTIVE', version: 1 });
    const sessions = await db.runAsSystem((tx) =>
      tx
        .select()
        .from(planSessions)
        .where(eq(planSessions.planId, training?.id ?? '')),
    );
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    const [nutrition] = await db.runAsSystem((tx) =>
      tx.select().from(nutritionPlans).where(eq(nutritionPlans.userId, userId)),
    );
    expect(nutrition).toMatchObject({ status: 'ACTIVE', version: 1 });

    // Agenda: nada no passado e nenhum dia com duas sessões.
    const scheduled = await db.runAsSystem((tx) =>
      tx.select().from(scheduledSessions).where(eq(scheduledSessions.userId, userId)),
    );
    expect(scheduled.length).toBeGreaterThanOrEqual(2);
    expect(scheduled.every((s) => s.scheduledOn >= '2026-11-04')).toBe(true);
    const days = scheduled.map((s) => s.scheduledOn);
    expect(new Set(days).size).toBe(days.length);

    // Trilha de decisão: proposta → decisão → execução para as três ações.
    const proposals = await db.runAsSystem((tx) =>
      tx.select().from(coachingProposals).where(eq(coachingProposals.userId, userId)),
    );
    expect(proposals.map((p) => p.actionType).sort()).toEqual([
      'DEFINE_STRATEGY',
      'PUBLISH_NUTRITION_PLAN',
      'PUBLISH_TRAINING_PLAN',
    ]);
    const decisions = await db.runAsSystem((tx) =>
      tx.select().from(coachingDecisions).where(eq(coachingDecisions.userId, userId)),
    );
    expect(decisions.every((d) => d.verdict === 'EXECUTE')).toBe(true);
    const executions = await db.runAsSystem((tx) =>
      tx.select().from(decisionExecutions).where(eq(decisionExecutions.userId, userId)),
    );
    expect(executions).toHaveLength(3);

    const events = await db.runAsSystem((tx) =>
      tx
        .select({ type: domainEvents.type })
        .from(domainEvents)
        .where(eq(domainEvents.userId, userId)),
    );
    const types = new Set(events.map((e) => e.type));
    for (const expected of [
      'StrategyDefined',
      'PlanVersionPublished',
      'NutritionPlanPublished',
      'SessionScheduled',
      'DecisionMade',
    ]) {
      expect(types.has(expected as never)).toBe(true);
    }
  });

  it('o aluno lê o plano pelo link, sem dado pessoal além do primeiro nome', async () => {
    const userId = await createStudent();
    await service.generate(userId, { now: TODAY });
    const plan = await app.get(PlanViewService).read(userId, TODAY);
    expect(plan?.firstName).toBe('Aluno');
    expect(plan?.strategy?.studentMessage).toContain('constância');
    expect(plan?.training?.upcoming.length).toBeGreaterThan(0);
    expect(plan?.nutrition?.structure.meals.length).toBeGreaterThan(1);
    expect(JSON.stringify(plan)).not.toMatch(/example\.invalid|\+55119/);

    const links = app.get(AccessLinkService);
    const issued = await links.issue('PLAN', userId, userId, 60_000);
    expect(await links.verify(issued.token, 'PLAN')).toMatchObject({ userId });
    expect(await links.verify(issued.token, 'PROTOCOL')).toBeNull();
  });

  it('é idempotente: um segundo disparo para o mesmo objetivo não duplica o plano', async () => {
    const userId = await createStudent();
    await service.generate(userId, { now: TODAY });
    const again = await service.generate(userId, { now: TODAY });
    expect(again).toEqual({ status: 'SKIPPED', reason: 'ALREADY_PLANNED' });
    const plans = await db.runAsSystem((tx) =>
      tx.select().from(trainingPlans).where(eq(trainingPlans.userId, userId)),
    );
    expect(plans).toHaveLength(1);
  });

  it('sinal de segurança ativo suspende a geração: nenhum plano, nenhuma chamada de modelo', async () => {
    const userId = await createStudent({ signal: true });
    const spy = vi.spyOn(fakeRunner, 'run');
    const result = await service.generate(userId, { now: TODAY });
    expect(result).toEqual({ status: 'SKIPPED', reason: 'SAFETY_SIGNAL' });
    expect(spy).not.toHaveBeenCalled();
    const plans = await db.runAsSystem((tx) =>
      tx.select().from(trainingPlans).where(eq(trainingPlans.userId, userId)),
    );
    expect(plans).toHaveLength(0);
    spy.mockRestore();
  });

  it('política que exige humano deixa o plano em rascunho e abre um caso para a equipe', async () => {
    const userId = await createStudent();
    const policies = app.get(PublishedPolicies);
    const spy = vi.spyOn(policies, 'autonomy').mockResolvedValue({
      version: 99,
      byAction: {
        DEFINE_STRATEGY: { level: 'AUTO', limit: 0 },
        PUBLISH_TRAINING_PLAN: { level: 'ESCALATE', limit: 0 },
        PUBLISH_NUTRITION_PLAN: { level: 'AUTO', limit: 0 },
      },
      highUncertainty: 'ASK',
      onLimitExceeded: 'ESCALATE',
    });
    const result = await service.generate(userId, { now: TODAY });
    spy.mockRestore();
    expect(result.status).toBe('PENDING_REVIEW');

    const [training] = await db.runAsSystem((tx) =>
      tx.select().from(trainingPlans).where(eq(trainingPlans.userId, userId)),
    );
    expect(training?.status).toBe('DRAFT');
    const scheduled = await db.runAsSystem((tx) =>
      tx.select().from(scheduledSessions).where(eq(scheduledSessions.userId, userId)),
    );
    expect(scheduled).toHaveLength(0);
    const cases = await db.runAsSystem((tx) =>
      tx
        .select()
        .from(exceptionCases)
        .where(
          and(eq(exceptionCases.userId, userId), eq(exceptionCases.kind, 'NO_APPLICABLE_POLICY')),
        ),
    );
    expect(cases).toHaveLength(1);
    expect(cases[0]?.domain).toBe('TRAINING');
  });

  it('falta de metodologia publicada abre caso de falha em vez de gerar às cegas', async () => {
    const userId = await createStudent();
    const reader = app.get(
      (await import('../src/modules/methodology/published-methodology.reader'))
        .PublishedMethodologyReader,
    );
    const spy = vi.spyOn(reader, 'publishedOf').mockResolvedValue(null);
    const result = await service.generate(userId, { now: TODAY });
    spy.mockRestore();
    expect(result.status).toBe('FAILED');
    const cases = await db.runAsSystem((tx) =>
      tx
        .select()
        .from(exceptionCases)
        .where(and(eq(exceptionCases.userId, userId), eq(exceptionCases.kind, 'DECISION_FAILURE'))),
    );
    expect(cases).toHaveLength(1);
  });
});
