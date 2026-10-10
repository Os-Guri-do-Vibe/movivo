import { migrationPostgresTls } from '../src/core/database/postgres-tls';
import { AccessLinkService } from '../src/core/database/access-link.service';
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
import { SUBSCRIPTION_PLAN_IDS } from '@movivo/shared';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
import { SubscriptionController } from '../src/modules/subscription/subscription.controller';
import { SubscriptionService } from '../src/modules/subscription/subscription.service';
import { SubscriptionRepository } from '../src/modules/subscription/subscription.repository';
import { CheckoutTokenService } from '../src/modules/subscription/checkout-token.service';

const { env } = loadEnv();
const apiRoot = process.cwd();
const RUN = Date.now().toString().slice(-8);

let app: INestApplication;
let svc: SubscriptionService;
let controller: SubscriptionController;
let db: TenantDatabase;
let gateway: PaymentGateway;
let checkoutTokens: CheckoutTokenService;

const adminClient = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
  ssl: migrationPostgresTls(env, env.MIGRATION_DATABASE_HOST ?? 'localhost'),
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
  user: 'postgres',
  password: readFileSync(
    resolve(apiRoot, '..', '..', 'secrets', 'desenvolvimento', 'postgres_superuser_password'),
    'utf8',
  ).trimEnd(),
  database: env.DATABASE_NAME ?? 'movivo',

  max: 1,
  idle_timeout: 5,
  onnotice: () => undefined,
});

let seq = 0;
const phone = () => `+5541${RUN}${(seq += 1)}`;

async function createUser(): Promise<string> {
  return db.runAsSystem(async (tx) => {
    const to = phone();
    const [u] = await tx
      .insert(users)
      .values({ phoneNumber: to, email: `${to.replace(/\D/g, '')}@example.invalid` })
      .returning({ id: users.id });
    if (!u) throw new Error('seed user');
    return u.id;
  });
}

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  svc = app.get(SubscriptionService);
  controller = app.get(SubscriptionController);
  db = app.get(TenantDatabase);
  gateway = app.get(PAYMENT_GATEWAY);
  checkoutTokens = app.get(CheckoutTokenService);
}, 60_000);

afterAll(async () => {
  try {
    await adminClient.unsafe(
      `ALTER TABLE user_status_transitions DISABLE TRIGGER trg_user_status_transitions_immutable;
       DELETE FROM user_status_transitions WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       ALTER TABLE user_status_transitions ENABLE TRIGGER trg_user_status_transitions_immutable;
       DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM access_link_tokens WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM users WHERE phone_number LIKE '+5541${RUN}%';`,
    );
  } finally {
    await Promise.all([app?.close(), adminClient.end({ timeout: 5 })]);
  }
}, 60_000);

describe('SubscriptionModule — gateway MOCK e ciclo de vida (US-4.1)', () => {
  it('rejeita estado terminal na escrita mesmo se o chamador tiver lido um estado anterior', async () => {
    const userId = await createUser();
    const stale = await svc.startTrial(userId);
    await svc.cancel(userId);
    await expect(
      app.get(SubscriptionRepository).patch(userId, stale.id, { status: 'ACTIVE' }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
    const current = await svc.getForUser(userId);
    expect(current?.status).toBe('CANCELED');
  });

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
    expect(row.price_cents).toBe(7990);
  });

  it('checkout confirmado → ACTIVE; reenvio é idempotente', async () => {
    const userId = await createUser();
    await svc.startTrial(userId, 'ANNUAL');
    const event = (gateway as MockGateway).emit('CHECKOUT_CONFIRMED', {
      userId,
      externalSubscriptionId: `sub_${RUN}_${seq}`,
      plan: 'ANNUAL',
      priceCents: 71880,
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
        priceCents: 7990,
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
          priceCents: 7990,
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

describe('Fim do período pago (varredura de expiração)', () => {
  it('período vencido de cobrança única → EXPIRED, sem acesso, e recompra liberada', async () => {
    const userId = await createUser();
    await svc.startTrial(userId, 'QUARTERLY');
    await svc.applyGatewayEvent(
      (gateway as MockGateway).emit('CHECKOUT_CONFIRMED', {
        userId,
        externalSubscriptionId: `sub_${RUN}_${seq}`,
        plan: 'QUARTERLY',
        priceCents: 22770,
      }),
    );
    // Só leitura na varredura global: não expira linhas de outros testes/dados locais.
    const repo = app.get(SubscriptionRepository);
    expect(await repo.findActiveWithEndedPeriod(new Date(), 500)).not.toContain(userId);

    await adminClient`
      UPDATE subscriptions SET current_period_end = now() - interval '1 hour'
      WHERE user_id = ${userId}`;
    expect(await repo.findActiveWithEndedPeriod(new Date(), 500)).toContain(userId);

    expect((await svc.expirePeriod(userId)).status).toBe('EXPIRED');
    expect((await svc.getForUser(userId))?.status).toBe('EXPIRED');
    expect(await svc.getAccess(userId)).toBe('RESTRICTED');
    // Repetir é inofensivo; EXPIRED volta a aceitar checkout (win-back).
    expect((await svc.expirePeriod(userId)).status).toBe('SKIP_EXPIRED');
    expect(await repo.findActiveWithEndedPeriod(new Date(), 500)).not.toContain(userId);
  });

  it('cancelar mantém o acesso até o fim do período pago', async () => {
    const userId = await createUser();
    await svc.startTrial(userId, 'ANNUAL');
    await svc.applyGatewayEvent(
      (gateway as MockGateway).emit('CHECKOUT_CONFIRMED', {
        userId,
        externalSubscriptionId: `sub_${RUN}_${seq}`,
        plan: 'ANNUAL',
        priceCents: 81480,
      }),
    );
    await svc.cancel(userId, 'teste');
    expect((await svc.getForUser(userId))?.status).toBe('CANCELED');
    expect(await svc.getAccess(userId)).toBe('FULL');
  });
});

describe('Ações self-service: cancelar / pausar / retomar (US-4.5)', () => {
  /** Ativa uma assinatura (checkout confirmado) para o titular. */
  async function activate(userId: string): Promise<void> {
    await svc.startTrial(userId);
    await svc.applyGatewayEvent({
      type: 'CHECKOUT_CONFIRMED',
      userId,
      externalSubscriptionId: `ext_${userId}`,
      plan: 'MONTHLY',
      priceCents: 7990,
    });
  }

  it('cancelar sincroniza com o gateway e grava o motivo', async () => {
    const userId = await createUser();
    await activate(userId);
    const cancelSpy = vi.spyOn(gateway, 'cancelContract');
    const res = await controller.cancel(await portal(userId), { reason: 'sem tempo agora' });
    expect(res.status).toBe('CANCELED');
    expect(cancelSpy).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: `ext_${userId}` }),
    );
    const [row] = await adminClient<Array<{ status: string; cancel_reason: string }>>`
      SELECT status, cancel_reason FROM subscriptions WHERE user_id = ${userId}`;
    expect(row.status).toBe('CANCELED');
    expect(row.cancel_reason).toBe('sem tempo agora');
  });

  it('pausar suspende e mantém o histórico; resume retoma PAUSED→ACTIVE', async () => {
    const userId = await createUser();
    await activate(userId);
    expect((await controller.pause(await portal(userId))).status).toBe('PAUSED');
    expect((await svc.getForUser(userId))?.status).toBe('PAUSED');
    // histórico preservado: a linha continua lá, só muda o estado.
    expect((await controller.resume(await portal(userId))).status).toBe('ACTIVE');
    expect((await svc.getForUser(userId))?.status).toBe('ACTIVE');
  });

  it('token não-UUID ou sem assinatura → 404 (não vaza)', async () => {
    await expect(controller.cancel('nao-e-uuid', {})).rejects.toThrow();
    await expect(controller.cancel('11111111-1111-4111-8111-111111111111', {})).rejects.toThrow();
  });

  it('IDOR: cancelar com o token de A não afeta a assinatura de B', async () => {
    const userA = await createUser();
    const userB = await createUser();
    await activate(userA);
    await activate(userB);
    await controller.cancel(await portal(userA), { reason: 'teste' });
    expect((await svc.getForUser(userA))?.status).toBe('CANCELED');
    expect((await svc.getForUser(userB))?.status).toBe('ACTIVE'); // B intacto
  });
});

describe('Endpoints US-4.6: checkout e portal (view)', () => {
  it('checkout opaco devolve o snapshot persistido, sem aceitar preço do cliente', async () => {
    const userId = await createUser();
    await svc.startTrial(userId, 'QUARTERLY');
    const { token } = await checkoutTokens.issue(userId);
    const res = await controller.checkoutSummary(token);
    expect(res).toMatchObject({ plan: 'QUARTERLY', monthlyCents: 7590, totalCents: 22770 });
    expect(JSON.stringify(res)).not.toContain(userId);
  });

  it('view devolve plano/status/acesso/próxima-cobrança sem PII nem id de gateway', async () => {
    const userId = await createUser();
    await svc.startTrial(userId);
    const view = await controller.view(await portal(userId));
    expect(view.status).toBe('TRIALING');
    expect(view.access).toBe('FULL'); // trial dentro da janela
    expect(SUBSCRIPTION_PLAN_IDS).toContain(view.plan);
    expect(JSON.stringify(view)).not.toContain(userId);
    expect(Object.keys(view).sort()).toEqual(
      [
        'access',
        'canRepurchaseAt',
        'currentPeriodEnd',
        'paymentMethod',
        'plan',
        'refundEligibleUntil',
        'status',
      ].sort(),
    );
  });

  it('view: token não-UUID → 404; titular sem assinatura → 404 (não vaza)', async () => {
    const userB = await createUser(); // existe, mas sem assinatura
    await expect(controller.view('nao-e-uuid')).rejects.toThrow();
    await expect(controller.view(userB)).rejects.toThrow();
  });
});

const PAYER = {
  name: 'Pessoa Teste',
  email: 'teste@movivo.test',
  cpfCnpj: '11144477735',
  postalCode: '01310100',
  addressNumber: '100',
  phone: '11999999999',
};

describe('Arrependimento, recompra e isolamento (checkout hospedado)', () => {
  /** Ativa um contrato pago de cobrança única, com a cobrança identificável (estornável). */
  async function activatePaid(userId: string, plan: 'MONTHLY' | 'QUARTERLY' = 'QUARTERLY') {
    await svc.startTrial(userId, plan);
    const event = (gateway as MockGateway).emit('CHECKOUT_CONFIRMED', {
      userId,
      externalSubscriptionId: `sub_${RUN}_${(seq += 1)}`,
      plan,
      priceCents: 22770,
    });
    await svc.applyGatewayEvent({ ...event, externalPaymentId: `pay_${RUN}_${seq}` });
  }

  it('a ativação registra a data da contratação (âncora dos 7 dias)', async () => {
    const userId = await createUser();
    await activatePaid(userId);
    const row = await svc.getForUser(userId);
    expect(row?.activatedAt).toBeInstanceOf(Date);
    const view = await controller.view(await portal(userId));
    expect(view.refundEligibleUntil).not.toBeNull();
  });

  it('estorno dentro de 7 dias encerra o acesso na hora; repetir ou pedir fora do prazo é 409', async () => {
    const userId = await createUser();
    await activatePaid(userId);
    await expect(controller.refund(await portal(userId))).resolves.toEqual({ status: 'REFUNDED' });
    const after = await svc.getForUser(userId);
    expect(after).toMatchObject({ status: 'CANCELED', cancelReason: 'ARREPENDIMENTO' });
    expect(await svc.getAccess(userId)).toBe('RESTRICTED');
    await expect(controller.refund(await portal(userId))).rejects.toThrow(/prazo/);

    const late = await createUser();
    await activatePaid(late);
    await adminClient`
      UPDATE subscriptions SET activated_at = now() - interval '8 days' WHERE user_id = ${late}`;
    await expect(controller.refund(await portal(late))).rejects.toThrow(/prazo/);
    expect((await svc.getForUser(late))?.status).toBe('ACTIVE');
  });

  it('IDOR: o estorno do titular A não toca na assinatura do titular B', async () => {
    const userA = await createUser();
    const userB = await createUser();
    await activatePaid(userA);
    await activatePaid(userB);
    await controller.refund(await portal(userA));
    expect((await svc.getForUser(userA))?.status).toBe('CANCELED');
    expect((await svc.getForUser(userB))?.status).toBe('ACTIVE');
    expect(await svc.getAccess(userB)).toBe('FULL');
  });

  it('cancelado com período pago em curso não recompra; depois do fim, recompra com período novo', async () => {
    const userId = await createUser();
    await activatePaid(userId);
    await svc.cancel(userId, 'teste');
    const body = { method: 'PIX' as const, payer: PAYER, acceptTerms: true as const };
    await expect(svc.startCheckoutPayment(userId, body, '127.0.0.1')).rejects.toThrow(
      /acesso pago vigente/,
    );
    const blocked = await controller.view(await portal(userId));
    expect(blocked.canRepurchaseAt).not.toBeNull();

    // O período pago acabou: a recompra abre contrato novo, sem herdar o período antigo.
    await adminClient`
      UPDATE subscriptions SET current_period_end = now() - interval '1 hour' WHERE user_id = ${userId}`;
    await svc.startCheckoutPayment(userId, body, '127.0.0.1');
    const pending = await svc.getForUser(userId);
    expect(pending).toMatchObject({
      status: 'PENDING_PAYMENT',
      currentPeriodEnd: null,
      activatedAt: null,
      canceledAt: null,
    });
    const confirm = (gateway as MockGateway).emit('CHECKOUT_CONFIRMED', {
      userId,
      externalSubscriptionId: pending?.externalSubscriptionId ?? `sub_${RUN}_${(seq += 1)}`,
      plan: 'QUARTERLY',
      priceCents: 22770,
    });
    await svc.applyGatewayEvent({ ...confirm, externalPaymentId: `pay_${RUN}_${(seq += 1)}` });
    const renewed = await svc.getForUser(userId);
    expect(renewed?.status).toBe('ACTIVE');
    const days = ((renewed?.currentPeriodEnd?.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(80); // 90 dias novos, não o fim do período antigo
  });
});

async function portal(userId: string): Promise<string> {
  return (await app.get(AccessLinkService).issue('SUBSCRIPTION_PORTAL', userId, userId, 3600000))
    .token;
}
