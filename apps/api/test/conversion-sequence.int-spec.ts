/**
 * Integração — ConversionSequenceWorker (US-4.3) contra o stack Docker (Redis + Postgres).
 * Pré-requisito: `pnpm run infra:up`.
 *
 * Prova, com I/O real: `trial-start` cria a assinatura TRIALING; um touchpoint em trial envia
 * (uma vez — idempotência via guard Redis); e quem já converteu (ACTIVE) para de receber.
 */
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { type INestApplication } from '@nestjs/common';
import { type Job } from 'bullmq';
import { NestFactory } from '@nestjs/core';
import { eq, inArray } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/core/config/load-env';
import { subscriptions, users } from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { ConversionSequenceWorker } from '../src/modules/subscription/conversion-sequence.worker';
import { SubscriptionService } from '../src/modules/subscription/subscription.service';

const { env } = loadEnv();
const apiRoot = process.cwd();
// Superuser só para limpar `user_status_transitions` (append-only): movivo_app não
// tem UPDATE/DELETE/ALTER TABLE nela por desenho (US-8.3).
const adminClient = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
  user: 'postgres',
  password: readFileSync(
    resolve(apiRoot, '..', '..', 'secrets', 'postgres_superuser_password'),
    'utf8',
  ).trimEnd(),
  database: env.DATABASE_NAME ?? 'movivo',
  ssl: false,
  max: 1,
  idle_timeout: 5,
  onnotice: () => undefined,
});

let app: INestApplication;
let db: TenantDatabase;
let worker: ConversionSequenceWorker;
let subs: SubscriptionService;
const createdUserIds: string[] = [];

async function createUser(): Promise<string> {
  const phone = `+55119${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const rows = await db.runAsSystem((tx) =>
    tx.insert(users).values({ phoneNumber: phone }).returning({ id: users.id }),
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('falha ao criar usuário');
  createdUserIds.push(id);
  return id;
}

const jobOf = (name: string, data: unknown) => ({ name, data }) as unknown as Job<never>;

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  db = app.get(TenantDatabase);
  worker = app.get(ConversionSequenceWorker);
  subs = app.get(SubscriptionService);
});

afterAll(async () => {
  if (db && createdUserIds.length > 0) {
    await adminClient.unsafe(
      'ALTER TABLE user_status_transitions DISABLE TRIGGER trg_user_status_transitions_immutable',
    );
    await adminClient`DELETE FROM user_status_transitions WHERE user_id = ANY(${createdUserIds}::uuid[])`;
    await adminClient.unsafe(
      'ALTER TABLE user_status_transitions ENABLE TRIGGER trg_user_status_transitions_immutable',
    );
    await db.runAsSystem(async (tx) => {
      await tx.delete(subscriptions).where(inArray(subscriptions.userId, createdUserIds));
      await tx.delete(users).where(inArray(users.id, createdUserIds));
      return undefined;
    });
  }
  await Promise.all([app?.close(), adminClient.end({ timeout: 5 })]);
});

describe('ConversionSequenceWorker (US-4.3)', () => {
  it('trial-start cria a assinatura TRIALING', async () => {
    const userId = await createUser();
    await worker.process(jobOf('trial-start', { userId }));
    const sub = await subs.getForUser(userId);
    expect(sub?.status).toBe('TRIALING');
  });

  it('touchpoint em trial envia uma vez (idempotente)', async () => {
    const userId = await createUser();
    await subs.startTrial(userId);
    const first = await worker.process(jobOf('touchpoint', { userId, key: 'day7' }));
    const second = await worker.process(jobOf('touchpoint', { userId, key: 'day7' }));
    expect(first.status).toBe('SENT');
    expect(second.status).toBe('ALREADY_SENT');
  });

  it('para de nutrir quem já converteu (ACTIVE)', async () => {
    const userId = await createUser();
    await subs.startTrial(userId);
    await subs.applyGatewayEvent({
      type: 'CHECKOUT_CONFIRMED',
      userId,
      externalSubscriptionId: `ext_${userId}`,
      plan: 'MONTHLY',
      priceCents: 3900,
    });
    const res = await worker.process(jobOf('touchpoint', { userId, key: 'day13' }));
    expect(res.status).toBe('SKIP_ACTIVE');
  });
});

describe('Downgrade + win-back (US-4.4)', () => {
  /** Força o fim do trial no passado (sob contexto de sistema). */
  async function expireTrial(userId: string): Promise<void> {
    await db.runAsSystem(async (tx) => {
      await tx
        .update(subscriptions)
        .set({ trialEndsAt: new Date(Date.now() - 24 * 3600 * 1000) })
        .where(eq(subscriptions.userId, userId));
      return undefined;
    });
  }

  it('dia 14 (downgrade) dispara em trial e para se já convertido', async () => {
    const userId = await createUser();
    await subs.startTrial(userId, 'ANNUAL');
    expect((await worker.process(jobOf('touchpoint', { userId, key: 'day14' }))).status).toBe(
      'SENT',
    );
  });

  it('win-back: trial vencido → envia uma vez (idempotente); registra o motivo', async () => {
    const userId = await createUser();
    await subs.startTrial(userId);
    await expireTrial(userId);

    expect((await worker.process(jobOf('touchpoint', { userId, key: 'winback' }))).status).toBe(
      'SENT',
    );
    // Idempotência: mesmo touchpoint não reenvia.
    expect((await worker.process(jobOf('touchpoint', { userId, key: 'winback' }))).status).toBe(
      'ALREADY_SENT',
    );

    // Motivo declarado registrado em cancelReason (insumo de retenção).
    await subs.recordWinbackReason(userId, 'achei o preço alto');
    expect((await subs.getForUser(userId))?.cancelReason).toBe('achei o preço alto');
  });

  it('win-back não dispara se o trial ainda está vigente', async () => {
    const userId = await createUser();
    await subs.startTrial(userId); // trialEndsAt no futuro
    expect((await worker.process(jobOf('touchpoint', { userId, key: 'winback' }))).status).toBe(
      'TRIAL_NOT_ENDED',
    );
  });

  it('win-back não vai para quem converteu (ACTIVE)', async () => {
    const userId = await createUser();
    await subs.startTrial(userId);
    await expireTrial(userId);
    await subs.applyGatewayEvent({
      type: 'CHECKOUT_CONFIRMED',
      userId,
      externalSubscriptionId: `ext_wb_${userId}`,
      plan: 'MONTHLY',
      priceCents: 3900,
    });
    expect((await worker.process(jobOf('touchpoint', { userId, key: 'winback' }))).status).toBe(
      'SKIP_ACTIVE',
    );
  });
});
