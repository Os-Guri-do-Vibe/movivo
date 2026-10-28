/**
 * Integração — fila de exceções por domínio profissional (CREF, CRN, CRM).
 * Pré-requisito: `pnpm run infra:up`, com o contêiner `movivo-api` parado.
 *
 * Prova com Postgres real: cada conselho só vê e resolve o seu domínio, aprovar executa a
 * mudança e deixa decisão `STAFF` na trilha, sinal clínico só o médico encerra, ADMIN lê mas
 * não decide o que é clínico e registro inativo não decide nada.
 */
import 'reflect-metadata';

import { ForbiddenException, NotFoundException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { AgentRunner } from '../src/core/agents/agent-runner';
import {
  accessLinkTokens,
  coachingDecisions,
  coachingProposals,
  conversations,
  domainEvents,
  exceptionCases,
  nutritionPlans,
  safetyEvents,
  staff,
  users,
  trainingAccessTokens,
} from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import type { AuthenticatedUser } from '../src/modules/auth/jwt.strategy';
import { DecisionExecutor } from '../src/modules/coaching/decision/decision-executor.service';
import { SafetyService } from '../src/modules/coaching/safety/safety.service';
import { ExceptionsService } from '../src/modules/exceptions/exceptions.service';
import { QueueManager } from '../src/modules/jobs/queue-manager.service';
import { PlanGenerationService } from '../src/modules/planning/plan-generation.service';
import { createStudent, fakeRunner } from './plan-fixtures';
import { vi } from 'vitest';

let app: INestApplication;
let db: TenantDatabase;
let exceptions: ExceptionsService;
const created: string[] = [];
const NOW = new Date('2026-11-04T15:00:00.000Z');

type Who = 'CREF' | 'CRN' | 'CRM' | 'INATIVO' | 'ADMIN';
const actors = {} as Record<Who, AuthenticatedUser>;

async function staffMember(who: Who): Promise<AuthenticatedUser> {
  const email = `exceptions-${who.toLowerCase()}@example.invalid`;
  const role = who === 'ADMIN' ? 'ADMIN' : 'PROFESSIONAL';
  const council = who === 'CRN' || who === 'INATIVO' ? 'CRN' : who === 'CRM' ? 'CRM' : 'CREF';
  const id = await db.runAsSystem(async (tx) => {
    const [existing] = await tx.select({ id: staff.id }).from(staff).where(eq(staff.email, email));
    if (existing) {
      await tx
        .update(staff)
        .set({ council, councilActive: who !== 'INATIVO' })
        .where(eq(staff.id, existing.id));
      return existing.id;
    }
    const [row] = await tx
      .insert(staff)
      .values({
        email,
        phoneNumber: `+5511${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        name: `Teste ${who}`,
        passwordHash: 'x'.repeat(40),
        role,
        council,
        councilNumber: '000000',
        councilRegion: 'ZZ',
        councilActive: who !== 'INATIVO',
      })
      .returning({ id: staff.id });
    if (!row) throw new Error('falha ao criar profissional de teste');
    return row.id;
  });
  return { userId: id, role, jti: `jti-${who}` };
}

async function studentWithPlan(): Promise<string> {
  const userId = await createStudent(db, created);
  expect((await app.get(PlanGenerationService).generate(userId, { now: NOW })).status).toBe(
    'PUBLISHED',
  );
  return userId;
}

/** Proposta de energia acima do limite da política: o motor escala e abre caso de nutrição. */
async function nutritionCase(userId: string) {
  const outcome = await app.get(DecisionExecutor).decideAndRun(
    userId,
    'test.escalated',
    {
      action: { type: 'ADJUST_ENERGY_TARGET', deltaKcal: 400 },
      rationale: ['Ajuste maior que o limite automático.'],
      evidence: [],
      assumptions: ['Hipótese de teste.'],
      uncertainty: 'MEDIUM',
      expectedOutcome: 'Peso volta a se mover.',
    },
    async () => {
      throw new Error('não deveria executar sozinho');
    },
  );
  expect(outcome.verdict).not.toBe('EXECUTE');
  if (!outcome.exceptionCaseId) throw new Error('caso não aberto');
  return outcome.exceptionCaseId;
}

const caseRow = (id: string) =>
  db.runAsSystem(
    async (tx) => (await tx.select().from(exceptionCases).where(eq(exceptionCases.id, id)))[0],
  );

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AgentRunner)
    .useValue(fakeRunner)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  vi.spyOn(app.get(QueueManager), 'enqueue').mockResolvedValue('job' as never);
  db = app.get(TenantDatabase);
  exceptions = app.get(ExceptionsService);
  for (const who of ['CREF', 'CRN', 'CRM', 'INATIVO', 'ADMIN'] as const) {
    actors[who] = await staffMember(who);
  }
});

afterAll(async () => {
  // Os profissionais de teste não ficam ativos depois da suíte (a atribuição escolhe entre os ativos).
  if (db) {
    await db.runAsSystem((tx) =>
      tx
        .update(staff)
        .set({ councilActive: false })
        .where(
          inArray(
            staff.id,
            Object.values(actors).map((a) => a.userId),
          ),
        ),
    );
  }
  if (db && created.length > 0) {
    await db.runAsSystem(async (tx) => {
      await tx.delete(conversations).where(inArray(conversations.userId, created));
      await tx.delete(domainEvents).where(inArray(domainEvents.userId, created));
      await tx.delete(accessLinkTokens).where(inArray(accessLinkTokens.userId, created));
      await tx.delete(trainingAccessTokens).where(inArray(trainingAccessTokens.userId, created));
      await tx.delete(users).where(inArray(users.id, created));
    });
  }
  await app?.close();
});

describe('domínio por conselho', () => {
  it('a nutricionista vê e aprova o caso de nutrição; o profissional de Educação Física nem o enxerga', async () => {
    const userId = await studentWithPlan();
    const id = await nutritionCase(userId);

    expect((await exceptions.list(actors.CRN, {})).some((c) => c.id === id)).toBe(true);
    expect((await exceptions.list(actors.CREF, {})).some((c) => c.id === id)).toBe(false);
    expect((await exceptions.list(actors.CRM, {})).some((c) => c.id === id)).toBe(false);
    await expect(exceptions.detail(actors.CREF, id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(exceptions.approve(actors.CREF, id, undefined)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const before = await db.runAsSystem((tx) =>
      tx.select().from(nutritionPlans).where(eq(nutritionPlans.userId, userId)),
    );
    const detail = await exceptions.detail(actors.CRN, id);
    expect(detail.proposal?.status).toBe('PENDING');
    expect(detail.case.canResolve).toBe(true);

    await exceptions.approve(actors.CRN, id, 'Faz sentido para este aluno.');
    const after = await db.runAsSystem((tx) =>
      tx.select().from(nutritionPlans).where(eq(nutritionPlans.userId, userId)),
    );
    expect(after.length).toBe(before.length + 1);
    expect((await caseRow(id))?.status).toBe('RESOLVED');

    // Decisão do profissional na trilha: proposta aceita, decisão STAFF com quem decidiu.
    const [proposal] = await db.runAsSystem((tx) =>
      tx
        .select()
        .from(coachingProposals)
        .where(eq(coachingProposals.id, detail.proposal?.id ?? '')),
    );
    expect(proposal?.status).toBe('ACCEPTED');
    const decisions = await db.runAsSystem((tx) =>
      tx
        .select()
        .from(coachingDecisions)
        .where(
          and(
            eq(coachingDecisions.proposalId, proposal?.id ?? ''),
            eq(coachingDecisions.decidedBy, 'STAFF'),
          ),
        ),
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.staffId).toBe(actors.CRN.userId);

    await expect(exceptions.approve(actors.CRN, id, undefined)).rejects.toThrow(/já resolvido/i);
  });

  it('recusar não muda nada no plano e registra o motivo', async () => {
    const userId = await studentWithPlan();
    const id = await nutritionCase(userId);
    const before = await db.runAsSystem((tx) =>
      tx.select().from(nutritionPlans).where(eq(nutritionPlans.userId, userId)),
    );
    await exceptions.reject(actors.CRN, id, 'Meta já está adequada.');
    const after = await db.runAsSystem((tx) =>
      tx.select().from(nutritionPlans).where(eq(nutritionPlans.userId, userId)),
    );
    expect(after.length).toBe(before.length);
    expect((await caseRow(id))?.resolution).toMatchObject({ outcome: 'REJECTED' });
  });

  it('ADMIN lê tudo, mas não decide o que é clínico ou de outro domínio', async () => {
    const userId = await studentWithPlan();
    const id = await nutritionCase(userId);
    expect((await exceptions.list(actors.ADMIN, {})).some((c) => c.id === id)).toBe(true);
    await expect(exceptions.approve(actors.ADMIN, id, undefined)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('registro no conselho inativo não decide nada', async () => {
    const userId = await studentWithPlan();
    const id = await nutritionCase(userId);
    await expect(exceptions.claim(actors.INATIVO, id)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('sinais de segurança', () => {
  it('dor no peito vai para o médico; só ele encerra o sinal', async () => {
    const userId = await studentWithPlan();
    await app
      .get(SafetyService)
      .raise(
        userId,
        [{ kind: 'CHEST_PAIN', severity: 'EMERGENCY', scope: 'ALL', evidence: 'aperto no peito' }],
        'RULE',
      );
    const [event] = await db.runAsSystem((tx) =>
      tx.select().from(safetyEvents).where(eq(safetyEvents.userId, userId)),
    );
    const [row] = await db.runAsSystem((tx) =>
      tx.select().from(exceptionCases).where(eq(exceptionCases.userId, userId)),
    );
    expect(row?.domain).toBe('MEDICAL');
    expect((await exceptions.list(actors.CREF, {})).some((c) => c.id === row?.id)).toBe(false);
    expect((await exceptions.list(actors.CRM, {})).some((c) => c.id === row?.id)).toBe(true);

    await exceptions.resolve(
      actors.CRM,
      row?.id ?? '',
      'Orientado a procurar atendimento; liberado após avaliação.',
    );
    const [resolved] = await db.runAsSystem((tx) =>
      tx
        .select()
        .from(safetyEvents)
        .where(eq(safetyEvents.id, event?.id ?? '')),
    );
    expect(resolved).toMatchObject({ status: 'RESOLVED', resolvedBy: actors.CRM.userId });
  });

  it('dor forte em treino é do profissional de Educação Física, não do médico', async () => {
    const userId = await studentWithPlan();
    await app.get(SafetyService).raise(
      userId,
      [
        {
          kind: 'SEVERE_PAIN',
          severity: 'URGENT',
          scope: 'TRAINING',
          evidence: 'dor forte no joelho',
        },
      ],
      'RULE',
    );
    const [row] = await db.runAsSystem((tx) =>
      tx.select().from(exceptionCases).where(eq(exceptionCases.userId, userId)),
    );
    expect(row?.domain).toBe('TRAINING');
    expect((await exceptions.list(actors.CRM, {})).some((c) => c.id === row?.id)).toBe(false);
    await expect(exceptions.resolve(actors.CRN, row?.id ?? '', 'tentando')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await exceptions.resolve(
      actors.CREF,
      row?.id ?? '',
      'Treino adaptado sem a região; reavaliar em 7 dias.',
    );
    expect((await caseRow(row?.id ?? ''))?.status).toBe('RESOLVED');
  });
});
