/**
 * Integração — Strava. Pré-requisito: `pnpm run infra:up`, com o contêiner `movivo-api` parado.
 * A API do Strava é falsa (fetch); o que se prova com Postgres real: o link do WhatsApp leva ao
 * OAuth, a volta guarda os tokens cifrados (link de uso único), a atividade do webhook vira treino
 * registrado uma vez só e a desautorização apaga a conexão.
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { AppConfigService } from '../src/core/config';
import {
  domainEvents,
  executionMetrics,
  sessionExecutions,
  users,
  wearableConnections,
} from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { QueueManager } from '../src/modules/jobs/queue-manager.service';
import { StravaService, type StravaJob } from '../src/modules/training/strava/strava.service';
import { createStudent } from './plan-fixtures';

const ATHLETE = String(Date.now()).slice(-9);

let app: INestApplication;
let db: TenantDatabase;
let strava: StravaService;
let enqueue: ReturnType<typeof vi.fn>;
const created: string[] = [];

beforeAll(async () => {
  app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({
    logger: false,
  });
  await app.init();
  db = app.get(TenantDatabase);
  strava = app.get(StravaService);
  enqueue = vi.spyOn(app.get(QueueManager), 'enqueue').mockResolvedValue('job') as never;
  vi.spyOn(app.get(AppConfigService), 'strava', 'get').mockReturnValue({
    clientId: '12345',
    clientSecret: 'segredo-do-app-strava-de-teste',
    webhookVerifyToken: 'token-de-verificacao-do-webhook-123456',
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.endsWith('/oauth/token')
        ? {
            access_token: 'acesso-strava',
            refresh_token: 'renovacao-strava',
            expires_at: Math.floor(Date.now() / 1000) + 6 * 3600,
            athlete: { id: Number(ATHLETE) },
          }
        : {
            id: 42,
            sport_type: 'Run',
            start_date: '2026-10-31T10:00:00Z',
            start_date_local: '2026-10-31T07:00:00Z',
            distance: 5020,
            moving_time: 1694,
          };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (db && created.length > 0) {
    await db.runAsSystem(async (tx) => {
      await tx.delete(domainEvents).where(inArray(domainEvents.userId, created));
      await tx.delete(users).where(inArray(users.id, created));
    });
  }
  await app?.close();
});

const job = (data: Partial<StravaJob>) =>
  ({
    data: {
      athleteId: ATHLETE,
      objectId: 42,
      objectType: 'activity',
      aspectType: 'create',
      deauthorized: false,
      ...data,
    },
  }) as Job<StravaJob>;

describe('Strava', () => {
  it('conecta pelo link do WhatsApp, importa a atividade uma vez e desconecta', async () => {
    const userId = await createStudent(db, created);

    expect(await strava.handleInbound(userId, 'conectar meu Strava', 'k1')).toBe(true);
    const text = String(
      (enqueue.mock.calls.at(-1)?.[2] as { text: string } | undefined)?.text ?? '',
    );
    const state = /connect\/([A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? '';
    expect(await strava.authorizeUrl(state)).toContain('client_id=12345');

    expect(await strava.callback({ state, code: 'codigo', scope: 'read,activity:read_all' })).toBe(
      'connected',
    );
    expect(await strava.callback({ state, code: 'codigo', scope: 'activity:read_all' })).toBe(
      'expired',
    );
    const [connection] = await db.runAsSystem((tx) =>
      tx.select().from(wearableConnections).where(eq(wearableConnections.userId, userId)),
    );
    expect(connection?.athleteId).toBe(ATHLETE);
    expect(connection?.accessToken).not.toContain('acesso-strava');

    expect(await strava.process(job({}))).toBe('IMPORTED');
    expect(await strava.process(job({}))).toBe('DUPLICATE');
    const executions = await db.runAsSystem((tx) =>
      tx
        .select({ id: sessionExecutions.id, source: sessionExecutions.source })
        .from(sessionExecutions)
        .where(
          and(eq(sessionExecutions.userId, userId), eq(sessionExecutions.externalId, 'strava:42')),
        ),
    );
    expect(executions).toEqual([expect.objectContaining({ source: 'STRAVA' })]);
    const [metrics] = await db.runAsSystem((tx) =>
      tx
        .select()
        .from(executionMetrics)
        .where(eq(executionMetrics.executionId, executions[0]?.id ?? '')),
    );
    expect(metrics).toMatchObject({ confirmed: true, metrics: { distanceMeters: 5020 } });

    expect(await strava.process(job({ objectType: 'athlete', deauthorized: true }))).toBe(
      'DEAUTHORIZED',
    );
    expect(
      await db.runAsSystem((tx) =>
        tx.select().from(wearableConnections).where(eq(wearableConnections.userId, userId)),
      ),
    ).toEqual([]);
  });

  it('webhook: só responde ao desafio com o token certo', () => {
    expect(strava.challenge('subscribe', 'token-de-verificacao-do-webhook-123456', 'abc')).toBe(
      'abc',
    );
    expect(strava.challenge('subscribe', 'outro', 'abc')).toBeNull();
  });
});
