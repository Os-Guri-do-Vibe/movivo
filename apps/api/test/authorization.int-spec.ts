/** HTTP real: credencial do aluno A nunca autoriza UUID do aluno B. Sem fornecedores externos. */
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { AgentRunner } from '../src/core/agents/agent-runner';
import { AccessLinkService } from '../src/core/database/access-link.service';
import {
  accessLinkTokens,
  anamnesisSessions,
  domainEvents,
  scheduledSessions,
  sessionExecutions,
  subscriptions,
  users,
  workoutAccessTokens,
} from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { QueueManager } from '../src/modules/jobs/queue-manager.service';
import { PlanGenerationService } from '../src/modules/planning/plan-generation.service';
import { TrainingAccessService } from '../src/modules/training/training-access.service';
import { RolesGuard } from '../src/modules/auth/roles.guard';
import { ROLES_KEY } from '../src/modules/auth/roles.decorator';
import { createStudent, fakeRunner } from './plan-fixtures';

let app: INestApplication;
let db: TenantDatabase;
let access: AccessLinkService;
const holders: string[] = [];
/** `sessionId` é a sessão agendada do aluno; `executionId`, a execução já aberta dele. */
const fixtures: Array<{ userId: string; sessionId: string; executionId: string }> = [];
let bearer: string;
const prefix = '/api/v1';
const NOW = new Date('2026-11-04T15:00:00.000Z');
const opaque = () => randomBytes(32).toString('base64url');
const http = () => request(app.getHttpServer());
const finishBody = {
  status: 'COMPLETED',
  rpe: 6,
  durationMinutes: 40,
  painReports: [],
  enjoyment: null,
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AgentRunner)
    .useValue(fakeRunner)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  await app.init();
  // Testa HTTP e persistência; consumidores de filas ficam fora deste cenário.
  vi.spyOn(app.get(QueueManager), 'enqueue').mockResolvedValue('fixture-job');
  db = app.get(TenantDatabase);
  access = app.get(AccessLinkService);
  for (let index = 0; index < 2; index += 1) {
    const userId = await createStudent(db, holders);
    expect((await app.get(PlanGenerationService).generate(userId, { now: NOW })).status).toBe(
      'PUBLISHED',
    );
    const fixture = await db.runAsSystem(async (tx) => {
      await tx.insert(subscriptions).values({
        userId,
        plan: 'MONTHLY',
        priceCents: 3900,
        monthlyPriceCents: 3900,
        totalPriceCents: 3900,
        commitmentMonths: 1,
      });
      const [session] = await tx
        .select({ id: scheduledSessions.id })
        .from(scheduledSessions)
        .where(eq(scheduledSessions.userId, userId))
        .orderBy(scheduledSessions.scheduledOn)
        .limit(1);
      if (!session) throw new Error('fixture sessão');
      return session.id;
    });
    const training = app.get(TrainingAccessService);
    const link = await training.createMagicLink(userId);
    const token = `Bearer ${await training.exchange(link.split('#token=')[1])}`;
    const started = await http()
      .post(`${prefix}/training/sessions/${fixture}/start`)
      .set('Authorization', token)
      .expect(201);
    fixtures.push({ userId, sessionId: fixture, executionId: started.body.id });
    if (index === 0) bearer = token;
  }
});

afterAll(async () => {
  try {
    if (db && holders.length)
      await db.runAsSystem(async (tx) => {
        await tx.delete(domainEvents).where(inArray(domainEvents.userId, holders));
        await tx.delete(workoutAccessTokens).where(inArray(workoutAccessTokens.userId, holders));
        await tx.delete(accessLinkTokens).where(inArray(accessLinkTokens.userId, holders));
        await tx.delete(subscriptions).where(inArray(subscriptions.userId, holders));
        await tx.delete(anamnesisSessions).where(inArray(anamnesisSessions.token, anamnesisTokens));
        await tx.delete(users).where(inArray(users.id, holders));
      });
  } finally {
    await app?.close();
  }
});
const anamnesisTokens = [opaque(), opaque()];
describe('autorização por recurso na API', () => {
  it('toda rota que usa RolesGuard declara papéis explicitamente', () => {
    let checked = 0;
    for (const module of app.get(ModulesContainer).values()) {
      for (const { metatype } of module.controllers.values()) {
        if (!metatype) continue;
        for (const name of Object.getOwnPropertyNames(metatype.prototype)) {
          if (name === 'constructor') continue;
          const handler = metatype.prototype[name];
          if (
            typeof handler !== 'function' ||
            Reflect.getMetadata(PATH_METADATA, handler) === undefined
          )
            continue;
          const guards = [
            ...(Reflect.getMetadata(GUARDS_METADATA, metatype) ?? []),
            ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []),
          ];
          if (!guards.includes(RolesGuard)) continue;
          const roles =
            Reflect.getMetadata(ROLES_KEY, handler) ?? Reflect.getMetadata(ROLES_KEY, metatype);
          expect(roles, `${metatype.name}.${name}`).toBeDefined();
          expect(roles.length, `${metatype.name}.${name}`).toBeGreaterThan(0);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('nega trocar UUID de sessão ou execução em leitura e mutações, preservando B', async () => {
    const b = fixtures[1];
    await http()
      .post(`${prefix}/training/sessions/${b.sessionId}/start`)
      .set('Authorization', bearer)
      .expect(404);
    const sets = {
      sets: [
        {
          exerciseId: 'x',
          setNumber: 1,
          reps: 10,
          loadKg: null,
          durationSeconds: null,
          rir: null,
          completed: true,
        },
      ],
    };
    await http()
      .put(`${prefix}/training/executions/${b.executionId}/sets`)
      .set('Authorization', bearer)
      .send(sets)
      .expect(404);
    await http()
      .post(`${prefix}/training/executions/${b.executionId}/finish`)
      .set('Authorization', bearer)
      .send(finishBody)
      .expect(404);
    const [unchanged] = await db.runAsSystem((tx) =>
      tx.select().from(sessionExecutions).where(eq(sessionExecutions.id, b.executionId)),
    );
    expect(unchanged?.status).toBe('IN_PROGRESS');
    expect(unchanged?.finishedAt ?? null).toBeNull();
  });

  it('UUIDs de plano/aluno não substituem credenciais e propósitos não se cruzam', async () => {
    const a = fixtures[0];
    const planLink = await access.issue('PLAN', a.userId, a.userId, 60000);
    const portalLink = await access.issue('SUBSCRIPTION_PORTAL', a.userId, a.userId, 60000);
    await http().get(`${prefix}/plans/by-token/${fixtures[1].userId}`).expect(404);
    await http().get(`${prefix}/subscription/${fixtures[1].userId}`).expect(404);
    await http().get(`${prefix}/plans/by-token/${portalLink.token}`).expect(404);
    await http().get(`${prefix}/subscription/${planLink.token}`).expect(404);
    await http().get(`${prefix}/subscription/checkout/${portalLink.token}`).expect(404);
    await http().get(`${prefix}/subscription/${portalLink.token}`).expect(200);
    await http()
      .post(`${prefix}/training/sessions/${fixtures[1].sessionId}/start`)
      .set('Authorization', `Bearer ${planLink.token}`)
      .expect(401);
  });

  it('anamnese exige token próprio; UUID e parâmetros de B não mudam o titular', async () => {
    const ids = await db.runAsSystem((tx) =>
      tx
        .insert(anamnesisSessions)
        .values(
          anamnesisTokens.map((token, index) => ({
            token,
            expiresAt: new Date(Date.now() + 60000),
            blocks: { registration: { name: index ? 'B privado' : 'A privado' } },
          })),
        )
        .returning({ id: anamnesisSessions.id }),
    );
    const own = await http()
      .get(`${prefix}/anamnesis/session/${anamnesisTokens[0]}`)
      .query({ sessionId: ids[1].id, userId: fixtures[1].userId })
      .expect(200);
    expect(own.body.blocks.registration.name).toBe('A privado');
    await http().get(`${prefix}/anamnesis/session/${ids[1].id}`).expect(404);
    await http().get(`${prefix}/checkin/session/${anamnesisTokens[0]}`).expect(404);
  });
});

describe('validação server-side — HTTP direto sem frontend', () => {
  it.each([
    {},
    { email: 'inválido', password: 'segredo' },
    { email: 42, password: 'segredo' },
    { email: 'aluno@example.invalid', password: [] },
    { email: 'aluno@example.invalid', password: 'x'.repeat(201) },
  ])('login rejeita tipos, formato, tamanho e obrigatórios', async (body) => {
    const response = await http().post(`${prefix}/auth/login`).send(body).expect(400);
    expect(response.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Dados de entrada inválidos.',
    });
  });

  it.each([
    {},
    { sets: 'série' },
    { sets: [] },
    { sets: [{ exerciseId: 'x', setNumber: 21 }] },
    { sets: [{ exerciseId: 'x', setNumber: 1, reps: '10' }] },
    { sets: [{ exerciseId: 'x', setNumber: 1, reps: 301 }] },
    { sets: Array.from({ length: 121 }, () => ({ exerciseId: 'x', setNumber: 1 })) },
  ])('séries rejeitam campos inválidos antes de persistir', async (body) => {
    await http()
      .put(`${prefix}/training/executions/${fixtures[0].executionId}/sets`)
      .set('Authorization', bearer)
      .send(body)
      .expect(400);
  });

  it('UUID e data de calendário são validados no backend', async () => {
    await http()
      .post(`${prefix}/training/sessions/not-a-uuid/start`)
      .set('Authorization', bearer)
      .expect(400);
    await http()
      .get(`${prefix}/training/day`)
      .query({ date: '2026-02-30' })
      .set('Authorization', bearer)
      .expect(400);
  });

  it('um treino só pode ser concluído uma vez, mesmo com requisições simultâneas', async () => {
    const path = `${prefix}/training/executions/${fixtures[0].executionId}`;
    const responses = await Promise.all(
      [5, 9].map((rpe) =>
        http()
          .post(`${path}/finish`)
          .set('Authorization', bearer)
          .send({ ...finishBody, rpe }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([201, 400]);
    const [before] = await db.runAsSystem((tx) =>
      tx.select().from(sessionExecutions).where(eq(sessionExecutions.id, fixtures[0].executionId)),
    );
    await http()
      .post(`${path}/finish`)
      .set('Authorization', bearer)
      .send({ ...finishBody, rpe: 10 })
      .expect(400);
    const [after] = await db.runAsSystem((tx) =>
      tx.select().from(sessionExecutions).where(eq(sessionExecutions.id, fixtures[0].executionId)),
    );
    expect(after).toEqual(before);
  });
});
