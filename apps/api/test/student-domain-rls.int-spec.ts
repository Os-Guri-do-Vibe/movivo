/**
 * Integração — isolamento por titular das tabelas do Estado do Aluno, treino integrado,
 * nutrição, corpo, check-ins, trilha de decisões e outbox. Pré-requisito: `pnpm run infra:up`.
 *
 * Para cada tabela nova, grava uma linha do aluno A e uma do aluno B (como SYSTEM) e prova que,
 * sob a sessão do aluno A, um SELECT SEM filtro de titular devolve só a linha de A. Também prova
 * as regras de negócio que o banco repete (um plano ativo por aluno, inferência não obrigatória).
 */
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq, inArray, sql } from 'drizzle-orm';
import postgres from 'postgres';
import type { PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/core/config/load-env';
import { migrationPostgresTls } from '../src/core/database/postgres-tls';
import {
  bodyAssessments,
  bodyMeasurements,
  bodyPhotos,
  checkIns,
  coachingDecisions,
  coachingProposals,
  decisionExecutions,
  domainEvents,
  exceptionCases,
  executionMetrics,
  executionSets,
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
  studentObservations,
  studentPreferences,
  studentProfiles,
  studentStateSnapshots,
  trainingPlans,
  users,
} from '../src/core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../src/core/database/tenant-database.service';

const { env } = loadEnv();
/**
 * Superusuário só para a fixture de consentimento: o runtime (`movivo_app`) não tem INSERT em
 * `consents` (append-only, gravado pelo fluxo de consentimento).
 */
const admin = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
  ssl: migrationPostgresTls(env, env.MIGRATION_DATABASE_HOST ?? 'localhost'),
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
  user: 'postgres',
  password: readFileSync(
    resolve(process.cwd(), '../../secrets/desenvolvimento/postgres_superuser_password'),
    'utf8',
  ).trimEnd(),
  database: env.DATABASE_NAME ?? 'movivo',
  max: 1,
  onnotice: () => {
    /* Notices SQL não devem registrar valores da fixture. */
  },
});

async function createConsent(userId: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    INSERT INTO consents (user_id, consent_type, version, accepted)
    VALUES (${userId}::uuid, 'HEALTH_DATA', 'teste-fotos', true)
    RETURNING id`;
  return row.id;
}

let app: INestApplication;
let db: TenantDatabase;
let userA: string;
let userB: string;

const TODAY = '2026-11-02';
const NOW = new Date('2026-11-02T10:00:00.000Z');

/** Primeira linha de um `returning`, ou falha explícita da fixture. */
function one<T>(rows: T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error('fixture: insert sem linha devolvida');
  return row;
}

async function createUser(tx: TenantTransaction): Promise<string> {
  const phone = `+55119${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const user = one(
    await tx
      .insert(users)
      .values({ phoneNumber: phone, email: `${phone.replace(/\D/g, '')}@example.invalid` })
      .returning({ id: users.id }),
  );
  return user.id;
}

/** Uma linha por tabela nova para o titular, respeitando as dependências entre elas. */
async function seedStudent(
  tx: TenantTransaction,
  userId: string,
  consentId: string,
): Promise<void> {
  await tx.insert(studentProfiles).values({ userId, profile: {} as never });
  await tx.insert(studentHealthRecords).values({
    userId,
    kind: 'INJURY',
    payload: Buffer.from('cifrado-na-aplicacao'),
    origin: 'DECLARED',
  });
  const goal = one(
    await tx
      .insert(studentGoals)
      .values({ userId, version: 1, declared: {} as never, startedOn: TODAY })
      .returning({ id: studentGoals.id }),
  );
  await tx.insert(goalMilestones).values({
    userId,
    goalId: goal.id,
    ordinal: 1,
    milestone: {} as never,
    dueOn: TODAY,
  });
  await tx.insert(goalTasks).values({
    userId,
    goalId: goal.id,
    kind: 'COMPLETE_SESSIONS',
    title: 'Completar 3 sessões',
    windowStart: TODAY,
    windowEnd: TODAY,
    target: 3,
  });
  await tx.insert(studentConstraints).values({
    userId,
    kind: 'EQUIPMENT',
    constraint: { kind: 'EQUIPMENT', available: [] },
    origin: 'DECLARED',
    validFrom: TODAY,
  });
  await tx.insert(studentPreferences).values({
    userId,
    domain: 'EXERCISE',
    key: 'exercise:agachamento_livre',
    value: 'DISLIKES',
    strength: 'STRONG',
    origin: 'DECLARED',
    confidence: 90,
  });
  await tx.insert(studentObservations).values({
    userId,
    observation: {} as never,
    sourceEventIds: [],
  });
  await tx.insert(studentStateSnapshots).values({ userId, version: 1, state: {} });

  const plan = one(
    await tx
      .insert(trainingPlans)
      .values({ userId, version: 1, structure: {} as never, startsOn: TODAY })
      .returning({ id: trainingPlans.id }),
  );
  const planSession = one(
    await tx
      .insert(planSessions)
      .values({
        userId,
        planId: plan.id,
        key: 'STR_A',
        modality: 'STRENGTH',
        title: 'Força A',
        priority: 'KEY',
        weeklyFrequency: 1,
        estimatedMinutes: 50,
        estimatedLoad: 350,
        content: {} as never,
      })
      .returning({ id: planSessions.id }),
  );
  const scheduled = one(
    await tx
      .insert(scheduledSessions)
      .values({
        userId,
        planId: plan.id,
        planSessionId: planSession.id,
        weekStart: TODAY,
        occurrence: 1,
        scheduledOn: TODAY,
      })
      .returning({ id: scheduledSessions.id }),
  );
  const execution = one(
    await tx
      .insert(sessionExecutions)
      .values({
        userId,
        scheduledSessionId: scheduled.id,
        planSessionId: planSession.id,
        modality: 'STRENGTH',
        performedOn: TODAY,
        source: 'LINK',
      })
      .returning({ id: sessionExecutions.id }),
  );
  await tx.insert(executionSets).values({
    userId,
    executionId: execution.id,
    exerciseId: 'agachamento_livre',
    setNumber: 1,
  });
  await tx.insert(executionMetrics).values({ userId, executionId: execution.id, metrics: {} });

  await tx
    .insert(nutritionPlans)
    .values({ userId, version: 1, structure: {} as never, startsOn: TODAY });
  await tx.insert(foodLogs).values({
    userId,
    loggedOn: TODAY,
    meal: 'LUNCH',
    items: [],
    totals: {} as never,
    source: 'TEXT',
  });

  await tx
    .insert(bodyMeasurements)
    .values({ userId, kind: 'WAIST', value: 92, method: 'SELF_TAPE', measuredOn: TODAY });
  await tx.insert(bodyPhotos).values({
    userId,
    angle: 'FRONT',
    takenOn: TODAY,
    storagePath: `teste/${userId}.jpg`,
    consentId,
  });
  await tx
    .insert(bodyAssessments)
    .values({ userId, assessedOn: TODAY, photoIds: [], result: {} as never });
  await tx.insert(checkIns).values({ userId, kind: 'WEEKLY', questions: [], expiresAt: NOW });

  const proposal = one(
    await tx
      .insert(coachingProposals)
      .values({
        userId,
        taskId: 'teste.tarefa',
        actionType: 'ASK_STUDENT',
        action: { type: 'ASK_STUDENT', question: 'Tudo certo?' },
        rationale: ['teste'],
        evidence: [],
        assumptions: [],
        uncertainty: 'LOW',
        expectedOutcome: 'teste',
        stateVersion: 1,
        expiresAt: NOW,
      })
      .returning({ id: coachingProposals.id }),
  );
  const decision = one(
    await tx
      .insert(coachingDecisions)
      .values({
        userId,
        proposalId: proposal.id,
        verdict: 'EXECUTE',
        reasons: ['teste'],
        decidedBy: 'POLICY_ENGINE',
      })
      .returning({ id: coachingDecisions.id }),
  );
  await tx.insert(decisionExecutions).values({
    userId,
    decisionId: decision.id,
    command: 'communication.ask',
    status: 'SUCCEEDED',
    result: {},
  });
  await tx.insert(safetyEvents).values({
    userId,
    kind: 'PERSISTENT_PAIN',
    severity: 'ATTENTION',
    scope: 'TRAINING',
    detectedBy: 'RULE',
    evidence: 'dor no joelho há 2 semanas',
  });
  await tx.insert(exceptionCases).values({
    userId,
    kind: 'SAFETY',
    priority: 'HIGH',
    domain: 'TRAINING',
    subject: {},
    summary: 'teste',
  });
  await tx.insert(domainEvents).values({ userId, type: 'SessionExecuted', payload: {} });
}

const TENANT_TABLES: ReadonlyArray<readonly [string, PgTable]> = [
  ['student_profiles', studentProfiles],
  ['student_health_records', studentHealthRecords],
  ['student_goals', studentGoals],
  ['goal_milestones', goalMilestones],
  ['goal_tasks', goalTasks],
  ['student_constraints', studentConstraints],
  ['student_preferences', studentPreferences],
  ['student_observations', studentObservations],
  ['student_state_snapshots', studentStateSnapshots],
  ['training_plans', trainingPlans],
  ['plan_sessions', planSessions],
  ['scheduled_sessions', scheduledSessions],
  ['session_executions', sessionExecutions],
  ['execution_sets', executionSets],
  ['execution_metrics', executionMetrics],
  ['nutrition_plans', nutritionPlans],
  ['food_logs', foodLogs],
  ['body_measurements', bodyMeasurements],
  ['body_photos', bodyPhotos],
  ['body_assessments', bodyAssessments],
  ['check_ins', checkIns],
  ['coaching_proposals', coachingProposals],
  ['coaching_decisions', coachingDecisions],
  ['decision_executions', decisionExecutions],
  ['safety_events', safetyEvents],
  ['exception_cases', exceptionCases],
  ['domain_events', domainEvents],
];

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  db = app.get(TenantDatabase);
  [userA, userB] = await db.runAsSystem(async (tx) => [await createUser(tx), await createUser(tx)]);
  const consentA = await createConsent(userA);
  const consentB = await createConsent(userB);
  await db.runAsSystem(async (tx) => {
    await seedStudent(tx, userA, consentA);
    await seedStudent(tx, userB, consentB);
  });
});

afterAll(async () => {
  if (db && userA && userB) {
    // `body_photos` segura o consentimento (RESTRICT): sai primeiro, depois o consentimento,
    // depois o titular (as demais tabelas novas são CASCADE a partir de `users`).
    await db.runAsSystem((tx) =>
      tx.delete(bodyPhotos).where(inArray(bodyPhotos.userId, [userA, userB])),
    );
    await admin`DELETE FROM consents WHERE user_id IN (${userA}::uuid, ${userB}::uuid)`;
    await db.runAsSystem((tx) => tx.delete(users).where(inArray(users.id, [userA, userB])));
  }
  await admin.end();
  await app?.close();
});

describe('isolamento por titular (FORCE RLS) nas tabelas novas', () => {
  it.each(TENANT_TABLES)('%s: o aluno A só enxerga a própria linha', async (_name, table) => {
    const owners = await db.runAsUser(userA, 'USER', (tx) =>
      tx.execute<{ user_id: string }>(sql`select user_id from ${table}`),
    );
    const ids = new Set(owners.map((row) => row.user_id));
    expect(ids.has(userA)).toBe(true);
    expect(ids.has(userB)).toBe(false);
  });
});

describe('regras de negócio repetidas no banco', () => {
  it('no máximo um plano de treino ACTIVE por aluno', async () => {
    await expect(
      db.runAsSystem(async (tx) => {
        await tx
          .update(trainingPlans)
          .set({ status: 'ACTIVE' })
          .where(eq(trainingPlans.userId, userA));
        await tx.insert(trainingPlans).values({
          userId: userA,
          version: 2,
          status: 'ACTIVE',
          structure: {} as never,
          startsOn: TODAY,
        });
      }),
    ).rejects.toThrow();
  });

  it('preferência inferida não pode ser gravada como obrigatória', async () => {
    await expect(
      db.runAsSystem((tx) =>
        tx.insert(studentPreferences).values({
          userId: userA,
          domain: 'SESSION_LENGTH',
          key: 'session_minutes',
          value: 45,
          strength: 'REQUIRED',
          origin: 'INFERRED',
          confidence: 30,
        }),
      ),
    ).rejects.toThrow();
  });

  it('valor fora da lista do contrato é recusado pelo CHECK', async () => {
    await expect(
      db.runAsSystem((tx) =>
        tx.insert(domainEvents).values({ userId: userA, type: 'EventoInventado', payload: {} }),
      ),
    ).rejects.toThrow();
  });
});
