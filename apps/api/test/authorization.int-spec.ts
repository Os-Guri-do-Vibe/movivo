/** HTTP real: credencial do aluno A nunca autoriza UUID do aluno B. Sem fornecedores externos. */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ModulesContainer, NestFactory } from '@nestjs/core';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { AccessLinkService } from '../src/core/database/access-link.service';
import {
  accessLinkTokens,
  anamnesisSessions,
  protocols,
  subscriptions,
  users,
  workoutAccessTokens,
  workoutSessions,
  workoutCompletions,
  handoffAlerts,
  workoutSetEntries,
} from '../src/core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../src/core/database/tenant-database.service';
import { QueueManager } from '../src/modules/jobs/queue-manager.service';
import { WorkoutAccessService } from '../src/modules/workout/workout-access.service';
import { RolesGuard } from '../src/modules/auth/roles.guard';
import { ROLES_KEY } from '../src/modules/auth/roles.decorator';

let app: INestApplication;
let db: TenantDatabase;
let access: AccessLinkService;
const holders: string[] = [];
const fixtures: Array<{ userId: string; protocolId: string; sessionId: string }> = [];
let bearer: string;
const prefix = '/api/v1';
const opaque = () => randomBytes(32).toString('base64url');
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  await app.init();
  // Testa HTTP e persistência; consumidores de feedback ficam fora deste cenário.
  vi.spyOn(app.get(QueueManager), 'enqueue').mockResolvedValue('fixture-job');
  db = app.get(TenantDatabase);
  access = app.get(AccessLinkService);
  for (const name of ['Aluno A isolado', 'Aluno B isolado']) {
    const fixture = await db.runAsSystem(async (tx) => {
      const [holder] = await tx
        .insert(users)
        .values({
          phoneNumber: `+5511${Date.now().toString().slice(-8)}${holders.length}`,
          name,
          email: `${randomUUID()}@example.invalid`,
          timezone: 'UTC',
        })
        .returning({ id: users.id });
      if (!holder) throw new Error('fixture aluno');
      holders.push(holder.id);
      const [protocol] = await tx
        .insert(protocols)
        .values({
          userId: holder.id,
          status: 'ACTIVE',
          content: { marker: name },
          constraints: {},
          mesocycleName: name,
          startDate: new Date(),
          endDate: new Date(Date.now() + 86400000),
        })
        .returning({ id: protocols.id });
      if (!protocol) throw new Error('fixture protocolo');
      const [session] = await tx
        .insert(workoutSessions)
        .values({
          userId: holder.id,
          protocolId: protocol.id,
          protocolVersion: 1,
          weekNumber: 1,
          sessionKey: 'A',
          scheduledDate: new Date().toISOString().slice(0, 10),
          prescription: { dayLabel: 'A', exercises: [] } as never,
        })
        .returning({ id: workoutSessions.id });
      if (!session) throw new Error('fixture treino');
      await tx.insert(subscriptions).values({
        userId: holder.id,
        plan: 'MONTHLY',
        priceCents: 3900,
        monthlyPriceCents: 3900,
        totalPriceCents: 3900,
        commitmentMonths: 1,
      });
      return { userId: holder.id, protocolId: protocol.id, sessionId: session.id };
    });
    fixtures.push(fixture);
  }
  const workouts = app.get(WorkoutAccessService);
  const link = await workouts.createMagicLink(fixtures[0].userId);
  bearer = `Bearer ${await workouts.exchange(link.split('#token=')[1])}`;
});

afterAll(async () => {
  try {
    if (db && holders.length)
      await db.runAsSystem(async (tx) => {
        await tx.delete(workoutCompletions).where(inArray(workoutCompletions.userId, holders));
        await tx.delete(handoffAlerts).where(inArray(handoffAlerts.userId, holders));
        await tx.delete(workoutSetEntries).where(inArray(workoutSetEntries.userId, holders));
        await tx.delete(workoutAccessTokens).where(inArray(workoutAccessTokens.userId, holders));
        await tx.delete(workoutSessions).where(inArray(workoutSessions.userId, holders));
        await tx.delete(accessLinkTokens).where(inArray(accessLinkTokens.userId, holders));
        await tx.delete(subscriptions).where(inArray(subscriptions.userId, holders));
        await tx.delete(anamnesisSessions).where(inArray(anamnesisSessions.token, anamnesisTokens));
        await tx.delete(protocols).where(inArray(protocols.userId, holders));
        await tx.delete(users).where(inArray(users.id, holders));
      });
  } finally {
    await app?.close();
  }
});
const anamnesisTokens = [opaque(), opaque()];
const rollbackInsert = new Error('inserção de teste autorizada; reverter fixture');

function insertThenRollback(insert: (tx: TenantTransaction) => Promise<unknown>) {
  return db.runAsUser(fixtures[0].userId, 'USER', async (tx) => {
    await insert(tx);
    throw rollbackInsert;
  });
}

describe('autorização por recurso na API', () => {
  it('RLS nega treino de A ligado ao protocolo de B e aceita o pai de A', async () => {
    const id = randomUUID();
    const row = {
      id,
      userId: fixtures[0].userId,
      protocolVersion: 1,
      weekNumber: 1,
      sessionKey: randomUUID(),
      scheduledDate: new Date().toISOString().slice(0, 10),
      prescription: { dayLabel: 'A', exercises: [] } as never,
    };
    await expect(
      insertThenRollback((tx) =>
        tx.insert(workoutSessions).values({ ...row, protocolId: fixtures[1].protocolId }),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    await expect(
      insertThenRollback((tx) =>
        tx.insert(workoutSessions).values({ ...row, protocolId: fixtures[0].protocolId }),
      ),
    ).rejects.toBe(rollbackInsert);
    const remaining = await db.runAsSystem((tx) =>
      tx.select({ id: workoutSessions.id }).from(workoutSessions).where(eq(workoutSessions.id, id)),
    );
    expect(remaining).toHaveLength(0);
  });

  it('RLS nega série de A ligada ao treino de B e aceita o pai de A', async () => {
    const id = randomUUID();
    const row = {
      id,
      userId: fixtures[0].userId,
      exerciseId: randomUUID(),
      setNumber: 1,
    };
    await expect(
      insertThenRollback((tx) =>
        tx.insert(workoutSetEntries).values({ ...row, workoutSessionId: fixtures[1].sessionId }),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    await expect(
      insertThenRollback((tx) =>
        tx.insert(workoutSetEntries).values({ ...row, workoutSessionId: fixtures[0].sessionId }),
      ),
    ).rejects.toBe(rollbackInsert);
    const remaining = await db.runAsSystem((tx) =>
      tx
        .select({ id: workoutSetEntries.id })
        .from(workoutSetEntries)
        .where(eq(workoutSetEntries.id, id)),
    );
    expect(remaining).toHaveLength(0);
  });

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

  it('nega trocar UUID de treino em leitura e todas as mutações, preservando B', async () => {
    const path = `${prefix}/workouts/sessions/${fixtures[1].sessionId}`;
    await http().post(`${path}/start`).set('Authorization', bearer).expect(404);
    await http()
      .patch(`${path}/sets`)
      .set('Authorization', bearer)
      .send({ entries: [] })
      .expect(404);
    await http()
      .post(`${path}/finish`)
      .set('Authorization', bearer)
      .send({ perceivedEffort: 5 })
      .expect(404);
    await http().get(`${path}/share-card`).set('Authorization', bearer).expect(404);
    const [unchanged] = await db.runAsSystem((tx) =>
      tx.select().from(workoutSessions).where(eq(workoutSessions.id, fixtures[1].sessionId)),
    );
    expect(unchanged.status).toBe('PLANNED');
    expect(unchanged.startedAt).toBeNull();
    expect(unchanged.finishedAt).toBeNull();
    await http()
      .post(`${prefix}/workouts/sessions/${fixtures[0].sessionId}/start`)
      .set('Authorization', bearer)
      .expect(201);
  });

  it('UUIDs de protocolo/aluno não substituem credenciais e propósitos não se cruzam', async () => {
    const a = fixtures[0];
    const protocolLink = await access.issue('PROTOCOL', a.userId, a.protocolId, 60000);
    const portalLink = await access.issue('SUBSCRIPTION_PORTAL', a.userId, a.userId, 60000);
    const own = await http()
      .get(`${prefix}/protocols/by-token/${protocolLink.token}`)
      .query({ userId: fixtures[1].userId, protocolId: fixtures[1].protocolId })
      .expect(200);
    expect(own.body.mesocycleName).toBe('Aluno A isolado');
    await http().get(`${prefix}/protocols/by-token/${fixtures[1].protocolId}`).expect(404);
    await http().get(`${prefix}/subscription/${fixtures[1].userId}`).expect(404);
    await http().get(`${prefix}/protocols/by-token/${portalLink.token}`).expect(404);
    await http().get(`${prefix}/subscription/${protocolLink.token}`).expect(404);
    await http().get(`${prefix}/subscription/checkout/${portalLink.token}`).expect(404);
    await http().get(`${prefix}/subscription/${portalLink.token}`).expect(200);
    await http()
      .get(`${prefix}/workouts/sessions/${fixtures[1].sessionId}/share-card`)
      .set('Authorization', `Bearer ${protocolLink.token}`)
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
            dataBlock1: { name: index ? 'B privado' : 'A privado' },
          })),
        )
        .returning({ id: anamnesisSessions.id }),
    );
    const own = await http()
      .get(`${prefix}/anamnesis/session/${anamnesisTokens[0]}`)
      .query({ sessionId: ids[1].id, userId: fixtures[1].userId })
      .expect(200);
    expect(own.body.step1.name).toBe('A privado');
    await http().get(`${prefix}/anamnesis/session/${ids[1].id}`).expect(404);
    await http().get(`${prefix}/checkin/session/${anamnesisTokens[0]}`).expect(404);
    await http().get(`${prefix}/protocol-renewal/session/${anamnesisTokens[0]}`).expect(404);
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
    { entries: 'série' },
    { entries: [{ exerciseId: 'x', setNumber: 21 }] },
    { entries: [{ exerciseId: 'x', setNumber: 1, reps: '10' }] },
    { entries: [{ exerciseId: 'x', setNumber: 1, loadUnit: 'INVALID' }] },
    { entries: [{ exerciseId: 'x', setNumber: 1, loadValue: -1 }] },
    { entries: [{ exerciseId: 'x', setNumber: 1, reps: 301 }] },
    { entries: [{ exerciseId: 'x', setNumber: 1, completed: true, skipped: true }] },
    { entries: Array.from({ length: 301 }, () => ({ exerciseId: 'x', setNumber: 1 })) },
  ])('séries rejeitam campos inválidos antes de persistir', async (body) => {
    await http()
      .patch(`${prefix}/workouts/sessions/${fixtures[0].sessionId}/sets`)
      .set('Authorization', bearer)
      .send(body)
      .expect(400);
  });

  it('UUID e data de calendário são validados no backend', async () => {
    await http()
      .post(`${prefix}/workouts/sessions/not-a-uuid/start`)
      .set('Authorization', bearer)
      .expect(400);
    await http()
      .get(`${prefix}/workouts/journal`)
      .query({ date: '2026-02-30' })
      .set('Authorization', bearer)
      .expect(400);
  });

  it('um treino só pode ser finalizado uma vez, mesmo com requisições simultâneas', async () => {
    const path = `${prefix}/workouts/sessions/${fixtures[0].sessionId}`;
    const responses = await Promise.all(
      [5, 9].map((perceivedEffort) =>
        http().post(`${path}/finish`).set('Authorization', bearer).send({ perceivedEffort }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([201, 400]);
    const [before] = await db.runAsSystem((tx) =>
      tx.select().from(workoutSessions).where(eq(workoutSessions.id, fixtures[0].sessionId)),
    );
    await http()
      .post(`${path}/finish`)
      .set('Authorization', bearer)
      .send({ perceivedEffort: 10 })
      .expect(400);
    await http().post(`${path}/start`).set('Authorization', bearer).expect(400);
    await http()
      .patch(`${path}/sets`)
      .set('Authorization', bearer)
      .send({ entries: [] })
      .expect(400);
    const [after] = await db.runAsSystem((tx) =>
      tx.select().from(workoutSessions).where(eq(workoutSessions.id, fixtures[0].sessionId)),
    );
    expect(after).toEqual(before);
  });
});
