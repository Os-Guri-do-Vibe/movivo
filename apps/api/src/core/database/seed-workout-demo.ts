import { createHash, randomBytes } from 'node:crypto';
import { CONSENT_TEXTS } from '@movivo/shared';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';

import { loadEnv } from '../config/load-env';
import {
  anamnesisSessions,
  consents,
  handoffAlerts,
  protocols,
  subscriptions,
  users,
  workoutAccessTokens,
  workoutInsights,
  workoutSessions,
  workoutSetEntries,
} from './schema';

const { env } = loadEnv();
if (env.NODE_ENV === 'production' || env.APP_ENV === 'production') {
  throw new Error('[db:seed:workout] Recusado em producao.');
}

const host = env.MIGRATION_DATABASE_HOST ?? env.DATABASE_HOST;
const port = Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT);
const user = env.MIGRATION_DATABASE_USER ?? 'movivo_migrator';
const password = env.MIGRATION_DATABASE_PASSWORD;
const database = env.DATABASE_NAME;
if (!host || !Number.isFinite(port) || !password || !database) {
  throw new Error('[db:seed:workout] Configuracao de banco incompleta.');
}

const DAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const date = (offset: number) => {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return value.toISOString().slice(0, 10);
};

const prescription = {
  dayLabel: 'Treino A',
  weekday: DAY[new Date().getDay()],
  focus: 'Corpo inteiro',
  exercises: [
    {
      exerciseId: 'agachamento-goblet',
      name: 'Agachamento goblet',
      sets: 3,
      reps: { min: 8, max: 12 },
      loadStrategy: 'DOUBLE_PROGRESSION' as const,
      restSeconds: 90,
      rir: 2,
    },
    {
      exerciseId: 'supino-halteres',
      name: 'Supino com halteres',
      sets: 3,
      reps: { min: 8, max: 12 },
      loadStrategy: 'DOUBLE_PROGRESSION' as const,
      restSeconds: 90,
      rir: 2,
    },
    {
      exerciseId: 'prancha-frontal',
      name: 'Prancha frontal',
      sets: 3,
      durationSeconds: 30,
      loadStrategy: 'BODYWEIGHT' as const,
      restSeconds: 45,
    },
  ],
};

async function main() {
  const client = postgres({ host, port, user, password, database, ssl: false, max: 1 });
  try {
    const db = drizzle(client);
    const [owner] = await db
      .insert(users)
      .values({
        phoneNumber: '+5555000000001',
        name: 'Pedro Demo',
        email: 'dev-um@example.invalid',
        status: 'ACTIVE',
      })
      .onConflictDoUpdate({
        target: users.phoneNumber,
        set: { name: 'Pedro Demo', status: 'ACTIVE' },
      })
      .returning({ id: users.id });
    if (!owner) throw new Error('Falha ao criar titular demo.');

    await db
      .insert(subscriptions)
      .values({ userId: owner.id, plan: 'MONTHLY', priceCents: 3900, status: 'ACTIVE' })
      .onConflictDoNothing();
    await db
      .insert(consents)
      .values({
        userId: owner.id,
        consentType: 'HEALTH_DATA',
        version: CONSENT_TEXTS.HEALTH_DATA.version,
        cycle: 1,
        accepted: true,
      })
      .onConflictDoNothing();

    await db
      .insert(anamnesisSessions)
      .values({
        userId: owner.id,
        token: 'workout-demo-anamnesis',
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
        status: 'PROCESSED',
        dataBlock3: {
          primaryGoal: 'GAIN_MUSCLE',
          emphasis: [],
          hasImportantEvent: false,
          trainingStatus: 'REGULAR',
          experience: 'INTERMEDIATE',
          pastActivities: ['WEIGHT_TRAINING'],
          consistencyBarriers: [],
          daysPerWeek: 1,
          preferredDays: [prescription.weekday],
          sessionDuration: 'M45_TO_60',
          location: 'FULL_GYM',
          preferredPeriod: 'VARIES',
          practicesOtherSport: false,
          hasAvoidedExercise: false,
        },
      })
      .onConflictDoNothing({ target: anamnesisSessions.token });

    const startDate = new Date(Date.now() - 28 * 86_400_000);
    const endDate = new Date(Date.now() + 28 * 86_400_000);
    const content = {
      promptVersion: 'demo-workout-v1',
      goal: 'GAIN_MUSCLE' as const,
      phase: 'HIPERTROFIA' as const,
      splitType: 'FULL_BODY' as const,
      weeklyFrequency: 1,
      sessions: [prescription],
      phaseDurationWeeks: 8,
      generalNotes: 'Demonstracao local supervisionada pelo profissional CREF.',
    };
    const [protocol] = await db
      .insert(protocols)
      .values({
        userId: owner.id,
        version: 1,
        status: 'ACTIVE',
        approvalStatus: 'AUTO_APPROVED',
        signedAt: new Date(),
        signatureHash: '0'.repeat(64),
        currentWeek: 5,
        totalWeeks: 8,
        mesocycleName: 'Demo - Hipertrofia',
        startDate,
        endDate,
        content,
        constraints: {},
        humanReviewRequired: false,
      })
      .onConflictDoUpdate({
        target: [protocols.userId, protocols.version],
        set: {
          status: 'ACTIVE',
          approvalStatus: 'AUTO_APPROVED',
          content,
          startDate,
          endDate,
        },
      })
      .returning({ id: protocols.id });
    if (!protocol) throw new Error('Falha ao criar protocolo demo.');

    const [previous] = await db
      .insert(workoutSessions)
      .values({
        userId: owner.id,
        protocolId: protocol.id,
        protocolVersion: 1,
        weekNumber: 4,
        sessionKey: prescription.dayLabel,
        scheduledDate: date(-7),
        prescription,
        status: 'COMPLETED',
        startedAt: new Date(Date.now() - 7 * 86_400_000 - 4_800_000),
        finishedAt: new Date(Date.now() - 7 * 86_400_000),
        durationSeconds: 4800,
        perceivedEffort: 7,
      })
      .onConflictDoUpdate({
        target: [workoutSessions.userId, workoutSessions.scheduledDate, workoutSessions.sessionKey],
        set: { prescription, status: 'COMPLETED', durationSeconds: 4800, perceivedEffort: 7 },
      })
      .returning({ id: workoutSessions.id });
    if (!previous) throw new Error('Falha ao criar treino anterior.');
    const loads = [
      ['agachamento-goblet', 10],
      ['supino-halteres', 8],
      ['prancha-frontal', null],
    ] as const;
    for (const [exerciseId, load] of loads) {
      for (let setNumber = 1; setNumber <= 3; setNumber += 1) {
        await db
          .insert(workoutSetEntries)
          .values({
            userId: owner.id,
            workoutSessionId: previous.id,
            exerciseId,
            setNumber,
            reps: exerciseId === 'prancha-frontal' ? null : 10,
            durationSeconds: exerciseId === 'prancha-frontal' ? 30 : null,
            loadValue: load?.toString(),
            loadUnit: load === null ? 'BODYWEIGHT' : 'KG',
            completed: true,
          })
          .onConflictDoNothing();
      }
    }

    const [current] = await db
      .insert(workoutSessions)
      .values({
        userId: owner.id,
        protocolId: protocol.id,
        protocolVersion: 1,
        weekNumber: 5,
        sessionKey: prescription.dayLabel,
        scheduledDate: date(0),
        prescription,
        status: 'PLANNED',
      })
      .onConflictDoUpdate({
        target: [workoutSessions.userId, workoutSessions.scheduledDate, workoutSessions.sessionKey],
        set: {
          prescription,
          status: 'PLANNED',
          startedAt: null,
          finishedAt: null,
          durationSeconds: null,
          perceivedEffort: null,
          feedbackCipher: null,
          painReported: false,
          painExerciseId: null,
        },
      })
      .returning({ id: workoutSessions.id });
    if (!current) throw new Error('Falha ao criar treino atual.');
    await db.delete(workoutSetEntries).where(eq(workoutSetEntries.workoutSessionId, current.id));
    await db.delete(handoffAlerts).where(eq(handoffAlerts.sourceId, current.id));
    await db
      .delete(handoffAlerts)
      .where(
        and(eq(handoffAlerts.userId, owner.id), eq(handoffAlerts.sourceType, 'WORKOUT_INSIGHT')),
      );
    await db.delete(workoutInsights).where(eq(workoutInsights.userId, owner.id));

    const token = randomBytes(32).toString('base64url');
    await db
      .update(workoutAccessTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(workoutAccessTokens.userId, owner.id), eq(workoutAccessTokens.kind, 'MAGIC')));
    await db.insert(workoutAccessTokens).values({
      userId: owner.id,
      workoutSessionId: current.id,
      kind: 'MAGIC',
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });
    process.stdout.write(
      `\n[db:seed:workout] Abra: http://localhost:3000/treino/acessar#token=${token}\n\n`,
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
