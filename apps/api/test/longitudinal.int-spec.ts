/**
 * Integração — inteligência longitudinal com alunos sintéticos de 8 semanas.
 * Pré-requisito: `pnpm run infra:up`, com o contêiner `movivo-api` parado.
 *
 * O modelo é falso (sempre o mesmo parecer cauteloso); o que se prova com Postgres real é o
 * que o código garante: o sinal certo é detectado, a explicação fica registrada como hipótese,
 * só a ação autorizada é executada (pelo motor de políticas), semana sem sinal não chama o
 * modelo e o que o aluno declarou nunca é sobrescrito.
 *
 * Com `SIM_REAL_MODEL=1` o mesmo roteiro roda com o modelo real e imprime o custo por
 * aluno-semana (lido de `model_runs`); as asserções determinísticas ficam de fora.
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { AgentRunner } from '../src/core/agents/agent-runner';
import { ModelGateway } from '../src/core/ai/model-gateway';
import {
  accessLinkTokens,
  coachingProposals,
  conversations,
  goalMilestones,
  goalTasks,
  sessionExecutions,
  domainEvents,
  modelRuns,
  nutritionPlans,
  scheduledSessions,
  studentPreferences,
  users,
  weeklyReviews,
  workoutAccessTokens,
} from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { QueueManager } from '../src/modules/jobs/queue-manager.service';
import { PlanGenerationService } from '../src/modules/planning/plan-generation.service';
import { GoalProgressService } from '../src/modules/progress/goal-progress.service';
import { PreferenceExtractionService } from '../src/modules/progress/preference-extraction.service';
import { WeeklyReviewService } from '../src/modules/progress/weekly-review.service';
import { createStudent, fakeRunner } from './plan-fixtures';
import {
  SIM_FIRST_WEEK,
  SIM_WEEKS,
  simulateStudent,
  type Persona,
} from './support/student-simulator';

const REAL = process.env.SIM_REAL_MODEL === '1';
const PLAN_DAY = new Date('2026-11-04T15:00:00.000Z');
const monday = (week: number) =>
  new Date(Date.parse(`${SIM_FIRST_WEEK}T12:00:00Z`) + (week + 1) * 7 * 86_400_000);

let app: INestApplication;
let db: TenantDatabase;
let reviews: WeeklyReviewService;
let preferences: PreferenceExtractionService;
let goals: GoalProgressService;
let enqueue: ReturnType<typeof vi.fn>;
const created: string[] = [];
const calls: string[] = [];

async function student(persona: Persona): Promise<string> {
  const userId = await createStudent(db, created);
  expect((await app.get(PlanGenerationService).generate(userId, { now: PLAN_DAY })).status).toBe(
    'PUBLISHED',
  );
  await simulateStudent(db, userId, persona, '2026-11-02');
  return userId;
}

/** Roda a revisão de cada semana fechada, como o agendador faria nas segundas. */
async function runAllWeeks(userId: string) {
  const results = [];
  for (let week = 0; week < SIM_WEEKS; week += 1) {
    results.push(await reviews.review(userId, { now: monday(week) }));
  }
  return results;
}

const reviewsOf = (userId: string) =>
  db.runAsSystem((tx) =>
    tx
      .select()
      .from(weeklyReviews)
      .where(eq(weeklyReviews.userId, userId))
      .orderBy(weeklyReviews.weekStart),
  );

beforeAll(async () => {
  const REAL_TASKS = new Set(['progress.weekly_review', 'preferences.extract_preferences']);
  const hybrid = (gateway: ModelGateway) => {
    const real = new AgentRunner(gateway);
    return {
      run: (task: { id: string }, input: unknown, options?: unknown) => {
        calls.push(task.id);
        return REAL_TASKS.has(task.id)
          ? real.run(task as never, input as never, options as never)
          : fakeRunner.run(task, input, options as never);
      },
    };
  };
  let builder = Test.createTestingModule({ imports: [AppModule] });
  // Planejamento e demais tarefas sempre falsos; no modo real, só a revisão e as preferências
  // vão ao modelo de verdade (o que se quer medir).
  builder = REAL
    ? builder.overrideProvider(AgentRunner).useFactory({ factory: hybrid, inject: [ModelGateway] })
    : builder.overrideProvider(AgentRunner).useValue({
        run: (task: { id: string }, input: unknown, options?: unknown) => {
          calls.push(task.id);
          return fakeRunner.run(task, input, options as never);
        },
      });
  app = (await builder.compile()).createNestApplication({ logger: false });
  await app.init();
  db = app.get(TenantDatabase);
  reviews = app.get(WeeklyReviewService);
  preferences = app.get(PreferenceExtractionService);
  goals = app.get(GoalProgressService);
  enqueue = vi.spyOn(app.get(QueueManager), 'enqueue').mockResolvedValue('job') as never;
});

afterAll(async () => {
  if (db && created.length > 0) {
    await db.runAsSystem(async (tx) => {
      await tx.delete(conversations).where(inArray(conversations.userId, created));
      await tx.delete(domainEvents).where(inArray(domainEvents.userId, created));
      await tx.delete(accessLinkTokens).where(inArray(accessLinkTokens.userId, created));
      await tx.delete(workoutAccessTokens).where(inArray(workoutAccessTokens.userId, created));
      await tx.delete(users).where(inArray(users.id, created));
    });
  }
  await app?.close();
});

describe.skipIf(REAL)('aluno constante', () => {
  it('não gera sinal, não chama o modelo e fecha todas as semanas como no rumo', async () => {
    const userId = await student('STEADY');
    calls.length = 0;
    await runAllWeeks(userId);
    expect(calls.filter((id) => id === 'progress.weekly_review')).toHaveLength(0);
    const rows = await reviewsOf(userId);
    expect(rows.length).toBeGreaterThanOrEqual(7);
    expect(rows.every((row) => row.status === 'ON_TRACK' && row.signals.length === 0)).toBe(true);
  });
});

describe.skipIf(REAL)('peso parado com boa adesão', () => {
  it('detecta o platô, registra a explicação como hipótese e executa só o ajuste autorizado', async () => {
    const userId = await student('STAGNANT_WEIGHT');
    const before = await db.runAsSystem((tx) =>
      tx.select().from(nutritionPlans).where(eq(nutritionPlans.userId, userId)),
    );
    await runAllWeeks(userId);

    const flagged = (await reviewsOf(userId)).filter((row) =>
      row.signals.some((s) => s.kind === 'WEIGHT_PLATEAU'),
    );
    expect(flagged.length).toBeGreaterThan(0);
    for (const row of flagged) {
      expect(row.record.status).not.toBe('ON_TRACK');
      expect(row.record.hypotheses.length).toBeGreaterThan(0);
      expect(row.record.hypotheses.every((h) => h.status === 'HYPOTHESIS')).toBe(true);
      expect(row.proposalIds.length).toBeGreaterThan(0);
    }

    // A hipótese viaja como suposição da proposta e nunca vira estado do aluno.
    const proposals = await db.runAsSystem((tx) =>
      tx
        .select()
        .from(coachingProposals)
        .where(
          and(
            eq(coachingProposals.userId, userId),
            eq(coachingProposals.taskId, 'progress.weekly_review'),
          ),
        ),
    );
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.every((p) => p.assumptions.length > 0 && p.uncertainty !== 'LOW')).toBe(true);
    const prefs = await db.runAsSystem((tx) =>
      tx.select().from(studentPreferences).where(eq(studentPreferences.userId, userId)),
    );
    expect(prefs.filter((p) => p.origin !== 'DECLARED')).toHaveLength(0);

    // A energia foi ajustada pelo comando de domínio, em nova versão do plano alimentar.
    const after = await db.runAsSystem((tx) =>
      tx.select().from(nutritionPlans).where(eq(nutritionPlans.userId, userId)),
    );
    expect(after.length).toBeGreaterThan(before.length);
  });

  it('revisar a mesma semana de novo não repete nada', async () => {
    const userId = await student('STAGNANT_WEIGHT');
    const first = await reviews.review(userId, { now: monday(5) });
    expect(first.status).toBe('REVIEWED');
    const proposalsBefore = (await reviewsOf(userId)).flatMap((row) => row.proposalIds).length;
    const again = await reviews.review(userId, { now: monday(5) });
    expect(again).toEqual({ status: 'SKIPPED', reason: 'ALREADY_REVIEWED' });
    expect((await reviewsOf(userId)).flatMap((row) => row.proposalIds)).toHaveLength(
      proposalsBefore,
    );
  });
});

describe.skipIf(REAL)('aluno que se afasta', () => {
  it('detecta a queda de adesão, reduz o volume das sessões que vêm e escreve ao aluno', async () => {
    const userId = await student('DROPPING_OFF');
    enqueue.mockClear();
    await runAllWeeks(userId);

    const flagged = (await reviewsOf(userId)).filter((row) =>
      row.signals.some((s) => s.kind === 'ADHERENCE_LOW'),
    );
    expect(flagged.length).toBeGreaterThan(0);
    expect(
      flagged.every((row) => row.record.hypotheses.every((h) => h.status === 'HYPOTHESIS')),
    ).toBe(true);

    // Volume reduzido só nas sessões planejadas que vêm, sem tocar no plano.
    const upcoming = await db.runAsSystem((tx) =>
      tx.select().from(scheduledSessions).where(eq(scheduledSessions.userId, userId)),
    );
    const adjusted = upcoming.filter((s) => s.status === 'PLANNED' && s.adjustment?.shorten);
    expect(adjusted.length).toBeGreaterThan(0);
    expect(adjusted.every((s) => (s.adjustment?.shorten?.factor ?? 1) < 1)).toBe(true);

    // A mensagem ao aluno saiu pela fila de WhatsApp, sem culpa nem comparação.
    const sent = enqueue.mock.calls
      .filter(([queue]) => queue === 'whatsapp-outbound')
      .map(([, , job]) => job as { text?: string; userId: string })
      .filter((job) => job.userId === userId && job.text);
    expect(sent.length).toBeGreaterThan(0);
  });

  it('transforma o horário em que perde sessões em hipótese, sem sobrescrever o que ele declarou', async () => {
    const userId = await student('DROPPING_OFF');
    await db.runAsSystem((tx) =>
      tx.insert(studentPreferences).values({
        userId,
        domain: 'SCHEDULE',
        key: 'slot:EVENING',
        value: 'LIKES',
        strength: 'STRONG',
        origin: 'DECLARED',
        confidence: 95,
        evidence: [],
      }),
    );
    const recorded = await preferences.extract(userId, '2026-11-02', monday(7));
    // O único padrão achado contradiz o que ele declarou: nada é gravado por cima.
    expect(recorded).toBe(0);
    const rows = await db.runAsSystem((tx) =>
      tx
        .select()
        .from(studentPreferences)
        .where(
          and(eq(studentPreferences.userId, userId), eq(studentPreferences.key, 'slot:EVENING')),
        ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.origin).toBe('DECLARED');
    expect(rows[0]?.supersededAt).toBeNull();
  });

  it('sem preferência declarada, o padrão entra como hipótese observada', async () => {
    const userId = await student('DROPPING_OFF');
    const recorded = await preferences.extract(userId, '2026-11-02', monday(7));
    expect(recorded).toBe(1);
    const [row] = await db.runAsSystem((tx) =>
      tx
        .select()
        .from(studentPreferences)
        .where(
          and(eq(studentPreferences.userId, userId), eq(studentPreferences.key, 'slot:EVENING')),
        ),
    );
    expect(row).toMatchObject({ key: 'slot:EVENING', strength: 'HYPOTHESIS', origin: 'OBSERVED' });
    expect(row?.confidence).toBeLessThanOrEqual(40);
    expect(row?.evidence.length).toBeGreaterThanOrEqual(2);
  });
});

describe.skipIf(REAL)('metas e microtarefas', () => {
  const execution = (userId: string, performedOn: string) => ({
    userId,
    modality: 'STRENGTH' as const,
    performedOn,
    status: 'COMPLETED' as const,
    source: 'LINK' as const,
    rpe: 6,
    durationMinutes: 40,
    load: 240,
  });

  it('conclui a microtarefa e o marco por evento, nunca por declaração', async () => {
    const userId = await createStudent(db, created);
    await app.get(PlanGenerationService).generate(userId, { now: PLAN_DAY });
    // Sem treino feito, nada avança.
    expect((await goals.sync(userId, '2026-11-04')).tasks).toBe(0);

    await db.runAsSystem((tx) =>
      tx
        .insert(sessionExecutions)
        .values(['2026-11-02', '2026-11-03', '2026-11-04'].map((day) => execution(userId, day))),
    );
    const first = await goals.sync(userId, '2026-11-04');
    expect(first.tasks).toBe(1);
    const [task] = await db.runAsSystem((tx) =>
      tx.select().from(goalTasks).where(eq(goalTasks.userId, userId)),
    );
    expect(task).toMatchObject({ kind: 'COMPLETE_SESSIONS', progress: 3, status: 'DONE' });

    // O marco "9 sessões" só é atingido com 9 sessões feitas depois do início da meta.
    const milestone = () =>
      db.runAsSystem((tx) =>
        tx.select().from(goalMilestones).where(eq(goalMilestones.userId, userId)),
      );
    expect((await milestone())[0]?.status).toBe('PENDING');
    await db.runAsSystem((tx) =>
      tx
        .insert(sessionExecutions)
        .values(Array.from({ length: 9 }, () => execution(userId, '2026-11-05'))),
    );
    await goals.sync(userId, '2026-11-05');
    expect((await milestone())[0]).toMatchObject({ status: 'ACHIEVED' });
  });

  it('tarefa semanal que fechou sem bater o alvo vira perdida e a semana nova abre sozinha', async () => {
    const userId = await createStudent(db, created);
    await app.get(PlanGenerationService).generate(userId, { now: PLAN_DAY });
    await db.runAsSystem((tx) =>
      tx
        .update(goalTasks)
        .set({ windowStart: '2026-10-19', windowEnd: '2026-10-25' })
        .where(eq(goalTasks.userId, userId)),
    );
    const result = await goals.sync(userId, '2026-11-04');
    expect(result.rolled).toBe(1);
    const rows = await db.runAsSystem((tx) =>
      tx
        .select()
        .from(goalTasks)
        .where(eq(goalTasks.userId, userId))
        .orderBy(goalTasks.windowStart),
    );
    expect(rows.map((r) => [r.windowStart, r.status])).toEqual([
      ['2026-10-19', 'MISSED'],
      ['2026-11-02', 'OPEN'],
    ]);
  });
});

describe.runIf(REAL)('custo com o modelo real', () => {
  it('mede o custo de IA por aluno-semana nas três personas', async () => {
    const personas: Persona[] = ['STEADY', 'STAGNANT_WEIGHT', 'DROPPING_OFF'];
    const ids: string[] = [];
    for (const persona of personas) {
      const userId = await student(persona);
      ids.push(userId);
      await runAllWeeks(userId);
      await preferences.extract(userId, '2026-11-02', monday(7));
    }
    const runs = await db.runAsSystem((tx) =>
      tx.select().from(modelRuns).where(inArray(modelRuns.userId, ids)),
    );
    const cost = runs.reduce((sum, run) => sum + Number(run.costBrl ?? 0), 0);
    const studentWeeks = personas.length * SIM_WEEKS;
    process.stderr.write(
      `[custo] ${runs.length} chamadas, R$ ${cost.toFixed(4)} em ${studentWeeks} aluno-semanas = R$ ${(cost / studentWeeks).toFixed(4)} por aluno-semana\n`,
    );
    for (const userId of ids) {
      for (const row of await reviewsOf(userId)) {
        expect(row.record.hypotheses.every((h) => h.status === 'HYPOTHESIS')).toBe(true);
      }
    }
    expect(runs.length).toBeGreaterThan(0);
  }, 600_000);
});
