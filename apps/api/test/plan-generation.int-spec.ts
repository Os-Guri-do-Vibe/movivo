/**
 * Integração — geração e publicação do plano. Pré-requisito: `pnpm run infra:up`, com o
 * contêiner `movivo-api` parado (os workers dele disputariam os jobs).
 *
 * O AgentRunner é substituído por um treinador falso que devolve saídas válidas por construção:
 * o que se prova aqui é a ORQUESTRAÇÃO com Postgres real — decisão do motor de políticas,
 * publicação transacional, agenda da primeira semana, eventos, link do aluno e os caminhos de
 * exceção (emergência, PAR-Q, política que exige humano, idempotência).
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { AgentRunner } from '../src/core/agents/agent-runner';
import { AccessLinkService } from '../src/core/database/access-link.service';
import {
  accessLinkTokens,
  coachingDecisions,
  coachingProposals,
  decisionExecutions,
  domainEvents,
  exceptionCases,
  goalMilestones,
  nutritionPlans,
  planSessions,
  scheduledSessions,
  studentGoals,
  trainingPlans,
  users,
} from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { PublishedPolicies } from '../src/modules/coaching/policy/published-policies';
import { PlanGenerationService } from '../src/modules/planning/plan-generation.service';
import { PlanViewService } from '../src/modules/planning/plan-view.service';
import { createStudent, fakeRunner } from './plan-fixtures';
import { releaseOptionalProtocols } from './plan-publication';

let app: INestApplication;
let db: TenantDatabase;
let service: PlanGenerationService;
const created: string[] = [];
const TODAY = new Date('2026-11-04T15:00:00.000Z'); // quarta-feira

/** Casos de protocolo do aluno, na ordem em que entraram na fila. */
async function protocolCases(userId: string) {
  return db.runAsSystem((tx) =>
    tx
      .select()
      .from(exceptionCases)
      .where(and(eq(exceptionCases.userId, userId), eq(exceptionCases.kind, 'PROTOCOL_REVIEW'))),
  );
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
  it('o protocolo entra na fila como revisão opcional e é liberado ao fim da janela', async () => {
    const userId = await createStudent(db, created);
    const result = await service.generate(userId, { now: TODAY });
    expect(result.status).toBe('PENDING_REVIEW');

    // Nada vai ao aluno antes: dois rascunhos, um caso opcional por protocolo, com prazo de 2h.
    const queued = await protocolCases(userId);
    expect(queued.map((c) => c.domain).sort()).toEqual(['NUTRITION', 'TRAINING']);
    for (const row of queued) {
      expect(row).toMatchObject({ reviewUrgency: 'OPTIONAL', status: 'OPEN' });
      const window = (row.autoReleaseAt?.getTime() ?? 0) - row.createdAt.getTime();
      expect(window).toBeGreaterThan(2 * 60 * 60 * 1000 - 60_000);
      expect(window).toBeLessThan(2 * 60 * 60 * 1000 + 60_000);
    }
    const [draft] = await db.runAsSystem((tx) =>
      tx.select().from(trainingPlans).where(eq(trainingPlans.userId, userId)),
    );
    expect(draft?.status).toBe('DRAFT');

    await releaseOptionalProtocols(app, userId, TODAY);
    const released = await protocolCases(userId);
    expect(released.every((c) => c.status === 'RESOLVED')).toBe(true);
    expect(released.every((c) => c.resolution?.outcome === 'AUTO_RELEASED')).toBe(true);

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
    // Estratégia executada pelo motor; cada protocolo foi PERGUNTADO ao entrar na fila e depois
    // liberado automaticamente quando a janela venceu.
    expect(decisions.map((d) => `${d.decidedBy}:${d.verdict}`).sort()).toEqual([
      'AUTO_RELEASE:EXECUTE',
      'AUTO_RELEASE:EXECUTE',
      'POLICY_ENGINE:ASK',
      'POLICY_ENGINE:ASK',
      'POLICY_ENGINE:EXECUTE',
    ]);
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
    const userId = await createStudent(db, created);
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
    expect(await links.verify(issued.token, 'CHECKOUT')).toBeNull();
  });

  it('é idempotente: um segundo disparo para o mesmo objetivo não duplica o plano', async () => {
    const userId = await createStudent(db, created);
    await service.generate(userId, { now: TODAY });
    const again = await service.generate(userId, { now: TODAY });
    expect(again).toEqual({ status: 'SKIPPED', reason: 'ALREADY_PLANNED' });
    const plans = await db.runAsSystem((tx) =>
      tx.select().from(trainingPlans).where(eq(trainingPlans.userId, userId)),
    );
    expect(plans).toHaveLength(1);
  });

  it('PAR-Q de risco: a IA monta o protocolo completo e a revisão do profissional é obrigatória', async () => {
    const userId = await createStudent(db, created, { signal: true });
    const spy = vi.spyOn(fakeRunner, 'run');
    const result = await service.generate(userId, { now: TODAY });
    expect(result.status).toBe('PENDING_REVIEW');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();

    // Treino e alimentação foram gerados por inteiro, mas ficam em rascunho até a liberação.
    const [training] = await db.runAsSystem((tx) =>
      tx.select().from(trainingPlans).where(eq(trainingPlans.userId, userId)),
    );
    expect(training?.status).toBe('DRAFT');
    const [nutrition] = await db.runAsSystem((tx) =>
      tx.select().from(nutritionPlans).where(eq(nutritionPlans.userId, userId)),
    );
    expect(nutrition?.status).toBe('DRAFT');

    const queued = await protocolCases(userId);
    expect(queued.map((c) => c.domain).sort()).toEqual(['NUTRITION', 'TRAINING']);
    for (const row of queued) {
      // Obrigatória: sem prazo de liberação automática.
      expect(row).toMatchObject({ reviewUrgency: 'MANDATORY', autoReleaseAt: null });
    }

    // A janela não libera a revisão obrigatória.
    await releaseOptionalProtocols(app, userId, TODAY);
    const after = await protocolCases(userId);
    expect(after.every((c) => c.status !== 'RESOLVED')).toBe(true);
    const [stillDraft] = await db.runAsSystem((tx) =>
      tx.select().from(trainingPlans).where(eq(trainingPlans.userId, userId)),
    );
    expect(stillDraft?.status).toBe('DRAFT');
  });

  it('emergência ativa suspende a geração: nenhum plano, nenhuma chamada de modelo', async () => {
    const userId = await createStudent(db, created);
    await db.runAsSystem((tx) =>
      tx.insert(safetyEvents).values({
        userId,
        kind: 'CHEST_PAIN',
        severity: 'EMERGENCY',
        scope: 'ALL',
        detectedBy: 'RULE',
        evidence: 'Dor no peito relatada',
      }),
    );
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

  it('dor ou lesão não suspende a geração: o protocolo segue como revisão opcional', async () => {
    const userId = await createStudent(db, created);
    await db.runAsSystem((tx) =>
      tx.insert(safetyEvents).values({
        userId,
        kind: 'NEW_INJURY',
        severity: 'URGENT',
        scope: 'TRAINING',
        detectedBy: 'RULE',
        evidence: 'Lesão no ombro relatada',
      }),
    );
    const result = await service.generate(userId, { now: TODAY });
    expect(result.status).toBe('PENDING_REVIEW');
    const queued = await protocolCases(userId);
    expect(queued.every((c) => c.reviewUrgency === 'OPTIONAL')).toBe(true);
  });

  it('política que exige humano deixa o plano em rascunho e abre um caso para a equipe', async () => {
    const userId = await createStudent(db, created);
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
    // O treino foi encaminhado pela política (obrigatório); a alimentação, mesmo com `AUTO`,
    // também passa pela fila, como revisão opcional.
    const cases = await protocolCases(userId);
    expect(cases).toHaveLength(2);
    expect(cases.find((c) => c.domain === 'TRAINING')?.reviewUrgency).toBe('MANDATORY');
    expect(cases.find((c) => c.domain === 'NUTRITION')?.reviewUrgency).toBe('OPTIONAL');
  });

  it('falta de metodologia publicada abre caso de falha em vez de gerar às cegas', async () => {
    const userId = await createStudent(db, created);
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
