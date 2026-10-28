/**
 * Integração — o dia do aluno além do treino: print do relógio e registro alimentar.
 * Pré-requisito: `pnpm run infra:up`, com o contêiner `movivo-api` parado.
 *
 * O treinador de IA é falso (saídas conhecidas): o que se prova com Postgres real é que NADA
 * conta antes da confirmação do aluno, que os totais saem da base de alimentos e que cada
 * aluno só enxerga o que é dele.
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
  foodLogs,
  scheduledSessions,
  users,
} from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { FoodLogService } from '../src/modules/nutrition/food-log.service';
import { PlanGenerationService } from '../src/modules/planning/plan-generation.service';
import { ExecutionService } from '../src/modules/training/execution.service';
import { createStudent, fakeRunner, NOT_A_WORKOUT_IMAGE } from './plan-fixtures';

let app: INestApplication;
let db: TenantDatabase;
let executions: ExecutionService;
let foods: FoodLogService;
const created: string[] = [];
const NOW = new Date('2026-11-04T15:00:00.000Z');

async function studentWithPlan(): Promise<string> {
  const userId = await createStudent(db, created);
  expect((await app.get(PlanGenerationService).generate(userId, { now: NOW })).status).toBe(
    'PUBLISHED',
  );
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
  executions = app.get(ExecutionService);
  foods = app.get(FoodLogService);
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

describe('print do relógio', () => {
  it('propõe as métricas sem confirmar e só conclui depois da confirmação', async () => {
    const userId = await studentWithPlan();
    const [first] = await db.runAsSystem((tx) =>
      tx
        .select()
        .from(scheduledSessions)
        .where(eq(scheduledSessions.userId, userId))
        .orderBy(scheduledSessions.scheduledOn),
    );
    const started = await executions.start(userId, first?.id ?? '', NOW);
    const { view, confidence } = await executions.importScreenshot(userId, started.id, {
      mediaType: 'image/png',
      base64: 'aW1hZ2VtLWRlLXRyZWlubw==',
    });
    expect(confidence).toBe('HIGH');
    expect(view.source).toBe('WHATSAPP_SCREENSHOT');
    expect(view.metrics?.distanceMeters).toBe(5_020);
    expect(view.metricsConfirmed).toBe(false);

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
      metrics: view.metrics ?? {},
      confirmed: true,
    });
    const done = await executions.finish(userId, started.id, closing, NOW);
    expect(done.durationMinutes).toBe(28);
  });

  it('imagem que não é treino é recusada e nada é gravado', async () => {
    const userId = await studentWithPlan();
    const [first] = await db.runAsSystem((tx) =>
      tx.select().from(scheduledSessions).where(eq(scheduledSessions.userId, userId)),
    );
    const started = await executions.start(userId, first?.id ?? '', NOW);
    await expect(
      executions.importScreenshot(userId, started.id, {
        mediaType: 'image/png',
        base64: NOT_A_WORKOUT_IMAGE,
      }),
    ).rejects.toThrow(/Não encontramos os números/);
    const view = await executions.start(userId, first?.id ?? '', NOW);
    expect(view.metrics).toBeNull();
  });
});

describe('registro alimentar', () => {
  it('texto vira rascunho; nada conta até confirmar; totais saem da base', async () => {
    const userId = await studentWithPlan();
    const draft = await foods.draftFromText(
      userId,
      { text: 'almocei arroz, feijão e frango' },
      NOW,
    );
    expect(draft.meal).toBe('LUNCH');
    expect(draft.items.map((i) => i.matchedName)).toEqual([
      'Arroz branco cozido',
      'Feijão carioca cozido',
      'Peito de frango grelhado sem pele',
    ]);
    // 150 g de arroz, 90 g de feijão, 120 g de frango: proteína = 0,15·2,5 + 0,9·4,8 + 1,2·32 (valores por 100 g da base).
    expect(draft.totals.proteinG).toBeGreaterThan(40);
    expect(draft.totals.unmatchedItems).toBe(0);

    let day = await foods.day(userId, undefined, NOW);
    expect(day.logs).toHaveLength(1);
    expect(day.logs[0]?.confirmed).toBe(false);
    expect(day.totals.energyKcal).toBe(0);
    expect(day.hasPlan).toBe(true);
    expect(day.targets).not.toBeNull();

    await foods.confirm(userId, draft.logId, {
      meal: 'LUNCH',
      items: draft.items.map(({ matchedName: _m, ...item }) => item),
      hunger: 3,
    });
    day = await foods.day(userId, undefined, NOW);
    expect(day.logs[0]?.confirmed).toBe(true);
    expect(day.totals.energyKcal).toBeGreaterThan(300);
    expect(day.totals.proteinG).toBeGreaterThan(40);
    const events = await db.runAsSystem((tx) =>
      tx
        .select({ type: domainEvents.type })
        .from(domainEvents)
        .where(and(eq(domainEvents.userId, userId), eq(domainEvents.type, 'FoodLogged'))),
    );
    expect(events).toHaveLength(1);
  });

  it('item sem correspondência na base é contado como não casado, nunca inventado', async () => {
    const userId = await studentWithPlan();
    const draft = await foods.draftFromText(userId, { text: 'comi arroz e unicórnio' }, NOW);
    const unicorn = draft.items.find((i) => i.label.includes('unicórnio'));
    expect(unicorn?.foodItemId).toBeNull();
    expect(draft.totals.unmatchedItems).toBe(1);
  });

  it('a correção do aluno vale: o servidor recalcula os totais com as gramas confirmadas', async () => {
    const userId = await studentWithPlan();
    const draft = await foods.draftFromText(userId, { text: 'arroz' }, NOW);
    const rice = draft.items[0];
    await foods.confirm(userId, draft.logId, {
      meal: 'DINNER',
      items: [
        {
          foodItemId: rice?.foodItemId ?? null,
          label: 'arroz',
          grams: 300,
          portionSource: 'DECLARED',
        },
      ],
    });
    const [row] = await db.runAsSystem((tx) =>
      tx.select().from(foodLogs).where(eq(foodLogs.id, draft.logId)),
    );
    expect(row?.meal).toBe('DINNER');
    expect(row?.totals.energyKcal).toBeGreaterThan(draft.totals.energyKcal * 1.9);
  });

  it('foto vira rascunho estimado e mesmo o dono não confirma o rascunho de outro aluno', async () => {
    const owner = await studentWithPlan();
    const stranger = await studentWithPlan();
    const draft = await foods.draftFromPhoto(
      owner,
      { mediaType: 'image/jpeg', base64: 'Zm90by1kZS1jb21pZGE=' },
      {},
      NOW,
    );
    expect(draft.items[0]).toMatchObject({
      matchedName: 'Salmão grelhado',
      portionSource: 'ESTIMATED',
      grams: 130,
    });
    await expect(
      foods.confirm(stranger, draft.logId, {
        meal: 'DINNER',
        items: [{ foodItemId: null, label: 'x', grams: 10, portionSource: 'DECLARED' }],
      }),
    ).rejects.toThrow();
    await expect(foods.remove(stranger, draft.logId)).rejects.toThrow();
    await foods.remove(owner, draft.logId);
  });

  it('registro manual em data futura é recusado', async () => {
    const userId = await studentWithPlan();
    await expect(
      foods.addManual(
        userId,
        {
          meal: 'LUNCH',
          items: [{ foodItemId: null, label: 'x', grams: 10, portionSource: 'DECLARED' }],
          loggedOn: '2026-12-01',
        },
        NOW,
      ),
    ).rejects.toThrow(/futura/);
  });
});
