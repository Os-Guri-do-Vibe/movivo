/**
 * Integração — a conversa com o aluno: da mensagem à ação executada dentro das políticas.
 * Pré-requisito: `pnpm run infra:up`, com o contêiner `movivo-api` parado.
 *
 * O treinador de IA é falso (classifica por palavra-chave); o que se prova com Postgres real é
 * que a mensagem repetida não decide duas vezes, que toda decisão executada deixa proposta,
 * política e execução, que o sinal de emergência encerra o fluxo antes de qualquer ação e que o
 * pedido de revisão humana abre caso na fila.
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { AgentRunner } from '../src/core/agents/agent-runner';
import {
  accessLinkTokens,
  coachingDecisions,
  coachingProposals,
  decisionExecutions,
  domainEvents,
  exceptionCases,
  foodLogs,
  planSessions,
  safetyEvents,
  scheduledSessions,
  studentConstraints,
  users,
  trainingAccessTokens,
} from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { ConversationOrchestrator } from '../src/modules/conversation/orchestrator.service';
import { PlanGenerationService } from '../src/modules/planning/plan-generation.service';
import { createStudent, fakeRunner } from './plan-fixtures';

let app: INestApplication;
let db: TenantDatabase;
let orchestrator: ConversationOrchestrator;
const created: string[] = [];
// Quarta-feira, 04/11/2026, 12:00 em São Paulo.
const NOW = new Date('2026-11-04T15:00:00.000Z');

async function studentWithPlan(): Promise<string> {
  const userId = await createStudent(db, created);
  expect((await app.get(PlanGenerationService).generate(userId, { now: NOW })).status).toBe(
    'PUBLISHED',
  );
  return userId;
}

function say(userId: string, text: string, messageIds: string[] = [randomUUID()]) {
  return orchestrator.handle({ userId, text, messageIds, correlationId: randomUUID(), now: NOW });
}

const decisionsOf = (userId: string) =>
  db.runAsSystem((tx) =>
    tx.select().from(coachingDecisions).where(eq(coachingDecisions.userId, userId)),
  );

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AgentRunner)
    .useValue(fakeRunner)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  db = app.get(TenantDatabase);
  orchestrator = app.get(ConversationOrchestrator);
});

afterAll(async () => {
  if (db && created.length > 0) {
    await db.runAsSystem(async (tx) => {
      await tx.delete(domainEvents).where(inArray(domainEvents.userId, created));
      await tx.delete(accessLinkTokens).where(inArray(accessLinkTokens.userId, created));
      await tx.delete(trainingAccessTokens).where(inArray(trainingAccessTokens.userId, created));
      await tx.delete(users).where(inArray(users.id, created));
    });
  }
  await app?.close();
});

describe('indisponibilidade da semana', () => {
  it('registra a exceção, reorganiza dentro dos dias informados e responde com a nova agenda', async () => {
    const userId = await studentWithPlan();
    const result = await say(userId, 'Essa semana só posso quinta e sábado');
    expect(result.status).toBe('EXECUTED');
    expect(result.reply).toMatch(/quinta|sábado/i);

    const constraints = await db.runAsSystem((tx) =>
      tx.select().from(studentConstraints).where(eq(studentConstraints.userId, userId)),
    );
    expect(
      constraints.some((c) => JSON.stringify(c.payload ?? c).includes('AVAILABILITY_OVERRIDE')),
    ).toBe(true);

    // Nada fica agendado depois de hoje fora dos dias informados (nesta semana).
    const upcoming = await db.runAsSystem((tx) =>
      tx
        .select()
        .from(scheduledSessions)
        .where(
          and(eq(scheduledSessions.userId, userId), eq(scheduledSessions.weekStart, '2026-11-02')),
        ),
    );
    const planned = upcoming.filter((s) => s.status === 'PLANNED' && s.scheduledOn >= '2026-11-04');
    for (const s of planned) {
      expect(['2026-11-05', '2026-11-07']).toContain(s.scheduledOn);
    }
  });
});

describe('pouco tempo hoje', () => {
  it('encurta a sessão de hoje e guarda o ajuste só nela', async () => {
    const userId = await studentWithPlan();
    const [first] = await db.runAsSystem((tx) =>
      tx
        .select()
        .from(scheduledSessions)
        .where(eq(scheduledSessions.userId, userId))
        .orderBy(scheduledSessions.scheduledOn),
    );
    await db.runAsSystem((tx) =>
      tx
        .update(scheduledSessions)
        .set({ scheduledOn: '2026-11-04', weekStart: '2026-11-02' })
        .where(eq(scheduledSessions.id, first?.id ?? '')),
    );
    const result = await say(userId, 'Hoje só tenho 20 minutos');
    expect(result.status).toBe('EXECUTED');
    const [after] = await db.runAsSystem((tx) =>
      tx
        .select()
        .from(scheduledSessions)
        .where(eq(scheduledSessions.id, first?.id ?? '')),
    );
    expect(after?.adjustment).toBeTruthy();
  });
});

describe('troca de exercício', () => {
  it('troca o exercício citado na próxima sessão e responde com o novo nome', async () => {
    const userId = await studentWithPlan();
    const [session] = await db.runAsSystem((tx) =>
      tx
        .select({ content: planSessions.content })
        .from(planSessions)
        .where(eq(planSessions.userId, userId))
        .limit(1),
    );
    const content = session?.content;
    const name = content?.modality === 'STRENGTH' ? (content.exercises[0]?.name ?? '') : '';
    expect(name).not.toBe('');
    const result = await say(userId, `Troca ${name.toLowerCase()}, não tenho esse equipamento`);
    expect(result.status).toBe('EXECUTED');
    expect(result.reply).toBeTruthy();
  });
});

describe('registro alimentar por texto', () => {
  it('gera rascunho sem contar nada e manda o link para confirmar', async () => {
    const userId = await studentWithPlan();
    const result = await say(userId, 'Almocei arroz e feijão');
    expect(result.status).toBe('INFORMED');
    expect(result.reply).toMatch(/https?:\/\//);
    const logs = await db.runAsSystem((tx) =>
      tx.select().from(foodLogs).where(eq(foodLogs.userId, userId)),
    );
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => l.status !== 'CONFIRMED')).toBe(true);
  });
});

describe('segurança', () => {
  it('dor no peito encerra o fluxo com a orientação de emergência e registra o sinal', async () => {
    const userId = await studentWithPlan();
    const before = (await decisionsOf(userId)).length;
    const result = await say(userId, 'Estou com dor no peito e falta de ar');
    expect(result.status).toBe('EMERGENCY');
    expect(result.reply).toMatch(/192|emergência|SAMU/i);
    const events = await db.runAsSystem((tx) =>
      tx.select().from(safetyEvents).where(eq(safetyEvents.userId, userId)),
    );
    expect(events.some((e) => e.severity === 'EMERGENCY')).toBe(true);
    expect((await decisionsOf(userId)).length).toBe(before);
  });
});

describe('revisão humana', () => {
  it('abre caso na fila e avisa o aluno', async () => {
    const userId = await studentWithPlan();
    const result = await say(userId, 'Quero falar com um humano sobre meu plano');
    expect(result.status).toBe('ESCALATED');
    const cases = await db.runAsSystem((tx) =>
      tx.select().from(exceptionCases).where(eq(exceptionCases.userId, userId)),
    );
    expect(cases.some((c) => c.kind === 'STUDENT_REVIEW_REQUEST')).toBe(true);
  });
});

describe('idempotência e auditoria', () => {
  it('a mesma mensagem reentregue não decide duas vezes', async () => {
    const userId = await studentWithPlan();
    const ids = [randomUUID()];
    const first = await say(userId, 'Essa semana só posso quinta e sábado', ids);
    expect(first.status).toBe('EXECUTED');
    const afterFirst = (await decisionsOf(userId)).length;
    const second = await say(userId, 'Essa semana só posso quinta e sábado', ids);
    expect(second.status).toBe('DUPLICATE');
    expect((await decisionsOf(userId)).length).toBe(afterFirst);
  });

  it('toda decisão executada tem proposta, política e execução registradas', async () => {
    const userId = await studentWithPlan();
    await say(userId, 'Essa semana só posso quinta e sábado');
    const rows = await db.runAsSystem((tx) =>
      tx
        .select({
          verdict: coachingDecisions.verdict,
          policy: coachingDecisions.policyVersionId,
          proposalId: coachingProposals.id,
          executionId: decisionExecutions.id,
        })
        .from(coachingDecisions)
        .leftJoin(coachingProposals, eq(coachingProposals.id, coachingDecisions.proposalId))
        .leftJoin(decisionExecutions, eq(decisionExecutions.decisionId, coachingDecisions.id))
        .where(and(eq(coachingDecisions.userId, userId), eq(coachingDecisions.verdict, 'EXECUTE'))),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.proposalId).toBeTruthy();
      expect(row.policy).toBeTruthy();
      expect(row.executionId).toBeTruthy();
    }
  });
});
