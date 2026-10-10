import { describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../../core/config';
import type { SubscriptionRow } from '../../core/database/schema';
import type { PaymentGateway, PaymentStartResult } from './payment/payment-gateway.types';
import type { GatewayEvent } from './payment/payment-gateway.types';
import { InvalidTransitionError } from './subscription-model';
import { nextStatusForEvent, SubscriptionService } from './subscription.service';
import type { SubscriptionRepository } from './subscription.repository';

const USER = '11111111-1111-4111-8111-111111111111';

const PAYER = {
  name: 'Pessoa Teste',
  email: 'teste@movivo.test',
  cpfCnpj: '11144477735',
  postalCode: '01310100',
  addressNumber: '100',
  phone: '11999999999',
};

const DAY_MS = 24 * 60 * 60 * 1000;

function row(over: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: 's1',
    userId: USER,
    plan: 'MONTHLY',
    priceCents: 7990,
    monthlyPriceCents: 7990,
    totalPriceCents: 7990,
    commitmentMonths: 1,
    currency: 'BRL',
    status: 'TRIALING',
    paymentProvider: null,
    externalSubscriptionId: null,
    externalCustomerId: null,
    externalCheckoutSessionId: null,
    checkoutUrl: null,
    externalPriceId: null,
    externalPaymentId: null,
    externalInstallmentId: null,
    externalAuthorizationId: null,
    paymentMethod: null,
    installmentCount: null,
    authorizedPaymentCount: null,
    paymentAttempt: 0,
    activatedAt: null,
    trialStartedAt: new Date(),
    trialEndsAt: new Date(),
    currentPeriodStart: null,
    currentPeriodEnd: null,
    nextBillingAt: null,
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
  const patch = vi.fn(
    (_userId: string, _id: string, _values: Partial<SubscriptionRow>, _transition?: unknown) =>
      Promise.resolve(),
  );
  const insert = vi.fn((v: unknown) => Promise.resolve(row(v as Partial<SubscriptionRow>)));
  const repo = {
    findByUserId: vi.fn(() => Promise.resolve(current)),
    findFirstName: vi.fn(() => Promise.resolve('Ana')),
    insert,
    patch,
  } as unknown as SubscriptionRepository;
  const cancelContract = vi.fn(() => Promise.resolve());
  const startPayment = vi.fn((): Promise<PaymentStartResult> =>
    Promise.resolve({
      status: 'PENDING' as const,
      externalCustomerId: 'cus_1',
      externalSubscriptionId: 'sub_1',
    }),
  );
  const refundContract = vi.fn((..._args: unknown[]) => Promise.resolve());
  const gateway = {
    name: gatewayName,
    cancelContract,
    refundContract,
    startPayment,
  } as unknown as PaymentGateway;
  const config = {
    whatsapp: { publicSiteUrl: 'https://movivo.test' },
    payment: {
      pastDueGraceDays: 3,
      provider: gatewayName,
    },
  } as unknown as AppConfigService;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() } as never;
  const checkoutTokens = {
    issue: vi.fn(() => ({ token: 'opaque-token', expiresAt: new Date() })),
  } as never;
  const set = vi.fn((): Promise<string | null> => Promise.resolve('OK'));
  const evalLock = vi.fn(() => Promise.resolve(1));
  const redis = { set, eval: evalLock } as never;
  const keys = { forUser: vi.fn(() => 'movivo:u:test:payment:start-lock') } as never;
  const createShortLink = vi.fn((_target: string, _expiresAt: Date) => Promise.resolve('aB3xK9pQ'));
  const shortLinks = { create: createShortLink } as never;
  return {
    svc: new SubscriptionService(
      repo,
      gateway,
      config,
      logger,
      checkoutTokens,
      redis,
      keys,
      shortLinks,
      {
        issue: vi.fn(async () => ({
          token: 'portal-token',
          expiresAt: new Date(Date.now() + 365 * 86400000),
        })),
      } as never,
    ),
    createShortLink,
    patch,
    insert,
    cancelContract,
    refundContract,
    startPayment,
    set,
    evalLock,
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
    expect(nextStatusForEvent('AUTHORIZATION_ACTIVE')).toBe('ACTIVE');
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
    const { svc, patch } = make(
      row({
        status: 'TRIALING',
        plan: 'QUARTERLY',
        priceCents: 22770,
        monthlyPriceCents: 7590,
        totalPriceCents: 22770,
        commitmentMonths: 3,
      }),
    );
    const res = await svc.applyGatewayEvent(evt());
    expect(res.status).toBe('ACTIVE');
    expect(patch).toHaveBeenCalledWith(
      USER,
      's1',
      expect.objectContaining({
        status: 'ACTIVE',
        plan: 'QUARTERLY',
        priceCents: 22770,
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

  it('não suspende acesso por falha entregue depois de uma atualização mais nova', async () => {
    const { svc, patch } = make(
      row({ status: 'ACTIVE', updatedAt: new Date('2026-09-23T12:00:00Z') }),
    );
    const res = await svc.applyGatewayEvent(
      evt({ type: 'PAYMENT_FAILED', occurredAt: '2026-09-23T11:59:00Z' }),
    );
    expect(res.status).toBe('STALE_EVENT');
    expect(patch).not.toHaveBeenCalled();
  });

  it('transição inválida é rejeitada (CANCELED terminal não reativa)', async () => {
    const { svc } = make(row({ status: 'CANCELED', plan: 'QUARTERLY' }));
    await expect(svc.applyGatewayEvent(evt())).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it('evento sem assinatura → NO_SUBSCRIPTION', async () => {
    const { svc } = make(null);
    expect((await svc.applyGatewayEvent(evt())).status).toBe('NO_SUBSCRIPTION');
  });

  it('cancelamento de contrato substituído não derruba o contrato novo', async () => {
    // Pix regenerado: a linha já aponta para `pay_new`; o Asaas avisa da autorização antiga.
    const { svc, patch } = make(
      row({ status: 'PENDING_PAYMENT', paymentMethod: 'PIX', externalPaymentId: 'pay_new' }),
    );
    const res = await svc.applyGatewayEvent(
      evt({
        type: 'SUBSCRIPTION_CANCELED',
        externalSubscriptionId: 'pay_old',
        externalPaymentId: 'pay_old',
      }),
    );
    expect(res.status).toBe('STALE_CONTRACT');
    expect(patch).not.toHaveBeenCalled();
  });

  it('confirmação de contrato substituído ainda ativa: quem pagou o QR antigo pagou', async () => {
    const { svc, patch } = make(
      row({ status: 'PENDING_PAYMENT', paymentMethod: 'PIX', externalPaymentId: 'pay_new' }),
    );
    const res = await svc.applyGatewayEvent(
      evt({ plan: 'MONTHLY', externalSubscriptionId: 'pay_old', externalPaymentId: 'pay_old' }),
    );
    expect(res.status).toBe('ACTIVE');
    expect(patch).toHaveBeenCalled();
  });

  it('primeira cobrança não liquidada segue PENDING_PAYMENT, sem carência de PAST_DUE', async () => {
    const { svc, patch } = make(
      row({ status: 'PENDING_PAYMENT', paymentMethod: 'PIX', externalPaymentId: 'pay_1' }),
    );
    const res = await svc.applyGatewayEvent(
      evt({ type: 'PAYMENT_FAILED', externalSubscriptionId: 'pay_1', externalPaymentId: 'pay_1' }),
    );
    expect(res.status).toBe('PENDING_PAYMENT');
    expect(patch).not.toHaveBeenCalled();
    expect(await svc.getAccess(USER)).toBe('RESTRICTED');
  });

  it('renovação do cartão mensal estende o período pela competência', async () => {
    const periodEnd = new Date('2026-10-23T03:00:00.000Z');
    const { svc, patch } = make(
      row({
        status: 'ACTIVE',
        paymentMethod: 'CARD',
        externalSubscriptionId: 'sub_1',
        externalPaymentId: 'pay_1',
        currentPeriodEnd: periodEnd,
      }),
    );
    const res = await svc.applyGatewayEvent(
      evt({ plan: 'MONTHLY', externalPaymentId: 'pay_2', dueDate: periodEnd.toISOString() }),
    );
    expect(res.status).toBe('RENEWED');
    expect(patch).toHaveBeenCalledWith(
      USER,
      's1',
      expect.objectContaining({
        status: 'ACTIVE',
        currentPeriodEnd: new Date('2026-11-23T03:00:00.000Z'),
        externalPaymentId: 'pay_2',
      }),
      { actor: 'SYSTEM', reason: 'CHECKOUT_CONFIRMED' },
    );
  });

  it('repasse tardio (RECEIVED) de um mês já coberto não estende o período', async () => {
    const { svc, patch } = make(
      row({
        status: 'ACTIVE',
        paymentMethod: 'CARD',
        externalSubscriptionId: 'sub_1',
        currentPeriodEnd: new Date('2026-11-23T03:00:00.000Z'),
      }),
    );
    const res = await svc.applyGatewayEvent(
      evt({ plan: 'MONTHLY', externalPaymentId: 'pay_1', dueDate: '2026-09-23T03:00:00.000Z' }),
    );
    expect(res.status).toBe('IDEMPOTENT');
    expect(patch).not.toHaveBeenCalled();
  });

  it('ativação do Pix Automático trimestral paga um mês, não o contrato inteiro', async () => {
    const { svc, patch } = make(
      row({
        status: 'PENDING_PAYMENT',
        plan: 'QUARTERLY',
        commitmentMonths: 3,
        paymentMethod: 'PIX_AUTOMATIC',
        externalAuthorizationId: 'aut_1',
      }),
    );
    await svc.applyGatewayEvent(
      evt({
        plan: 'QUARTERLY',
        externalSubscriptionId: 'pay_1',
        externalPaymentId: 'pay_1',
        dueDate: '2026-09-23T03:00:00.000Z',
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      USER,
      's1',
      expect.objectContaining({ currentPeriodEnd: new Date('2026-10-23T03:00:00.000Z') }),
      expect.anything(),
    );
  });

  it('estorno cancela e encerra o período pago na hora', async () => {
    const { svc, patch } = make(
      row({
        status: 'ACTIVE',
        paymentMethod: 'PIX',
        externalSubscriptionId: 'pay_1',
        externalPaymentId: 'pay_1',
        currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS),
      }),
    );
    await svc.applyGatewayEvent(
      evt({ type: 'REFUNDED', externalSubscriptionId: 'pay_1', externalPaymentId: 'pay_1' }),
    );
    const values = patch.mock.calls[0]?.[2];
    expect(values?.status).toBe('CANCELED');
    expect(values?.currentPeriodEnd?.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe('SubscriptionService.expirePeriod (fim do período pago)', () => {
  const end = new Date('2026-10-23T03:00:00.000Z');

  it('cobrança única expira no fim exato do período', async () => {
    const { svc, patch } = make(
      row({ status: 'ACTIVE', plan: 'QUARTERLY', paymentMethod: 'PIX', currentPeriodEnd: end }),
    );
    expect((await svc.expirePeriod(USER, new Date(end.getTime() + 1))).status).toBe('EXPIRED');
    expect(patch).toHaveBeenCalledWith(
      USER,
      's1',
      { status: 'EXPIRED' },
      { actor: 'SYSTEM', reason: 'PERIOD_ENDED' },
    );
  });

  it('recorrente espera a janela de graça pelo webhook da renovação', async () => {
    const recurring = row({ status: 'ACTIVE', paymentMethod: 'CARD', currentPeriodEnd: end });
    const early = make(recurring);
    expect((await early.svc.expirePeriod(USER, new Date(end.getTime() + DAY_MS))).status).toBe(
      'PERIOD_NOT_ENDED',
    );
    expect(early.patch).not.toHaveBeenCalled();

    const late = make(recurring);
    expect((await late.svc.expirePeriod(USER, new Date(end.getTime() + 4 * DAY_MS))).status).toBe(
      'EXPIRED',
    );
  });

  it('não mexe em quem não está ACTIVE nem em período vigente', async () => {
    const canceled = make(row({ status: 'CANCELED', currentPeriodEnd: end }));
    expect((await canceled.svc.expirePeriod(USER, new Date(end.getTime() + DAY_MS))).status).toBe(
      'SKIP_CANCELED',
    );
    const running = make(row({ status: 'ACTIVE', paymentMethod: 'PIX', currentPeriodEnd: end }));
    expect((await running.svc.expirePeriod(USER, new Date(end.getTime() - 1))).status).toBe(
      'PERIOD_NOT_ENDED',
    );
    expect(canceled.patch).not.toHaveBeenCalled();
    expect(running.patch).not.toHaveBeenCalled();
  });
});

describe('SubscriptionService checkout transparente / getAccess (US-4.2)', () => {
  it('gera link opaco sem criar cobrança', async () => {
    const { svc, startPayment } = make(row({ status: 'TRIALING', plan: 'ANNUAL' }));
    await expect(svc.createCheckoutLink(USER)).resolves.toBe(
      'https://movivo.test/assinar/opaque-token',
    );
    expect(startPayment).not.toHaveBeenCalled();
  });

  it('gera o checkout curto: /checkout/<código> aponta para o link opaco, com a validade do token', async () => {
    const { svc, createShortLink } = make(row({ status: 'EXPIRED', plan: 'ANNUAL' }));
    await expect(svc.createShortCheckoutLink(USER)).resolves.toBe(
      'https://movivo.test/checkout/aB3xK9pQ',
    );
    expect(createShortLink).toHaveBeenCalledWith(
      'https://movivo.test/assinar/opaque-token',
      expect.any(Date),
    );
  });

  it('gera o cancelamento curto: /cancelar/<código> aponta para o portal do titular, por 365 dias', async () => {
    const { svc, createShortLink } = make(row({ status: 'EXPIRED', plan: 'ANNUAL' }));
    await expect(svc.createShortCancelLink(USER)).resolves.toBe(
      'https://movivo.test/cancelar/aB3xK9pQ',
    );
    const [target, expiresAt] = createShortLink.mock.calls[0] ?? [];
    expect(target).toBe('https://movivo.test/conta/portal-token');
    const days = ((expiresAt as Date).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(364);
    expect(days).toBeLessThanOrEqual(365);
  });

  it('monta o aviso de fim de plano com nome, plano e os dois links curtos', async () => {
    const { svc } = make(
      row({
        status: 'EXPIRED',
        plan: 'QUARTERLY',
        currentPeriodEnd: new Date('2026-10-23T12:00:00Z'),
      }),
    );
    await expect(svc.periodEndedNotice(USER)).resolves.toEqual({
      firstName: 'Ana',
      planLabel: 'Trimestral',
      periodEnd: new Date('2026-10-23T12:00:00Z'),
      checkoutUrl: 'https://movivo.test/checkout/aB3xK9pQ',
      cancelUrl: 'https://movivo.test/cancelar/aB3xK9pQ',
    });
  });

  it('sem assinatura não há aviso de fim de plano', async () => {
    await expect(make(null).svc.periodEndedNotice(USER)).resolves.toBeNull();
  });

  it('cobra sempre o snapshot persistido e marca PENDING_PAYMENT', async () => {
    const { svc, patch, startPayment } = make(
      row({
        status: 'TRIALING',
        plan: 'ANNUAL',
        priceCents: 81480,
        monthlyPriceCents: 6790,
        totalPriceCents: 81480,
        commitmentMonths: 12,
      }),
    );
    const result = await svc.startCheckoutPayment(
      USER,
      {
        method: 'PIX',
        payer: {
          name: 'Pessoa Teste',
          email: 'teste@movivo.test',
          cpfCnpj: '11144477735',
          postalCode: '01310100',
          addressNumber: '100',
          phone: '11999999999',
        },
        acceptTerms: true,
      },
      '127.0.0.1',
    );
    expect(result.status).toBe('PENDING');
    expect(startPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: 'ANNUAL',
        monthlyCents: 6790,
        totalCents: 81480,
        method: 'PIX',
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      USER,
      's1',
      expect.objectContaining({ status: 'PENDING_PAYMENT', paymentMethod: 'PIX' }),
    );
  });

  it('oferece Pix e cartão hospedado (Asaas), nunca Pix Automático', async () => {
    const { svc, startPayment } = make(row(), 'ASAAS');
    const summary = await svc.getCheckoutSummary(USER, Date.now() + DAY_MS);
    expect(summary?.methods).toEqual(['CARD', 'PIX']);
    expect(summary?.hostedCard).toBe(true);
    await expect(
      svc.startCheckoutPayment(
        USER,
        { method: 'PIX_AUTOMATIC', payer: PAYER, acceptTerms: true },
        '127.0.0.1',
      ),
    ).rejects.toThrow('não está disponível');
    expect(startPayment).not.toHaveBeenCalled();
  });

  it('exige os dados do pagador: o Checkout hospedado abre com o cliente já cadastrado', async () => {
    const { svc, startPayment } = make(row(), 'ASAAS');
    await expect(
      svc.startCheckoutPayment(
        USER,
        { method: 'CARD', installments: 1, acceptTerms: true } as never,
        '127.0.0.1',
      ),
    ).rejects.toThrow('Dados do pagador ausentes');
    expect(startPayment).not.toHaveBeenCalled();
  });

  it('inicia cartão hospedado e persiste sessão e link do Checkout para conciliação', async () => {
    const { svc, startPayment, patch } = make(row(), 'ASAAS');
    startPayment.mockResolvedValueOnce({
      status: 'PENDING',
      externalCustomerId: 'cus_1',
      externalCheckoutSessionId: 'chk_1',
      checkoutUrl: 'https://sandbox.asaas.com/000/checkoutSession/show/chk_1',
    });
    const result = await svc.startCheckoutPayment(
      USER,
      { method: 'CARD', payer: PAYER, installments: 1, acceptTerms: true },
      '127.0.0.1',
    );
    expect(startPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'CARD',
        payer: PAYER,
        returnUrl: expect.stringContaining('/assinar/'),
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      USER,
      's1',
      expect.objectContaining({
        externalCheckoutSessionId: 'chk_1',
        checkoutUrl: 'https://sandbox.asaas.com/000/checkoutSession/show/chk_1',
        status: 'PENDING_PAYMENT',
      }),
    );
    expect(result.checkoutUrl).toBe('https://sandbox.asaas.com/000/checkoutSession/show/chk_1');
  });

  it('volta ao mesmo Checkout em retentativa, sem abrir uma segunda sessão', async () => {
    const pending = row({
      status: 'PENDING_PAYMENT',
      paymentMethod: 'CARD',
      externalCheckoutSessionId: 'chk_1',
      checkoutUrl: 'https://sandbox.asaas.com/000/checkoutSession/show/chk_1',
    });
    const { svc, startPayment } = make(pending, 'ASAAS');
    const result = await svc.startCheckoutPayment(
      USER,
      { method: 'CARD', payer: PAYER, installments: 1, acceptTerms: true },
      '127.0.0.1',
    );
    expect(result.checkoutUrl).toBe('https://sandbox.asaas.com/000/checkoutSession/show/chk_1');
    expect(startPayment).not.toHaveBeenCalled();
  });

  it('nunca repassa ao navegador um link que não seja https do Asaas', async () => {
    const pending = row({
      status: 'PENDING_PAYMENT',
      paymentMethod: 'CARD',
      externalCheckoutSessionId: 'chk_1',
      checkoutUrl: 'https://evil.example/pay',
    });
    const { svc } = make(pending, 'ASAAS');
    const summary = await svc.getCheckoutSummary(USER, Date.now() + DAY_MS);
    expect(summary?.checkoutUrl).toBeUndefined();
  });

  describe('recompra depois de cancelar', () => {
    const PIX_BODY = { method: 'PIX' as const, payer: PAYER, acceptTerms: true as const };

    it('bloqueia enquanto o acesso pago do cancelamento ainda vale', async () => {
      const end = new Date(Date.now() + 10 * DAY_MS);
      const { svc, startPayment } = make(
        row({ status: 'CANCELED', paymentMethod: 'PIX', currentPeriodEnd: end }),
      );
      await expect(svc.startCheckoutPayment(USER, PIX_BODY, '127.0.0.1')).rejects.toThrow(
        /acesso pago vigente/,
      );
      expect(startPayment).not.toHaveBeenCalled();
      const summary = await svc.getCheckoutSummary(USER, Date.now() + DAY_MS);
      expect(summary?.repurchaseAt).toBe(end.toISOString());
    });

    it('depois do fim do acesso, abre contrato novo sem herdar o período antigo', async () => {
      const ended = new Date(Date.now() - 1 * DAY_MS);
      const { svc, patch, startPayment } = make(
        row({
          status: 'CANCELED',
          paymentMethod: 'PIX',
          externalPaymentId: 'pay_old',
          currentPeriodStart: new Date(Date.now() - 31 * DAY_MS),
          currentPeriodEnd: ended,
          activatedAt: new Date(Date.now() - 31 * DAY_MS),
          canceledAt: ended,
          cancelReason: 'x',
        }),
      );
      await svc.startCheckoutPayment(USER, PIX_BODY, '127.0.0.1');
      expect(startPayment).toHaveBeenCalledOnce();
      const reopen = patch.mock.calls.find(([, , values]) => values.status === 'PENDING_PAYMENT');
      expect(reopen?.[2]).toMatchObject({
        currentPeriodStart: null,
        currentPeriodEnd: null,
        activatedAt: null,
        canceledAt: null,
        cancelReason: null,
      });
    });
  });

  describe('arrependimento (CDC art. 49)', () => {
    const FIRST_PAY = new Date(Date.now() - 2 * DAY_MS);
    const paid = (over: Partial<SubscriptionRow> = {}) =>
      row({
        status: 'ACTIVE',
        paymentMethod: 'PIX',
        plan: 'ANNUAL',
        externalPaymentId: 'pay_1',
        activatedAt: FIRST_PAY,
        currentPeriodEnd: new Date(Date.now() + 360 * DAY_MS),
        ...over,
      });

    it('estorna dentro de 7 dias, encerra o acesso e registra o motivo', async () => {
      const { svc, refundContract, patch } = make(paid());
      await expect(svc.requestRefund(USER)).resolves.toEqual({ status: 'REFUNDED' });
      expect(refundContract).toHaveBeenCalledWith(
        { installmentId: null, paymentId: 'pay_1' },
        expect.stringContaining('art. 49'),
      );
      expect(patch).toHaveBeenCalledWith(
        USER,
        's1',
        expect.objectContaining({ status: 'CANCELED', cancelReason: 'ARREPENDIMENTO' }),
        expect.objectContaining({ actor: 'USER' }),
      );
    });

    it('mensal no cartão interrompe a cobrança futura ANTES de estornar', async () => {
      const order: string[] = [];
      const { svc, cancelContract, refundContract } = make(
        paid({ paymentMethod: 'CARD', plan: 'MONTHLY', externalSubscriptionId: 'sub_1' }),
      );
      cancelContract.mockImplementation(() => {
        order.push('cancel');
        return Promise.resolve();
      });
      refundContract.mockImplementation(() => {
        order.push('refund');
        return Promise.resolve();
      });
      await svc.requestRefund(USER);
      expect(order).toEqual(['cancel', 'refund']);
    });

    it('estorno recusado pelo gateway vira pendência manual, sem perder o cancelamento', async () => {
      const { svc, refundContract, patch } = make(paid());
      refundContract.mockRejectedValueOnce(new Error('saldo insuficiente'));
      await expect(svc.requestRefund(USER)).resolves.toEqual({ status: 'PENDING_MANUAL' });
      expect(patch).toHaveBeenCalledWith(
        USER,
        's1',
        expect.objectContaining({
          status: 'CANCELED',
          cancelReason: 'ARREPENDIMENTO_ESTORNO_PENDENTE',
        }),
        expect.anything(),
      );
    });

    it('não estorna fora do prazo, em trial ou sem pagamento identificável', async () => {
      const old = new Date(Date.now() - 8 * DAY_MS);
      for (const sub of [
        paid({ activatedAt: old }),
        row({ status: 'TRIALING' }),
        paid({ externalPaymentId: null, externalInstallmentId: null }),
        paid({ currentPeriodEnd: new Date(Date.now() - 1000) }),
      ]) {
        const { svc, refundContract } = make(sub);
        await expect(svc.requestRefund(USER)).rejects.toThrow(/prazo de arrependimento/);
        expect(refundContract).not.toHaveBeenCalled();
      }
    });

    it('o webhook de estorno baixa a pendência manual e não mexe no acesso', async () => {
      const pending = paid({
        status: 'CANCELED',
        cancelReason: 'ARREPENDIMENTO_ESTORNO_PENDENTE',
        currentPeriodEnd: new Date(Date.now() - 1000),
      });
      const { svc, patch } = make(pending);
      const result = await svc.applyGatewayEvent({
        type: 'REFUNDED',
        eventId: 'evt_ref',
        externalSubscriptionId: 'x',
        externalPaymentId: 'pay_1',
        userId: USER,
      });
      expect(result.status).toBe('IDEMPOTENT');
      expect(patch).toHaveBeenCalledWith(USER, 's1', { cancelReason: 'ARREPENDIMENTO' });
    });

    it('o portal informa até quando o estorno é possível', async () => {
      const { svc } = make(paid());
      const view = await svc.getView(USER);
      expect(view?.refundEligibleUntil).toBe(
        new Date(FIRST_PAY.getTime() + 7 * DAY_MS).toISOString(),
      );
    });
  });

  it('cancelar duas vezes é idempotente e não toca no gateway de novo', async () => {
    const { svc, cancelContract, patch } = make(row({ status: 'CANCELED' }));
    await expect(svc.cancel(USER)).resolves.toEqual({ status: 'CANCELED' });
    expect(cancelContract).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  describe('troca de plano no checkout', () => {
    const body = {
      method: 'PIX' as const,
      payer: {
        name: 'Pessoa Teste',
        email: 'teste@movivo.test',
        cpfCnpj: '11144477735',
        postalCode: '01310100',
        addressNumber: '100',
        phone: '11999999999',
      },
      acceptTerms: true as const,
    };

    it('persiste o plano escolhido com o preço do catálogo e cobra por ele, não pelo da landing', async () => {
      const { svc, patch, startPayment } = make(
        row({
          status: 'TRIALING',
          plan: 'ANNUAL',
          priceCents: 81480,
          monthlyPriceCents: 6790,
          totalPriceCents: 81480,
          commitmentMonths: 12,
        }),
      );
      await svc.startCheckoutPayment(USER, { ...body, plan: 'QUARTERLY' }, '127.0.0.1');

      expect(patch).toHaveBeenNthCalledWith(1, USER, 's1', {
        plan: 'QUARTERLY',
        priceCents: 22770,
        monthlyPriceCents: 7590,
        totalPriceCents: 22770,
        commitmentMonths: 3,
      });
      expect(startPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: 'QUARTERLY',
          monthlyCents: 7590,
          totalCents: 22770,
          months: 3,
        }),
      );
    });

    it('sem plano no body (ou o mesmo plano) não regrava o contrato', async () => {
      const { svc, patch } = make(row({ status: 'TRIALING', plan: 'ANNUAL' }));
      await svc.startCheckoutPayment(USER, { ...body, plan: 'ANNUAL' }, '127.0.0.1');
      await svc.startCheckoutPayment(USER, body, '127.0.0.1');

      const planWrites = patch.mock.calls.filter(([, , values]) => 'plan' in values);
      expect(planWrites).toHaveLength(0);
    });

    it('rejeita parcelamento acima do período do plano escolhido', async () => {
      const { svc, startPayment } = make(row({ status: 'TRIALING', plan: 'ANNUAL' }));
      await expect(
        svc.startCheckoutPayment(
          USER,
          {
            method: 'CARD',
            payer: body.payer,
            installments: 12,
            acceptTerms: true,
            plan: 'QUARTERLY',
          },
          '127.0.0.1',
        ),
      ).rejects.toThrow(/parcelas incompatível/);
      expect(startPayment).not.toHaveBeenCalled();
    });

    it('trocar o plano com um Pix pendente abre contrato novo em vez de reaproveitar o QR antigo', async () => {
      const { svc, startPayment, cancelContract } = make(
        row({
          status: 'PENDING_PAYMENT',
          plan: 'ANNUAL',
          paymentMethod: 'PIX',
          paymentAttempt: 0,
          externalPaymentId: 'pay_old',
        }),
      );
      await svc.startCheckoutPayment(USER, { ...body, plan: 'MONTHLY' }, '127.0.0.1');

      expect(cancelContract).toHaveBeenCalled();
      expect(startPayment).toHaveBeenCalledWith(
        expect.objectContaining({ plan: 'MONTHLY', idempotencyKey: 's1:1' }),
      );
    });
  });

  it('serializa o início do pagamento e não chama o gateway quando outro request tem o lock', async () => {
    const { svc, set, startPayment } = make(row());
    set.mockResolvedValueOnce(null);
    await expect(
      svc.startCheckoutPayment(
        USER,
        {
          method: 'PIX',
          payer: {
            name: 'Pessoa Teste',
            email: 'teste@movivo.test',
            cpfCnpj: '11144477735',
            postalCode: '01310100',
            addressNumber: '100',
            phone: '11999999999',
          },
          acceptTerms: true,
        },
        '127.0.0.1',
      ),
    ).rejects.toThrow(/pagamento sendo iniciado/);
    expect(startPayment).not.toHaveBeenCalled();
  });

  it('regenera Pix desvinculando e cancelando a referência anterior, com tentativa nova', async () => {
    const { svc, cancelContract, patch, startPayment } = make(
      row({
        status: 'PENDING_PAYMENT',
        paymentMethod: 'PIX',
        externalPaymentId: 'pay_old',
        paymentAttempt: 2,
      }),
    );
    await svc.startCheckoutPayment(
      USER,
      { method: 'PIX', payer: PAYER, acceptTerms: true, regenerate: true },
      '127.0.0.1',
    );
    expect(cancelContract).toHaveBeenCalledWith({ paymentId: 'pay_old' });
    // Desvincula ANTES de cancelar: o `PAYMENT_DELETED`/`..._CANCELLED` que o cancelamento
    // dispara já encontra a linha sem o ID antigo e não derruba o contrato novo.
    const detach = patch.mock.calls.findIndex(([, , values]) => values.externalPaymentId === null);
    expect(detach).toBeGreaterThanOrEqual(0);
    expect(patch.mock.invocationCallOrder[detach]).toBeLessThan(
      cancelContract.mock.invocationCallOrder[0] ?? 0,
    );
    expect(startPayment).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 's1:3' }));
    expect(patch).toHaveBeenCalledWith(USER, 's1', expect.objectContaining({ paymentAttempt: 3 }));
  });

  it('troca de Pix para cartão cancela o Pix pendente e abre contrato novo', async () => {
    const { svc, cancelContract, startPayment } = make(
      row({
        status: 'PENDING_PAYMENT',
        plan: 'QUARTERLY',
        commitmentMonths: 3,
        paymentMethod: 'PIX',
        externalPaymentId: 'pay_pix',
      }),
    );
    await svc.startCheckoutPayment(
      USER,
      { method: 'CARD', payer: PAYER, installments: 3, acceptTerms: true },
      '127.0.0.1',
    );
    expect(cancelContract).toHaveBeenCalledWith({ paymentId: 'pay_pix' });
    // Referência nova: o parcelamento nunca reencontra a cobrança Pix antiga.
    expect(startPayment).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'CARD', idempotencyKey: 's1:1' }),
    );
  });

  it('retentativa do mesmo contrato pendente reaproveita a referência, sem cancelar', async () => {
    const { svc, cancelContract, startPayment } = make(
      row({ status: 'PENDING_PAYMENT', paymentMethod: 'PIX', externalPaymentId: 'pay_1' }),
    );
    await svc.startCheckoutPayment(
      USER,
      { method: 'PIX', payer: PAYER, acceptTerms: true },
      '127.0.0.1',
    );
    expect(cancelContract).not.toHaveBeenCalled();
    expect(startPayment).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 's1:0' }));
  });

  it('falha ao cancelar o contrato anterior restaura o vínculo e não abre outro', async () => {
    const { svc, cancelContract, startPayment, patch } = make(
      row({
        status: 'PENDING_PAYMENT',
        paymentMethod: 'PIX',
        externalPaymentId: 'pay_old',
        paymentAttempt: 1,
      }),
    );
    cancelContract.mockRejectedValueOnce(new Error('Asaas indisponível'));
    await expect(
      svc.startCheckoutPayment(
        USER,
        { method: 'PIX', payer: PAYER, acceptTerms: true, regenerate: true },
        '127.0.0.1',
      ),
    ).rejects.toThrow(/indisponível/);
    expect(startPayment).not.toHaveBeenCalled();
    expect(patch).toHaveBeenLastCalledWith(
      USER,
      's1',
      expect.objectContaining({ externalPaymentId: 'pay_old', paymentAttempt: 1 }),
    );
  });

  it('parcelas inválidas são recusadas antes de mexer no contrato anterior', async () => {
    const { svc, cancelContract } = make(
      row({ status: 'PENDING_PAYMENT', paymentMethod: 'PIX', externalPaymentId: 'pay_1' }),
    );
    await expect(
      svc.startCheckoutPayment(
        USER,
        { method: 'CARD', payer: PAYER, installments: 3, acceptTerms: true },
        '127.0.0.1',
      ),
    ).rejects.toThrow(/parcelas/);
    expect(cancelContract).not.toHaveBeenCalled();
  });

  it('nova compra depois do período expirado usa referência nova sem cancelar o contrato pago', async () => {
    const { svc, cancelContract, startPayment } = make(
      row({
        status: 'EXPIRED',
        plan: 'QUARTERLY',
        commitmentMonths: 3,
        paymentMethod: 'PIX',
        externalSubscriptionId: 'pay_paid',
        externalPaymentId: 'pay_paid',
      }),
    );
    await svc.startCheckoutPayment(
      USER,
      { method: 'PIX', payer: PAYER, acceptTerms: true },
      '127.0.0.1',
    );
    expect(cancelContract).not.toHaveBeenCalled();
    expect(startPayment).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 's1:1' }));
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
    const { svc, patch, cancelContract } = make(
      row({ status: 'ACTIVE', externalSubscriptionId: 'sub_1' }),
    );
    await svc.cancel(USER, 'muito caro');
    expect(cancelContract).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: 'sub_1' }),
    );
    expect(patch).toHaveBeenCalledWith(
      USER,
      's1',
      expect.objectContaining({ status: 'CANCELED', cancelReason: 'muito caro' }),
      { actor: 'USER', reason: 'muito caro' },
    );
  });

  it('plano longo já pago no cartão: cancela sem chamar o Asaas e mantém o período pago', async () => {
    const { svc, cancelContract, patch } = make(
      row({
        status: 'ACTIVE',
        plan: 'ANNUAL',
        paymentMethod: 'CARD',
        // Após a ativação o id do parcelamento também ocupa `externalSubscriptionId`.
        externalSubscriptionId: 'ins_1',
        externalInstallmentId: 'ins_1',
        currentPeriodEnd: new Date(Date.now() + 200 * DAY_MS),
      }),
    );
    await svc.cancel(USER, 'mudei de rotina');
    expect(cancelContract).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      USER,
      's1',
      expect.objectContaining({ status: 'CANCELED' }),
      expect.anything(),
    );
    expect(patch.mock.calls[0]?.[2]).not.toHaveProperty('currentPeriodEnd');
  });

  it('cartão mensal cancela a assinatura Asaas pela referência exata', async () => {
    const { svc, cancelContract } = make(
      row({
        status: 'ACTIVE',
        paymentMethod: 'CARD',
        externalSubscriptionId: 'sub_1',
        externalPaymentId: 'pay_1',
      }),
    );
    await svc.cancel(USER);
    expect(cancelContract).toHaveBeenCalledWith({ subscriptionId: 'sub_1' });
  });

  it('Pix pendente cancela a cobrança, nunca `DELETE /subscriptions` com id de cobrança', async () => {
    const { svc, cancelContract } = make(
      row({ status: 'PENDING_PAYMENT', paymentMethod: 'PIX', externalPaymentId: 'pay_1' }),
    );
    await svc.cancel(USER);
    expect(cancelContract).toHaveBeenCalledWith({ paymentId: 'pay_1' });
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
