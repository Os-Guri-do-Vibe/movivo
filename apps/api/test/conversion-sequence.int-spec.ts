/**
 * Integração — ConversionSequenceWorker (US-4.3) contra o stack Docker (Redis + Postgres).
 * Pré-requisito: `pnpm run infra:up`.
 *
 * Prova, com I/O real: `trial-start` cria a assinatura TRIALING; um touchpoint em trial envia
 * (uma vez — idempotência via guard Redis); e quem já converteu (ACTIVE) para de receber.
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { type Job } from 'bullmq';
import { NestFactory } from '@nestjs/core';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { subscriptions, users } from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { ConversionSequenceWorker } from '../src/modules/subscription/conversion-sequence.worker';
import { SubscriptionService } from '../src/modules/subscription/subscription.service';

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
    await db.runAsSystem(async (tx) => {
      await tx.delete(subscriptions).where(inArray(subscriptions.userId, createdUserIds));
      await tx.delete(users).where(inArray(users.id, createdUserIds));
      return undefined;
    });
  }
  await app?.close();
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
