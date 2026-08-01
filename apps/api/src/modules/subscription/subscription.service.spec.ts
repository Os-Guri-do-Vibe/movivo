import { describe, expect, it, vi } from 'vitest';

import type { SubscriptionRow } from '../../core/database/schema';
import type { PaymentGateway } from './payment/payment-gateway.types';
import type { GatewayEvent } from './payment/payment-gateway.types';
import { InvalidTransitionError } from './subscription-model';
import { nextStatusForEvent, SubscriptionService } from './subscription.service';
import type { SubscriptionRepository } from './subscription.repository';

const USER = 'u1';

function row(over: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: 's1',
    userId: USER,
    plan: 'MONTHLY',
    priceCents: 3900,
    currency: 'BRL',
    status: 'TRIALING',
    paymentProvider: null,
    externalSubscriptionId: null,
    trialEndsAt: new Date(),
    currentPeriodStart: null,
    currentPeriodEnd: null,
    canceledAt: null,
    cancelReason: null,
    termsVersion: null,
    termsAcceptedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as SubscriptionRow;
}

function make(current: SubscriptionRow | null, gatewayName: PaymentGateway['name'] = 'MOCK') {
  const patch = vi.fn(() => Promise.resolve());
  const insert = vi.fn((v: unknown) => Promise.resolve(row(v as Partial<SubscriptionRow>)));
  const repo = {
    findByUserId: vi.fn(() => Promise.resolve(current)),
    insert,
    patch,
  } as unknown as SubscriptionRepository;
  const cancelSubscription = vi.fn(() => Promise.resolve());
  const gateway = { name: gatewayName, cancelSubscription } as unknown as PaymentGateway;
  const logger = { info: vi.fn(), warn: vi.fn(), setContext: vi.fn() } as never;
  return { svc: new SubscriptionService(repo, gateway, logger), patch, insert, cancelSubscription };
}

function evt(over: Partial<GatewayEvent> = {}): GatewayEvent {
  return {
    type: 'CHECKOUT_CONFIRMED',
    eventId: 'e1',
    externalSubscriptionId: 'sub_1',
    userId: USER,
    plan: 'QUARTERLY',
    priceCents: 9900,
    ...over,
  };
}

describe('nextStatusForEvent (US-4.1)', () => {
  it('mapeia cada evento ao estado-alvo', () => {
    expect(nextStatusForEvent('CHECKOUT_CONFIRMED')).toBe('ACTIVE');
    expect(nextStatusForEvent('PAYMENT_FAILED')).toBe('PAST_DUE');
    expect(nextStatusForEvent('SUBSCRIPTION_CANCELED')).toBe('CANCELED');
    expect(nextStatusForEvent('REFUNDED')).toBe('CANCELED');
  });
});

describe('SubscriptionService.startTrial (US-4.1)', () => {
  it('cria TRIALING quando não existe', async () => {
    const { svc, insert } = make(null);
    await svc.startTrial(USER);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'TRIALING', plan: 'MONTHLY', priceCents: 3900 }),
    );
  });

  it('é idempotente: assinatura existente não recria', async () => {
    const { svc, insert } = make(row());
    await svc.startTrial(USER);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('SubscriptionService.applyGatewayEvent (US-4.1)', () => {
  it('checkout confirmado: TRIALING → ACTIVE com plano/preço/período', async () => {
    const { svc, patch } = make(row({ status: 'TRIALING' }));
    const res = await svc.applyGatewayEvent(evt());
    expect(res.status).toBe('ACTIVE');
    expect(patch).toHaveBeenCalledWith(
      USER,
      's1',
      expect.objectContaining({
        status: 'ACTIVE',
        plan: 'QUARTERLY',
        priceCents: 9900,
        externalSubscriptionId: 'sub_1',
      }),
    );
  });

  it('replay do mesmo checkout já ativo → idempotente (não repatch)', async () => {
    const { svc, patch } = make(row({ status: 'ACTIVE', externalSubscriptionId: 'sub_1' }));
    const res = await svc.applyGatewayEvent(evt({ externalSubscriptionId: 'sub_1' }));
    expect(res.status).toBe('IDEMPOTENT');
    expect(patch).not.toHaveBeenCalled();
  });

  it('pagamento falho: ACTIVE → PAST_DUE', async () => {
    const { svc, patch } = make(row({ status: 'ACTIVE', externalSubscriptionId: 'sub_1' }));
    const res = await svc.applyGatewayEvent(evt({ type: 'PAYMENT_FAILED' }));
    expect(res.status).toBe('PAST_DUE');
    expect(patch).toHaveBeenCalled();
  });

  it('transição inválida é rejeitada (CANCELED terminal não reativa)', async () => {
    const { svc } = make(row({ status: 'CANCELED' }));
    await expect(svc.applyGatewayEvent(evt())).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it('evento sem assinatura → NO_SUBSCRIPTION', async () => {
    const { svc } = make(null);
    expect((await svc.applyGatewayEvent(evt())).status).toBe('NO_SUBSCRIPTION');
  });
});

describe('SubscriptionService.cancel/pause (US-4.1)', () => {
  it('cancela e sincroniza com o gateway quando há externalSubscriptionId', async () => {
    const { svc, patch, cancelSubscription } = make(
      row({ status: 'ACTIVE', externalSubscriptionId: 'sub_1' }),
    );
    await svc.cancel(USER, 'muito caro');
    expect(cancelSubscription).toHaveBeenCalledWith('sub_1');
    expect(patch).toHaveBeenCalledWith(
      USER,
      's1',
      expect.objectContaining({ status: 'CANCELED', cancelReason: 'muito caro' }),
    );
  });

  it('pausa ACTIVE → PAUSED', async () => {
    const { svc, patch } = make(row({ status: 'ACTIVE' }));
    expect((await svc.pause(USER)).status).toBe('PAUSED');
    expect(patch).toHaveBeenCalledWith(USER, 's1', { status: 'PAUSED' });
  });

  it('pausa inválida (TRIALING → PAUSED) é rejeitada', async () => {
    const { svc } = make(row({ status: 'TRIALING' }));
    await expect(svc.pause(USER)).rejects.toBeInstanceOf(InvalidTransitionError);
  });
});
