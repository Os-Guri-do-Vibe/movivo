/**
 * Integração — execução do treino e agenda adaptativa. Pré-requisito: `pnpm run infra:up`, com o
 * contêiner `movivo-api` parado.
 *
 * Prova com Postgres real: o aluno vê e executa o treino do dia em qualquer modalidade, a carga
 * sai de PSE × minutos, relato de dor aciona a sentinela, arquivo importado exige confirmação,
 * e a agenda reorganiza a semana SEM tocar no plano e SEM empilhar o que foi perdido.
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { AgentRunner } from '../src/core/agents/agent-runner';
import {
  accessLinkTokens,
  domainEvents,
  planSessions,
  safetyEvents,
  scheduledSessions,
  sessionExecutions,
  trainingPlans,
  users,
} from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { PlanGenerationService } from '../src/modules/planning/plan-generation.service';
import { buildFit } from '../src/modules/training/import/fit-fixture';
import { ExecutionService } from '../src/modules/training/execution.service';
import { ScheduleService } from '../src/modules/training/schedule.service';
import { createStudent, fakeRunner } from './plan-fixtures';

let app: INestApplication;
let db: TenantDatabase;
let executions: ExecutionService;
let schedule: ScheduleService;
const created: string[] = [];
/** Quarta-feira 04/11/2026, meio-dia em São Paulo. */
const NOW = new Date('2026-11-04T15:00:00.000Z');

async function studentWithPlan(): Promise<string> {
  const userId = await createStudent(db, created);
  const result = await app.get(PlanGenerationService).generate(userId, { now: NOW });
  expect(result.status).toBe('PUBLISHED');
  return userId;
}

const scheduledOf = (userId: string) =>
  db.runAsSystem((tx) =>
    tx
      .select()
      .from(scheduledSessions)
      .where(eq(scheduledSessions.userId, userId))
      .orderBy(scheduledSessions.scheduledOn),
  );

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AgentRunner)
    .useValue(fakeRunner)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  db = app.get(TenantDatabase);
  executions = app.get(ExecutionService);
  schedule = app.get(ScheduleService);
});

afterAll(async () => {
  if (db && created.length > 0) {
    await db.runAsSystem(async (tx) => {
      await tx.delete(domainEvents).where(inArray(domainEvents.userId, created));
      await tx.delete(accessLinkTokens).where(inArray(accessLinkTokens.userId, created));
      await tx.delete(users).where(inArray(users.id, created));
    });
  }
  await app?.close();
});

describe('execução do treino', () => {
  it('mostra a semana e o treino do dia, abre a execução uma única vez e fecha com a carga', async () => {
    const userId = await studentWithPlan();
    const [first] = await scheduledOf(userId);
    const day = await executions.day(userId, first?.scheduledOn, NOW);
    expect(day.hasPlan).toBe(true);
    expect(day.week).toHaveLength(7);
    const session = day.selected[0];
    expect(session?.content.modality).toBe('STRENGTH');
    expect(session?.execution).toBeNull();

    const started = await executions.start(userId, session?.scheduledSessionId ?? '', NOW);
    const again = await executions.start(userId, session?.scheduledSessionId ?? '', NOW);
    expect(again.id).toBe(started.id);
    expect(started.status).toBe('IN_PROGRESS');

    const sets = await executions.saveSets(userId, started.id, {
      sets: [
        {
          exerciseId: 'agachamento_barra',
          setNumber: 1,
          reps: 10,
          loadKg: 60,
          durationSeconds: null,
          rir: 2,
          completed: true,
        },
      ],
    });
    expect(sets.sets).toHaveLength(1);
    const edited = await executions.saveSets(userId, started.id, {
      sets: [
        {
          exerciseId: 'agachamento_barra',
          setNumber: 1,
          reps: 12,
          loadKg: 62.5,
          durationSeconds: null,
          rir: 1,
          completed: true,
        },
      ],
    });
    expect(edited.sets).toHaveLength(1);
    expect(edited.sets[0]).toMatchObject({ reps: 12, loadKg: 62.5 });

    const finished = await executions.finish(
      userId,
      started.id,
      { status: 'COMPLETED', rpe: 7, durationMinutes: 50, painReports: [], enjoyment: 4 },
      NOW,
    );
    expect(finished.status).toBe('COMPLETED');
    const [row] = await db.runAsSystem((tx) =>
      tx.select().from(sessionExecutions).where(eq(sessionExecutions.id, started.id)),
    );
    expect(row?.load).toBe(350);
    expect(row?.finishedAt).not.toBeNull();
    const [after] = await db.runAsSystem((tx) =>
      tx
        .select()
        .from(scheduledSessions)
        .where(eq(scheduledSessions.id, session?.scheduledSessionId ?? '')),
    );
    expect(after?.status).toBe('DONE');

    await expect(
      executions.finish(
        userId,
        started.id,
        { status: 'COMPLETED', rpe: 7, durationMinutes: 50, painReports: [], enjoyment: null },
        NOW,
      ),
    ).rejects.toThrow(/já foi concluído/);
  });

  it('o aluno não alcança a execução de outro aluno', async () => {
    const owner = await studentWithPlan();
    const stranger = await studentWithPlan();
    const [first] = await scheduledOf(owner);
    const started = await executions.start(owner, first?.id ?? '', NOW);
    await expect(
      executions.finish(
        stranger,
        started.id,
        { status: 'COMPLETED', rpe: 5, durationMinutes: 30, painReports: [], enjoyment: null },
        NOW,
      ),
    ).rejects.toThrow();
    await expect(executions.start(stranger, first?.id ?? '', NOW)).rejects.toThrow();
  });

  it('dor forte relatada na sessão aciona a sentinela e abre caso prioritário', async () => {
    const userId = await studentWithPlan();
    const [first] = await scheduledOf(userId);
    const started = await executions.start(userId, first?.id ?? '', NOW);
    await executions.finish(
      userId,
      started.id,
      {
        status: 'PARTIAL',
        rpe: 8,
        durationMinutes: 25,
        painReports: [{ region: 'ombro', intensity: 8, during: 'DURING' }],
        enjoyment: 2,
      },
      NOW,
    );
    const signals = await db.runAsSystem((tx) =>
      tx.select().from(safetyEvents).where(eq(safetyEvents.userId, userId)),
    );
    expect(signals.map((s) => s.kind)).toContain('SEVERE_PAIN');
    const [after] = await db.runAsSystem((tx) =>
      tx
        .select()
        .from(scheduledSessions)
        .where(eq(scheduledSessions.id, first?.id ?? '')),
    );
    expect(after?.status).toBe('PARTIAL');
  });

  it('arquivo .fit é lido, mas só conclui depois de o aluno confirmar os números', async () => {
    const userId = await studentWithPlan();
    const [first] = await scheduledOf(userId);
    const started = await executions.start(userId, first?.id ?? '', NOW);
    const imported = await executions.importFile(userId, started.id, 'corrida.fit', buildFit());
    expect(imported.source).toBe('FIT_FILE');
    expect(imported.metrics?.distanceMeters).toBe(5_000);
    expect(imported.metricsConfirmed).toBe(false);

    const closing = {
      status: 'COMPLETED' as const,
      rpe: 6,
      durationMinutes: null,
      painReports: [],
      enjoyment: null,
    };
    await expect(executions.finish(userId, started.id, closing, NOW)).rejects.toThrow(
      /Confirme os números/,
    );
    await executions.saveMetrics(userId, started.id, {
      metrics: imported.metrics ?? {},
      confirmed: true,
    });
    const done = await executions.finish(userId, started.id, closing, NOW);
    expect(done.status).toBe('COMPLETED');
    // Sem tempo informado, a duração vem do tempo em movimento do arquivo (1.690 s ≈ 28 min).
    expect(done.durationMinutes).toBe(28);
    await expect(
      executions.importFile(userId, started.id, 'x.txt', new Uint8Array([1])),
    ).rejects.toThrow();
  });

  it('registro avulso: data futura é recusada e data passada conta como registro tardio', async () => {
    const userId = await studentWithPlan();
    await expect(
      executions.logExternal(
        userId,
        {
          modality: 'EXTERNAL_SPORT',
          performedOn: '2026-11-10',
          rpe: 7,
          durationMinutes: 60,
          painReports: [],
        },
        NOW,
      ),
    ).rejects.toThrow(/futura/);
    const late = await executions.logExternal(
      userId,
      {
        modality: 'EXTERNAL_SPORT',
        performedOn: '2026-11-02',
        rpe: 7,
        durationMinutes: 60,
        painReports: [],
      },
      NOW,
    );
    const [row] = await db.runAsSystem((tx) =>
      tx.select().from(sessionExecutions).where(eq(sessionExecutions.id, late.id)),
    );
    expect(row).toMatchObject({ loggedLate: true, load: 420, status: 'COMPLETED' });
  });
});

describe('agenda adaptativa', () => {
  it('marca como perdida a sessão que passou e é idempotente', async () => {
    const userId = await studentWithPlan();
    const before = await scheduledOf(userId);
    const nextWeek = new Date('2026-11-20T15:00:00.000Z');
    const count = await schedule.markMissed(nextWeek);
    expect(count).toBeGreaterThanOrEqual(before.length);
    const after = await scheduledOf(userId);
    expect(after.every((s) => s.status === 'MISSED')).toBe(true);
    expect(await schedule.markMissed(nextWeek)).toBe(0);
    const events = await db.runAsSystem((tx) =>
      tx
        .select({ type: domainEvents.type })
        .from(domainEvents)
        .where(and(eq(domainEvents.userId, userId), eq(domainEvents.type, 'SessionMissed'))),
    );
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('reagendar mexe só na agenda: o plano não muda e o perdido não é empilhado', async () => {
    const userId = await studentWithPlan();
    const [firstPlan] = await db.runAsSystem((tx) =>
      tx.select().from(trainingPlans).where(eq(trainingPlans.userId, userId)),
    );
    const planBefore = JSON.stringify(firstPlan?.structure);
    const sessionsBefore = JSON.stringify(
      await db.runAsSystem((tx) =>
        tx
          .select()
          .from(planSessions)
          .where(eq(planSessions.userId, userId))
          .orderBy(planSessions.key),
      ),
    );

    // Semana seguinte, quarta: a segunda (perdida) não volta; o que resta é reorganizado.
    const wednesday = new Date('2026-11-11T15:00:00.000Z');
    await schedule.markMissed(wednesday);
    const missedBefore = (await scheduledOf(userId)).filter(
      (s) =>
        s.status === 'MISSED' && s.scheduledOn >= '2026-11-09' && s.scheduledOn <= '2026-11-10',
    );
    const action = await schedule.proposeWeek(userId, wednesday);
    // Todas as da semana de 09/11 já passaram ou estão em dias anteriores a quarta: nada futuro a mover.
    if (action) {
      await db.runAsSystem((tx) => schedule.applyReschedule(tx, userId, action, null));
    }
    const after = await scheduledOf(userId);
    const missedAfter = after.filter(
      (s) =>
        s.status === 'MISSED' && s.scheduledOn >= '2026-11-09' && s.scheduledOn <= '2026-11-10',
    );
    expect(missedAfter.map((s) => s.id).sort()).toEqual(missedBefore.map((s) => s.id).sort());
    // Nenhum dia tem mais de uma sessão ativa (nada empilhado).
    const active = after.filter((s) => s.status === 'PLANNED').map((s) => s.scheduledOn);
    expect(new Set(active).size).toBe(active.length);

    const [planAfter] = await db.runAsSystem((tx) =>
      tx.select().from(trainingPlans).where(eq(trainingPlans.userId, userId)),
    );
    expect(JSON.stringify(planAfter?.structure)).toBe(planBefore);
    expect(
      JSON.stringify(
        await db.runAsSystem((tx) =>
          tx
            .select()
            .from(planSessions)
            .where(eq(planSessions.userId, userId))
            .orderBy(planSessions.key),
        ),
      ),
    ).toBe(sessionsBefore);
  });

  it('semana apertada: o que não cabe sai da semana (SKIPPED) e o resto muda de dia', async () => {
    const userId = await studentWithPlan();
    const planned = (await scheduledOf(userId)).filter((s) => s.status === 'PLANNED');
    const target = planned.find((s) => s.scheduledOn >= '2026-11-04');
    expect(target).toBeDefined();
    const weekStart = target?.weekStart ?? '2026-11-02';
    const keys = await db.runAsSystem((tx) =>
      tx
        .select({ key: planSessions.key, id: planSessions.id })
        .from(planSessions)
        .where(eq(planSessions.userId, userId)),
    );
    const keyOf = (planSessionId: string) => keys.find((k) => k.id === planSessionId)?.key ?? '';
    const week = planned.filter((s) => s.weekStart === weekStart);
    const [keep, ...rest] = week;
    expect(keep).toBeDefined();
    const result = await db.runAsSystem((tx) =>
      schedule.applyReschedule(
        tx,
        userId,
        {
          type: 'RESCHEDULE_WEEK',
          weekStart,
          assignments: [
            {
              planSessionKey: keyOf(keep?.planSessionId ?? ''),
              date: '2026-11-07',
              slot: 'MORNING',
            },
          ],
          dropped: rest.map((s) => keyOf(s.planSessionId)),
        },
        null,
      ),
    );
    expect(result.moved).toBe(1);
    expect(result.dropped).toBe(rest.length);
    const after = await scheduledOf(userId);
    expect(after.find((s) => s.id === keep?.id)).toMatchObject({
      scheduledOn: '2026-11-07',
      slot: 'MORNING',
      changeSource: 'COACHING',
    });
    for (const s of rest) expect(after.find((a) => a.id === s.id)?.status).toBe('SKIPPED');
  });
});
