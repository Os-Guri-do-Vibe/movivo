import { describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../../core/config';
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
    externalCustomerId: null,
    externalCheckoutSessionId: null,
    externalPriceId: null,
    trialStartedAt: new Date(),
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
  const createCheckoutSession = vi.fn(() =>
    Promise.resolve({ checkoutUrl: 'https://mock/co', externalSessionId: 'cs_1' }),
  );
  const gateway = {
    name: gatewayName,
    cancelSubscription,
    createCheckoutSession,
  } as unknown as PaymentGateway;
  const config = {
    whatsapp: { publicSiteUrl: 'https://movivo.test' },
    payment: { pastDueGraceDays: 3 },
  } as unknown as AppConfigService;
  const logger = { info: vi.fn(), warn: vi.fn(), setContext: vi.fn() } as never;
  return {
    svc: new SubscriptionService(repo, gateway, config, logger),
    patch,
    insert,
    cancelSubscription,
    createCheckoutSession,
  };
}

function evt(over: Partial<GatewayEvent> = {}): GatewayEvent {
  return {
    type: 'CHECKOUT_CONFIRMED',
    eventId: 'e1',
    externalSubscriptionId: 'sub_1',
    userId: USER,
    plan: 'QUARTERLY',
    priceCents: 20370,
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
      expect.objectContaining({ status: 'TRIALING', plan: 'MONTHLY', priceCents: 7990 }),
    );
    const inserted = insert.mock.calls[0]?.[0] as Partial<SubscriptionRow>;
    expect(inserted.trialStartedAt).toBeInstanceOf(Date);
    if (!inserted.trialStartedAt || !inserted.trialEndsAt) throw new Error('trial sem datas');
    expect(inserted.trialEndsAt.getTime()).toBe(
      inserted.trialStartedAt.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
  });

  it('é idempotente: assinatura existente não recria', async () => {
    const { svc, insert } = make(row());
    await svc.startTrial(USER);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('SubscriptionService.expireTrial', () => {
  it('faz TRIALING → EXPIRED apenas depois de 7 dias', async () => {
    const ended = row({ status: 'TRIALING', trialEndsAt: new Date('2026-09-21T10:00:00Z') });
    const { svc, patch } = make(ended);
    expect((await svc.expireTrial(USER, new Date('2026-09-21T10:00:01Z'))).status).toBe('EXPIRED');
    expect(patch).toHaveBeenCalledWith(
      USER,
      's1',
      { status: 'EXPIRED' },
      { actor: 'SYSTEM', reason: 'TRIAL_ENDED' },
    );
  });

  it('não expira antes do prazo nem altera assinatura ativa', async () => {
    const futureTrial = make(
      row({ status: 'TRIALING', trialEndsAt: new Date('2026-09-22T10:00:00Z') }),
    );
    expect((await futureTrial.svc.expireTrial(USER, new Date('2026-09-22T09:59:59Z'))).status).toBe(
      'TRIAL_NOT_ENDED',
    );
    expect(futureTrial.patch).not.toHaveBeenCalled();

    const active = make(row({ status: 'ACTIVE' }));
    expect((await active.svc.expireTrial(USER)).status).toBe('SKIP_ACTIVE');
    expect(active.patch).not.toHaveBeenCalled();
  });
});

describe('SubscriptionService.applyGatewayEvent (US-4.1)', () => {
  it('checkout confirmado: TRIALING → ACTIVE com plano/preço/período', async () => {
    const { svc, patch } = make(row({ status: 'TRIALING', plan: 'QUARTERLY' }));
    const res = await svc.applyGatewayEvent(evt());
    expect(res.status).toBe('ACTIVE');
    expect(patch).toHaveBeenCalledWith(
      USER,
      's1',
      expect.objectContaining({
        status: 'ACTIVE',
        plan: 'QUARTERLY',
        priceCents: 20370,
        externalSubscriptionId: 'sub_1',
      }),
      // US-8.3: o repositório emite a transição de ciclo de vida; o ator vem daqui.
      { actor: 'SYSTEM', reason: 'CHECKOUT_CONFIRMED' },
    );
  });

  it('replay do mesmo checkout já ativo → idempotente (não repatch)', async () => {
    const { svc, patch } = make(
      row({ status: 'ACTIVE', plan: 'QUARTERLY', externalSubscriptionId: 'sub_1' }),
    );
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
    const { svc } = make(row({ status: 'CANCELED', plan: 'QUARTERLY' }));
    await expect(svc.applyGatewayEvent(evt())).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it('evento sem assinatura → NO_SUBSCRIPTION', async () => {
    const { svc } = make(null);
    expect((await svc.applyGatewayEvent(evt())).status).toBe('NO_SUBSCRIPTION');
  });
});

describe('SubscriptionService.createCheckout / getAccess (US-4.2)', () => {
  it('cria checkout hospedado com plano/preço/URLs sem antecipar o aceite de termos', async () => {
    const { svc, patch, createCheckoutSession } = make(row({ status: 'TRIALING', plan: 'ANNUAL' }));
    const cs = await svc.createCheckout(USER, 'ANNUAL', 'CARD', 'terms-v1');
    expect(cs.checkoutUrl).toBe('https://mock/co');
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: 'ANNUAL',
        priceCents: 71880,
        method: 'CARD',
        termsVersion: 'terms-v1',
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      USER,
      's1',
      expect.objectContaining({ plan: 'ANNUAL', termsVersion: 'terms-v1' }),
    );
    const patchValues = (patch.mock.calls[0] as unknown as [string, string, object])[2];
    expect(patchValues).not.toHaveProperty('termsAcceptedAt');
  });

  it('getAccess deriva o acesso do estado (ACTIVE → FULL)', async () => {
    const { svc } = make(row({ status: 'ACTIVE' }));
    expect(await svc.getAccess(USER)).toBe('FULL');
  });

  it('getAccess sem assinatura → RESTRICTED', async () => {
    const { svc } = make(null);
    expect(await svc.getAccess(USER)).toBe('RESTRICTED');
  });
});

describe('SubscriptionService.recordWinbackReason (US-4.4)', () => {
  it('grava o motivo declarado em cancelReason', async () => {
    const { svc, patch } = make(row({ status: 'TRIALING' }));
    const res = await svc.recordWinbackReason(USER, 'achei caro');
    expect(res.status).toBe('RECORDED');
    expect(patch).toHaveBeenCalledWith(USER, 's1', { cancelReason: 'achei caro' });
  });

  it('sem assinatura → NO_SUBSCRIPTION', async () => {
    const { svc } = make(null);
    expect((await svc.recordWinbackReason(USER, 'x')).status).toBe('NO_SUBSCRIPTION');
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
      { actor: 'USER', reason: 'muito caro' },
    );
  });

  it('pausa ACTIVE → PAUSED', async () => {
    const { svc, patch } = make(row({ status: 'ACTIVE' }));
    expect((await svc.pause(USER)).status).toBe('PAUSED');
    expect(patch).toHaveBeenCalledWith(USER, 's1', { status: 'PAUSED' }, { actor: 'USER' });
  });

  it('pausa inválida (TRIALING → PAUSED) é rejeitada', async () => {
    const { svc } = make(row({ status: 'TRIALING' }));
    await expect(svc.pause(USER)).rejects.toBeInstanceOf(InvalidTransitionError);
  });
});

describe('SubscriptionService.resume (US-4.5)', () => {
  it('retoma PAUSED → ACTIVE', async () => {
    const { svc, patch } = make(row({ status: 'PAUSED' }));
    expect((await svc.resume(USER)).status).toBe('ACTIVE');
    expect(patch).toHaveBeenCalledWith(USER, 's1', { status: 'ACTIVE' }, { actor: 'USER' });
  });

  it('retomar de CANCELED (terminal) é rejeitado', async () => {
    const { svc } = make(row({ status: 'CANCELED' }));
    await expect(svc.resume(USER)).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it('sem assinatura → NO_SUBSCRIPTION', async () => {
    const { svc } = make(null);
    expect((await svc.resume(USER)).status).toBe('NO_SUBSCRIPTION');
  });
});
