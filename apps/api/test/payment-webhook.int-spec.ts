/**
 * Integração do checkout + webhook de pagamento (US-4.2) contra o stack Docker.
 *
 * Gateway MOCK (sem chave) gera/assina os eventos; `WHATSAPP_TRANSPORT` é um fake recorder
 * (captura o dunning). Prova:
 *   (boot)        AppModule sobe sem chave de gateway → MOCK;
 *   (checkout)    createCheckout devolve link (0 dado de cartão no backend);
 *   (ativação)    webhook válido → ACTIVE uma única vez;
 *   (forjado)     assinatura inválida → 200, NÃO ativa;
 *   (replay)      mesmo event_id reentregue → não ativa 2x;
 *   (past_due)    payment_failed → PAST_DUE + dunning (link) enviado no WhatsApp.
 *
 * Pré-requisito: `pnpm run infra:up` + `db:migrate`.
 */
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/core/config/load-env';
import { users } from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { MockGateway } from '../src/modules/subscription/payment/mock-gateway';
import {
  PAYMENT_GATEWAY,
  type GatewayEvent,
  type GatewayEventType,
} from '../src/modules/subscription/payment/payment-gateway.types';
import { PaymentWebhookService } from '../src/modules/subscription/payment-webhook.service';
import { SubscriptionService } from '../src/modules/subscription/subscription.service';
import {
  WHATSAPP_TRANSPORT,
  type OutboundMessage,
  type WhatsappTransport,
} from '../src/modules/whatsapp/arara-transport';
import { seedHealthEligibility } from './health-fixtures';

const { env } = loadEnv();
const apiRoot = process.cwd();
const RUN = Date.now().toString().slice(-8);

const sent: OutboundMessage[] = [];
const fakeTransport: WhatsappTransport = {
  hasCredentials: () => true,
  async send(m) {
    sent.push(m);
  },
  async sendTyping() {
    /* no-op */
  },
};

let app: INestApplication;
let subs: SubscriptionService;
let webhook: PaymentWebhookService;
let gateway: MockGateway;
let db: TenantDatabase;

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

async function createUser(): Promise<{ userId: string; to: string }> {
  const to = phone();
  const userId = await db.runAsSystem(async (tx) => {
    const [u] = await tx.insert(users).values({ phoneNumber: to }).returning({ id: users.id });
    if (!u) throw new Error('seed user');
    return u.id;
  });
  // O dunning do PAST_DUE é um COACH_MESSAGE (health-gated) — precisa de consentimento ativo.
  await seedHealthEligibility(adminClient, userId);
  return { userId, to };
}

/** Monta um webhook assinado do MOCK (rawBody + sig + ts válidos). */
function signedWebhook(
  type: GatewayEventType,
  params: {
    userId: string;
    externalSubscriptionId?: string;
    plan?: GatewayEvent['plan'];
    priceCents?: number;
  },
) {
  const event = gateway.emit(type, params);
  const rawBody = Buffer.from(JSON.stringify(event));
  const timestamp = String(Math.floor(Date.now() / 1000));
  return { rawBody, signature: gateway.sign(rawBody, timestamp), timestamp, event };
}

async function statusOf(userId: string): Promise<string | undefined> {
  const [row] = await adminClient<Array<{ status: string }>>`
    SELECT status FROM subscriptions WHERE user_id = ${userId}`;
  return row?.status;
}

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 15_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() - started > timeoutMs) throw new Error('timeout aguardando condição');
    await new Promise((r) => setTimeout(r, 150));
  }
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(WHATSAPP_TRANSPORT)
    .useValue(fakeTransport)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.enableShutdownHooks();
  await app.init();
  subs = app.get(SubscriptionService);
  webhook = app.get(PaymentWebhookService);
  gateway = app.get(PAYMENT_GATEWAY);
  db = app.get(TenantDatabase);
}, 60_000);

afterAll(async () => {
  try {
    await adminClient.unsafe(
      // `payments` primeiro: a FK para `subscriptions` é RESTRICT de propósito (liquidação
      // é registro fiscal e não some junto com a assinatura), e a tabela é append-only —
      // limpar exige desligar o trigger, como no `payments-immutability.int-spec.ts`.
      `ALTER TABLE payments DISABLE TRIGGER trg_payments_immutable;
       DELETE FROM payments WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%')
          OR subscription_id IN (SELECT s.id FROM subscriptions s JOIN users u ON u.id = s.user_id
                                 WHERE u.phone_number LIKE '+5541${RUN}%');
       ALTER TABLE payments ENABLE TRIGGER trg_payments_immutable;
       ALTER TABLE user_status_transitions DISABLE TRIGGER trg_user_status_transitions_immutable;
       DELETE FROM user_status_transitions WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       ALTER TABLE user_status_transitions ENABLE TRIGGER trg_user_status_transitions_immutable;
       DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM consents WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM professional_assignments WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM users WHERE phone_number LIKE '+5541${RUN}%';`,
    );
  } finally {
    await Promise.all([app?.close(), adminClient.end({ timeout: 5 })]);
  }
}, 60_000);

describe('checkout + webhook de pagamento (US-4.2)', () => {
  it('boota sem chave → MOCK; checkout devolve link (0 dado de cartão)', async () => {
    expect(gateway).toBeInstanceOf(MockGateway);
    const { userId } = await createUser();
    const cs = await subs.createCheckout(userId, 'MONTHLY', 'CARD', 'terms-v1');
    expect(cs.checkoutUrl).toMatch(/^https:\/\//);
    expect(await statusOf(userId)).toBe('TRIALING'); // ativa só no webhook
  }, 20_000);

  it('webhook válido ativa a assinatura UMA vez; replay não ativa 2x', async () => {
    const { userId } = await createUser();
    await subs.startTrial(userId);
    const sub = `sub_${RUN}_${seq}`;
    const wh = signedWebhook('CHECKOUT_CONFIRMED', {
      userId,
      externalSubscriptionId: sub,
      plan: 'MONTHLY',
      priceCents: 3900,
    });

    await webhook.ingest({ ...wh, correlationId: 'c1' });
    expect(await statusOf(userId)).toBe('ACTIVE');

    // Replay do MESMO evento (mesmo event_id) → deduplicado, não reprocessa.
    await webhook.ingest({ ...wh, correlationId: 'c1-replay' });
    const [{ count }] = await adminClient<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM subscriptions WHERE user_id = ${userId} AND external_subscription_id = ${sub}`;
    expect(count).toBe(1);
  }, 20_000);

  it('webhook forjado → 200 sem ativar', async () => {
    const { userId } = await createUser();
    await subs.startTrial(userId);
    const wh = signedWebhook('CHECKOUT_CONFIRMED', {
      userId,
      externalSubscriptionId: `sub_${RUN}_${seq}`,
    });

    await webhook.ingest({ ...wh, signature: 'deadbeef', correlationId: 'forged' });
    expect(await statusOf(userId)).toBe('TRIALING'); // não ativou
  }, 20_000);

  it('payment_failed → PAST_DUE + dunning (link) enviado no WhatsApp', async () => {
    const { userId, to } = await createUser();
    await subs.startTrial(userId);
    const sub = `sub_${RUN}_${seq}`;
    await webhook.ingest({
      ...signedWebhook('CHECKOUT_CONFIRMED', {
        userId,
        externalSubscriptionId: sub,
        plan: 'MONTHLY',
        priceCents: 3900,
      }),
      correlationId: 'ok',
    });
    await webhook.ingest({
      ...signedWebhook('PAYMENT_FAILED', { userId, externalSubscriptionId: sub }),
      correlationId: 'fail',
    });
    expect(await statusOf(userId)).toBe('PAST_DUE');
    const dunning = await waitFor(() =>
      sent.find((m) => m.to === to && /cancelar quando quiser/i.test(m.text)),
    );
    expect(dunning.text).toContain('https://mock.checkout/'); // link de pagamento no WhatsApp
  }, 20_000);
});
