/**
 * Integração do SubscriptionModule (US-4.1) contra o stack Docker.
 *
 * Prova, com I/O real (Postgres via PgBouncer, RLS FORCE):
 *   (boot)        o AppModule sobe SEM chave de gateway → adaptador MOCK ativo;
 *   (trial)       startTrial persiste `subscriptions` TRIALING sob RLS;
 *   (ativação)    mock emite CHECKOUT_CONFIRMED → applyGatewayEvent → ACTIVE (plano/preço/período);
 *   (idempotência) reenvio do mesmo checkout não repatch;
 *   (falha)       PAYMENT_FAILED → PAST_DUE;
 *   (inválida)    transição ilegítima (CANCELED terminal) é rejeitada;
 *   (isolamento)  a assinatura de A não é visível ao titular B.
 *
 * Pré-requisito: `pnpm run infra:up` + `db:migrate`.
 */
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/core/config/load-env';
import { subscriptions, users } from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { MockGateway } from '../src/modules/subscription/payment/mock-gateway';
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from '../src/modules/subscription/payment/payment-gateway.types';
import { InvalidTransitionError } from '../src/modules/subscription/subscription-model';
import { SubscriptionService } from '../src/modules/subscription/subscription.service';

const { env } = loadEnv();
const apiRoot = process.cwd();
const RUN = Date.now().toString().slice(-8);

let app: INestApplication;
let svc: SubscriptionService;
let db: TenantDatabase;
let gateway: PaymentGateway;

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

let seq = 0;
const phone = () => `+5541${RUN}${(seq += 1)}`;

async function createUser(): Promise<string> {
  return db.runAsSystem(async (tx) => {
    const [u] = await tx.insert(users).values({ phoneNumber: phone() }).returning({ id: users.id });
    if (!u) throw new Error('seed user');
    return u.id;
  });
}

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  svc = app.get(SubscriptionService);
  db = app.get(TenantDatabase);
  gateway = app.get(PAYMENT_GATEWAY);
}, 60_000);

afterAll(async () => {
  try {
    await adminClient.unsafe(
      `DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM users WHERE phone_number LIKE '+5541${RUN}%';`,
    );
  } finally {
    await Promise.all([app?.close(), adminClient.end({ timeout: 5 })]);
  }
}, 60_000);

describe('SubscriptionModule — gateway MOCK e ciclo de vida (US-4.1)', () => {
  it('boota sem chave de gateway → adaptador MOCK ativo', () => {
    expect(gateway).toBeInstanceOf(MockGateway);
    expect(gateway.hasCredentials()).toBe(true);
  });

  it('startTrial persiste TRIALING sob RLS e é idempotente', async () => {
    const userId = await createUser();
    const first = await svc.startTrial(userId);
    expect(first.status).toBe('TRIALING');
    expect(first.trialEndsAt).toBeTruthy();

    const again = await svc.startTrial(userId);
    expect(again.id).toBe(first.id); // não recria

    const [row] = await adminClient<Array<{ status: string; price_cents: number }>>`
      SELECT status, price_cents FROM subscriptions WHERE user_id = ${userId}`;
    expect(row.status).toBe('TRIALING');
    expect(row.price_cents).toBe(3900);
  });

  it('checkout confirmado → ACTIVE; reenvio é idempotente', async () => {
    const userId = await createUser();
    await svc.startTrial(userId);
    const event = (gateway as MockGateway).emit('CHECKOUT_CONFIRMED', {
      userId,
      externalSubscriptionId: `sub_${RUN}_${seq}`,
      plan: 'ANNUAL',
      priceCents: 34900,
    });

    expect((await svc.applyGatewayEvent(event)).status).toBe('ACTIVE');
    const [row] = await adminClient<
      Array<{ status: string; plan: string; external_subscription_id: string }>
    >`
      SELECT status, plan, external_subscription_id FROM subscriptions WHERE user_id = ${userId}`;
    expect(row.status).toBe('ACTIVE');
    expect(row.plan).toBe('ANNUAL');
    expect(row.external_subscription_id).toBe(event.externalSubscriptionId);

    // Replay do mesmo evento não muda nada.
    expect((await svc.applyGatewayEvent(event)).status).toBe('IDEMPOTENT');
  });

  it('pagamento falho → PAST_DUE; transição inválida é rejeitada', async () => {
    const userId = await createUser();
    await svc.startTrial(userId);
    const sub = `sub_${RUN}_${seq}`;
    await svc.applyGatewayEvent(
      (gateway as MockGateway).emit('CHECKOUT_CONFIRMED', {
        userId,
        externalSubscriptionId: sub,
        plan: 'MONTHLY',
        priceCents: 3900,
      }),
    );
    expect(
      (
        await svc.applyGatewayEvent(
          (gateway as MockGateway).emit('PAYMENT_FAILED', { userId, externalSubscriptionId: sub }),
        )
      ).status,
    ).toBe('PAST_DUE');

    // CANCELED é terminal: cancela e depois um checkout não reativa.
    await svc.cancel(userId, 'teste');
    await expect(
      svc.applyGatewayEvent(
        (gateway as MockGateway).emit('CHECKOUT_CONFIRMED', {
          userId,
          externalSubscriptionId: sub,
          plan: 'MONTHLY',
          priceCents: 3900,
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it('isolamento: a assinatura de A não é visível ao titular B (RLS)', async () => {
    const userA = await createUser();
    const userB = await createUser();
    await svc.startTrial(userA);

    const seenByB = await db.runAsUser(userB, 'USER', (tx) =>
      tx.select().from(subscriptions).where(eq(subscriptions.userId, userA)),
    );
    expect(seenByB).toHaveLength(0);
    expect(await svc.getForUser(userB)).toBeNull();
  });
});
