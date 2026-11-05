/**
 * Integração — estúdio de metodologia e sentinela de segurança. Pré-requisito: `pnpm run infra:up`.
 *
 * Prova com Postgres real o ciclo rascunho → teste → publicação: limites duros recusados,
 * justificativa obrigatória fora da faixa plausível, publicação recusada sem teste aprovado,
 * substituição da versão anterior, renderização para os agentes e o evento publicado. Também
 * prova a sentinela: sinal urgente abre caso na fila e o mesmo sinal ativo não duplica.
 *
 * A avaliação é substituída por um dublê (o custo e o resultado de modelo real não cabem num
 * teste de integração); a lógica de avaliação tem testes próprios.
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { exampleParameters, methodologyDomainSpec } from '@movivo/shared';

import { AppModule } from '../src/app.module';
import { defineAgentTask } from '../src/core/agents/agent-task';
import { AgentTaskRegistry } from '../src/core/agents/agent-task-registry';
import {
  domainEvents,
  exceptionCases,
  methodologyDocuments,
  safetyEvents,
  staff,
  users,
} from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { SafetyService } from '../src/modules/coaching/safety/safety.service';
import { signalOf } from '../src/modules/coaching/safety/sentinel-rules';
import { EvaluationService } from '../src/modules/evaluation/evaluation.service';
import { MethodologyService } from '../src/modules/methodology/methodology.service';
import { PublishedMethodologyReader } from '../src/modules/methodology/published-methodology.reader';

let app: INestApplication;
let db: TenantDatabase;
let studio: MethodologyService;
let staffId: string;
let userId: string;
let evaluationPasses = true;
const evaluated: string[] = [];

/** Domínio pouco usado nos demais testes, para não colidir com a semente de desenvolvimento. */
const DOMAIN = 'RECOVERY';

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EvaluationService)
    .useValue({
      evaluate: async (taskId: string) => {
        evaluated.push(taskId);
        return {
          evalRunId: '00000000-0000-4000-8000-0000000000aa',
          taskId,
          passed: evaluationPasses,
          casesTotal: 1,
          casesPassed: evaluationPasses ? 1 : 0,
          costBrl: 0,
          results: [],
        };
      },
    })
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  db = app.get(TenantDatabase);
  studio = app.get(MethodologyService);
  app.get(AgentTaskRegistry).register(
    defineAgentTask({
      id: 'teste.recuperacao',
      role: 'r',
      instructions: 'i',
      tier: 'FAST',
      methodology: [DOMAIN],
      state: [],
      input: z.object({}),
      output: z.object({}),
      validators: [],
      maxCorrectionRounds: 0,
    }),
    [],
  );
  [staffId, userId] = await db.runAsSystem(async (tx) => {
    await tx.delete(methodologyDocuments).where(eq(methodologyDocuments.domain, DOMAIN));
    const [member] = await tx
      .insert(staff)
      .values({
        name: 'Profissional de teste',
        email: `estudio-${Date.now()}@example.invalid`,
        phoneNumber: `+55119${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        role: 'PROFESSIONAL',
        status: 'ACTIVE',
        passwordHash: 'x',
      })
      .returning({ id: staff.id });
    const phone = `+55119${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const [student] = await tx
      .insert(users)
      .values({ phoneNumber: phone, email: `${phone.replace(/\D/g, '')}@example.invalid` })
      .returning({ id: users.id });
    if (!member || !student) throw new Error('fixture');
    return [member.id, student.id];
  });
});

afterAll(async () => {
  if (db && staffId && userId) {
    await db.runAsSystem(async (tx) => {
      await tx.delete(methodologyDocuments).where(eq(methodologyDocuments.domain, DOMAIN));
      await tx.delete(exceptionCases).where(eq(exceptionCases.userId, userId));
      await tx.delete(safetyEvents).where(eq(safetyEvents.userId, userId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(staff).where(eq(staff.id, staffId));
    });
  }
  await app?.close();
});

describe('estúdio de metodologia', () => {
  it('rascunho → teste → publicação, com substituição da versão anterior', async () => {
    const spec = methodologyDomainSpec(DOMAIN);
    const draft = await studio.openDraft(DOMAIN, staffId);
    expect(draft).toMatchObject({ version: 1, status: 'DRAFT' });
    expect((await studio.openDraft(DOMAIN, staffId)).id).toBe(draft.id);

    const valid = exampleParameters(spec);
    await expect(
      studio.updateDraft(draft.id, {
        parameters: { flags: { ...valid.flags, minSleepHours: 20 } },
        guidance: {},
        justifications: {},
        changeNote: 'fora do limite duro',
      }),
    ).rejects.toThrow('fora dos limites');

    // Fora da faixa plausível (5–7 h) sem justificativa: o teste nem roda.
    await studio.updateDraft(draft.id, {
      parameters: { flags: { ...valid.flags, minSleepHours: 8 } },
      guidance: { principles: 'Tendência importa mais que uma noite ruim.' },
      justifications: {},
      changeNote: 'v1',
    });
    const unjustified = await studio.test(draft.id, staffId);
    expect(unjustified.passed).toBe(false);
    expect(unjustified.unjustified.map((i) => i.path)).toEqual(['flags.minSleepHours']);
    await expect(studio.publish(draft.id, staffId)).rejects.toThrow('passar nos testes');

    await studio.updateDraft(draft.id, {
      parameters: { flags: { ...valid.flags, minSleepHours: 8 } },
      guidance: { principles: 'Tendência importa mais que uma noite ruim.' },
      justifications: { 'flags.minSleepHours': 'Alunos com rotina de turno: margem maior.' },
      changeNote: 'v1',
    });
    evaluationPasses = false;
    expect((await studio.test(draft.id, staffId)).passed).toBe(false);
    expect(evaluated).toContain('teste.recuperacao');
    await expect(studio.publish(draft.id, staffId)).rejects.toThrow('passar nos testes');

    evaluationPasses = true;
    expect((await studio.test(draft.id, staffId)).passed).toBe(true);
    const v1 = await studio.publish(draft.id, staffId);
    expect(v1).toMatchObject({ status: 'PUBLISHED', publishedBy: staffId });

    const rendered = await app.get(PublishedMethodologyReader).render([DOMAIN]);
    expect(rendered.versions).toEqual({ [DOMAIN]: 1 });
    expect(rendered.text).toContain('Sono abaixo de: 8 h');
    expect(rendered.text).toContain('Tendência importa mais que uma noite ruim.');

    const v2Draft = await studio.openDraft(DOMAIN, staffId);
    expect(v2Draft.version).toBe(2);
    expect(await studio.diff(v2Draft.id)).toEqual([]);
    await studio.test(v2Draft.id, staffId);
    await studio.publish(v2Draft.id, staffId);
    const versions = await studio.listDocuments(DOMAIN);
    expect(versions.map((v) => [v.version, v.status])).toEqual([
      [2, 'PUBLISHED'],
      [1, 'SUPERSEDED'],
    ]);

    const published = await db.runAsSystem((tx) =>
      tx
        .select({ payload: domainEvents.payload })
        .from(domainEvents)
        .where(eq(domainEvents.type, 'MethodologyPublished')),
    );
    expect(published.some((e) => e.payload.documentId === v1.id)).toBe(true);
  });
});

describe('sentinela de segurança', () => {
  it('sinal urgente abre caso na fila; o mesmo tipo ativo não duplica', async () => {
    const safety = app.get(SafetyService);
    const signal = signalOf('SEVERE_PAIN', 'dor 8/10 no joelho durante o agachamento', null);
    const first = await safety.raise(userId, [signal], 'RULE');
    const second = await safety.raise(userId, [signal], 'RULE');
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(await safety.activeSignals(userId)).toEqual([
      expect.objectContaining({ kind: 'SEVERE_PAIN', severity: 'URGENT', scope: 'TRAINING' }),
    ]);
    const cases = await db.runAsSystem((tx) =>
      tx
        .select()
        .from(exceptionCases)
        .where(and(eq(exceptionCases.userId, userId), eq(exceptionCases.kind, 'SAFETY'))),
    );
    expect(cases).toEqual([expect.objectContaining({ priority: 'HIGH', domain: 'TRAINING' })]);

    await safety.resolve(first[0] as string, staffId, 'Avaliado: dor muscular, liberado.');
    expect(await safety.activeSignals(userId)).toEqual([]);
    const resolved = await db.runAsSystem((tx) =>
      tx.select().from(safetyEvents).where(inArray(safetyEvents.id, first)),
    );
    expect(resolved[0]).toMatchObject({ status: 'RESOLVED', resolvedBy: staffId });
  });
});
