import { afterEach, describe, expect, it, vi } from 'vitest';

import { isIgnoredWebhookEvent, type StartPaymentInput } from './payment-gateway.types';
import { AsaasGateway } from './real-gateways';

const API = 'https://api-sandbox.asaas.com/v3';
const TOKEN = 'a'.repeat(32);
const USER = '11111111-1111-4111-8111-111111111111';

function input(overrides: Partial<StartPaymentInput> = {}): StartPaymentInput {
  return {
    subscriptionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    userId: USER,
    plan: 'MONTHLY',
    monthlyCents: 7990,
    totalCents: 7990,
    months: 1,
    method: 'CARD',
    installments: 1,
    payer: {
      name: 'Pessoa Sandbox',
      email: 'sandbox@movivo.test',
      cpfCnpj: '11144477735',
      postalCode: '01310100',
      addressNumber: '100',
      phone: '11999999999',
    },
    card: {
      holderName: 'PESSOA SANDBOX',
      number: '4111111111111111',
      expiryMonth: '12',
      expiryYear: '2030',
      ccv: '123',
    },
    remoteIp: '127.0.0.1',
    termsVersion: 'terms-v1',
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('AsaasGateway — operações Sandbox', () => {
  it('só declara credenciais quando chave e token estão presentes', () => {
    expect(new AsaasGateway('sandbox-key', TOKEN, API).hasCredentials()).toBe(true);
    expect(new AsaasGateway(undefined, TOKEN, API).hasCredentials()).toBe(false);
    expect(new AsaasGateway('sandbox-key', undefined, API).hasCredentials()).toBe(false);
  });

  it('cria assinatura mensal no cartão sem devolver PAN/CVV', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [{ id: 'cus_1' }] }))
      .mockResolvedValueOnce(json({ data: [] }))
      .mockResolvedValueOnce(json({ id: 'sub_1', status: 'PENDING', nextDueDate: '2026-09-24' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AsaasGateway('sandbox-key', TOKEN, API).startPayment(input());

    expect(result).toEqual({
      status: 'PENDING',
      externalCustomerId: 'cus_1',
      externalSubscriptionId: 'sub_1',
      nextBillingAt: '2026-09-24',
    });
    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe(`${API}/subscriptions/`);
    expect(new Headers(init.headers).get('access_token')).toBe('sandbox-key');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ billingType: 'CREDIT_CARD', value: 79.9, cycle: 'MONTHLY' });
    expect(JSON.stringify(result)).not.toContain('411111');
  });

  it.each([
    ['QUARTERLY', 7590, 22770, 3],
    ['SEMIANNUAL', 7190, 43140, 6],
    ['ANNUAL', 6790, 81480, 12],
  ] as const)(
    'cria compra %s pelo total do contrato em até %ix',
    async (plan, monthlyCents, totalCents, installments) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(json({ data: [{ id: 'cus_1' }] }))
        .mockResolvedValueOnce(json({ data: [] }))
        .mockResolvedValueOnce(json({ id: 'ins_1' }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await new AsaasGateway('sandbox-key', TOKEN, API).startPayment(
        input({ plan, monthlyCents, totalCents, months: installments, installments }),
      );

      expect(result.externalInstallmentId).toBe('ins_1');
      const body = JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body));
      expect(body).toMatchObject({
        installmentCount: installments,
        value: monthlyCents / 100,
        totalValue: totalCents / 100,
        billingType: 'CREDIT_CARD',
      });
    },
  );

  it('cria Pix à vista e devolve somente QR, payload e expiração', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [{ id: 'cus_1' }] }))
      .mockResolvedValueOnce(json({ data: [] }))
      .mockResolvedValueOnce(json({ id: 'pay_1', status: 'PENDING' }))
      .mockResolvedValueOnce(
        json({
          encodedImage: 'base64-png',
          payload: 'pix-copia-cola',
          expirationDate: '2026-09-24',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AsaasGateway('sandbox-key', TOKEN, API).startPayment(
      input({ method: 'PIX', card: undefined, installments: undefined }),
    );

    expect(result.externalPaymentId).toBe('pay_1');
    expect(result.qrCode?.payload).toBe('pix-copia-cola');
    const body = JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body));
    expect(body).toMatchObject({ billingType: 'PIX', value: 79.9 });
  });

  it('cria autorização Pix Automático SUBSCRIPTION com término e mensalidade explícitos', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [{ id: 'cus_1' }] }))
      .mockResolvedValueOnce(json({ data: [] }))
      .mockResolvedValueOnce(
        json({
          id: 'aut_1',
          status: 'PENDING',
          encodedImage: 'base64-png',
          payload: 'pix-auto',
          expirationDate: '2026-09-24T10:00:00Z',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AsaasGateway('sandbox-key', TOKEN, API).startPayment(
      input({
        plan: 'QUARTERLY',
        monthlyCents: 7590,
        totalCents: 22770,
        months: 3,
        method: 'PIX_AUTOMATIC',
        card: undefined,
        installments: undefined,
      }),
    );

    expect(result.externalAuthorizationId).toBe('aut_1');
    const body = JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body));
    expect(body).toMatchObject({
      frequency: 'MONTHLY',
      value: 75.9,
      paymentCreationMode: 'SUBSCRIPTION',
      retryPolicy: 'NOT_ALLOWED',
    });
    expect(body.finishDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('reutiliza cliente e contrato pela externalReference em retentativa', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [{ id: 'cus_existing' }] }))
      .mockResolvedValueOnce(json({ data: [{ id: 'sub_existing', status: 'PENDING' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AsaasGateway('sandbox-key', TOKEN, API).startPayment(input());

    expect(result.externalSubscriptionId).toBe('sub_existing');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cancela a referência mais específica e consulta assinatura', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({ id: 'sub_1', status: 'ACTIVE' }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new AsaasGateway('sandbox-key', TOKEN, API);

    await gateway.cancelContract({ authorizationId: 'aut/1', subscriptionId: 'sub_ignored' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API}/pix/automatic/authorizations/aut%2F1`);
    await expect(gateway.getSubscription('sub_1')).resolves.toEqual({
      externalSubscriptionId: 'sub_1',
      status: 'ACTIVE',
    });
  });

  it('não chama o Asaas sem referência cancelável e trata consulta ausente', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ status: 'ACTIVE' }))
      .mockResolvedValueOnce(json({}, 404));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new AsaasGateway('sandbox-key', TOKEN, API);

    await expect(gateway.cancelContract({})).resolves.toBeUndefined();
    await expect(gateway.getSubscription('sem-id')).resolves.toBeNull();
    await expect(gateway.getSubscription('inexistente')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falha fechado sem chave e normaliza erro HTTP', async () => {
    await expect(new AsaasGateway(undefined, TOKEN, API).startPayment(input())).rejects.toThrow(
      /sem credencial/,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ errors: [{ description: 'recusado' }] }, 400)),
    );
    await expect(new AsaasGateway('sandbox-key', TOKEN, API).startPayment(input())).rejects.toThrow(
      /recusado/,
    );
  });
});

describe('AsaasGateway — webhook autenticado', () => {
  const gateway = new AsaasGateway('sandbox-key', TOKEN, API);

  it('rejeita token ausente/incorreto e JSON inválido', () => {
    expect(gateway.parseWebhookEvent(Buffer.from('{}'), undefined, undefined)).toBeNull();
    expect(gateway.parseWebhookEvent(Buffer.from('{}'), 'x'.repeat(32), undefined)).toBeNull();
    expect(gateway.parseWebhookEvent(Buffer.from('{'), TOKEN, undefined)).toBeNull();
  });

  it('ignora payload autenticado incompleto e assinatura de tamanho diferente', () => {
    expect(gateway.parseWebhookEvent(Buffer.from('{}'), TOKEN, undefined)).toBeNull();
    expect(
      gateway.parseWebhookEvent(
        Buffer.from(JSON.stringify({ id: 'evt_sem_nome' })),
        TOKEN,
        undefined,
      ),
    ).toBeNull();
    expect(gateway.parseWebhookEvent(Buffer.from('{}'), 'curto', undefined)).toBeNull();
  });

  it('normaliza exclusão de assinatura e ignora a mesma notificação sem id', () => {
    expect(typeOf({ id: 'evt_sem_sub', event: 'SUBSCRIPTION_DELETED', subscription: {} })).toBe(
      'IGNORED',
    );
    expect(
      typeOf({
        id: 'evt_sub',
        event: 'SUBSCRIPTION_DELETED',
        subscription: {
          id: 'sub_1',
          customer: 'cus_1',
          externalReference: `movivo:${USER}:ANNUAL:terms-v1`,
        },
      }),
    ).toBe('SUBSCRIPTION_CANCELED');
  });

  it('normaliza confirmação com vínculo, valores e IDs externos', () => {
    const raw = Buffer.from(
      JSON.stringify({
        id: 'evt_1',
        event: 'PAYMENT_CONFIRMED',
        payment: {
          id: 'pay_1',
          customer: 'cus_1',
          installment: 'ins_1',
          value: 227.7,
          netValue: 220,
          externalReference: `movivo:${USER}:QUARTERLY:terms-v1`,
        },
      }),
    );

    expect(gateway.parseWebhookEvent(raw, TOKEN, undefined)).toMatchObject({
      type: 'CHECKOUT_CONFIRMED',
      eventId: 'evt_1',
      userId: USER,
      plan: 'QUARTERLY',
      externalPaymentId: 'pay_1',
      externalInstallmentId: 'ins_1',
      amountCents: 22770,
      feeCents: 770,
    });
  });

  /** Tipo normalizado, `IGNORED` para autenticado-sem-efeito, `null` para não autenticado. */
  function typeOf(body: unknown): string | null {
    const parsed = gateway.parseWebhookEvent(Buffer.from(JSON.stringify(body)), TOKEN, undefined);
    if (!parsed) return null;
    return isIgnoredWebhookEvent(parsed) ? 'IGNORED' : parsed.type;
  }

  it('normaliza a autorização Pix Automático: ativação, revogação e QR expirado', () => {
    const event = (name: string) => ({
      id: `evt_${name}`,
      event: name,
      authorization: { id: 'aut_1', subscriptionId: 'sub_1', customerId: 'cus_1' },
    });
    expect(typeOf(event('PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED'))).toBe(
      'AUTHORIZATION_ACTIVE',
    );
    expect(typeOf(event('PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED'))).toBe(
      'SUBSCRIPTION_CANCELED',
    );
    // QR da primeira mensalidade expirou: falha do primeiro pagamento, não fim de contrato.
    expect(typeOf(event('PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED'))).toBe('PAYMENT_FAILED');
    // Fim natural em `finishDate`: quem encerra o acesso é a varredura do período pago.
    expect(typeOf(event('PIX_AUTOMATIC_RECURRING_AUTHORIZATION_EXPIRED'))).toBe('IGNORED');
  });

  it('evento autenticado sem efeito é IGNORADO (200), nunca confundido com forja (401)', () => {
    const payment = { id: 'pay_1', customer: 'cus_1', value: 79.9 };
    expect(typeOf({ id: 'evt_c', event: 'PAYMENT_CREATED', payment })).toBe('IGNORED');
    expect(
      typeOf({
        id: 'evt_a',
        event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED',
        authorization: { id: 'aut_1' },
      }),
    ).toBe('IGNORED');
    expect(
      typeOf({ id: 'evt_s', event: 'SUBSCRIPTION_CREATED', subscription: { id: 'sub_1' } }),
    ).toBe('IGNORED');
    expect(typeOf({ id: 'evt_x', event: 'ACCOUNT_STATUS_UPDATED' })).toBe('IGNORED');
  });

  it('PAYMENT_DELETED não cancela o contrato (Pix regenerado apaga a cobrança anterior)', () => {
    expect(
      typeOf({
        id: 'evt_d',
        event: 'PAYMENT_DELETED',
        payment: { id: 'pay_old', externalReference: `movivo:${USER}:MONTHLY:terms-v1:0` },
      }),
    ).toBe('IGNORED');
  });

  it('débito recusado do Pix Automático vira falha de pagamento com cobrança e autorização', () => {
    const parsed = gateway.parseWebhookEvent(
      Buffer.from(
        JSON.stringify({
          id: 'evt_i',
          event: 'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_REFUSED',
          dateCreated: '2026-10-24 08:00:00',
          paymentInstruction: {
            id: 'ins_uuid',
            paymentId: 'pay_2',
            authorization: { id: 'aut_1' },
          },
        }),
      ),
      TOKEN,
      undefined,
    );
    expect(parsed).toMatchObject({
      type: 'PAYMENT_FAILED',
      externalAuthorizationId: 'aut_1',
      externalPaymentId: 'pay_2',
      occurredAt: '2026-10-24T11:00:00.000Z',
    });
    expect(
      typeOf({
        id: 'evt_s',
        event: 'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_SCHEDULED',
        paymentInstruction: { paymentId: 'pay_2', authorization: { id: 'aut_1' } },
      }),
    ).toBe('IGNORED');
  });

  it('lê as datas do Asaas como hora de Brasília, não no fuso do servidor', () => {
    const parsed = gateway.parseWebhookEvent(
      Buffer.from(
        JSON.stringify({
          id: 'evt_o',
          event: 'PAYMENT_OVERDUE',
          dateCreated: '2026-09-23 10:05:00',
          payment: { id: 'pay_1', dueDate: '2026-09-22' },
        }),
      ),
      TOKEN,
      undefined,
    );
    expect(parsed).toMatchObject({
      type: 'PAYMENT_FAILED',
      occurredAt: '2026-09-23T13:05:00.000Z',
      dueDate: '2026-09-22T03:00:00.000Z',
    });
  });
});

describe('AsaasGateway — datas civis e buscas idempotentes', () => {
  afterEach(() => vi.useRealTimers());

  it('às 22h de Brasília o vencimento ainda é "hoje" (não o dia seguinte em UTC)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T01:00:00Z')); // 23/09 22:00 em Brasília
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [{ id: 'cus_1' }] }))
      .mockResolvedValueOnce(json({ data: [] }))
      .mockResolvedValueOnce(json({ id: 'sub_1', status: 'PENDING' }));
    vi.stubGlobal('fetch', fetchMock);

    await new AsaasGateway('sandbox-key', TOKEN, API).startPayment(input());

    const body = JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body));
    expect(body.nextDueDate).toBe('2026-09-23');
  });

  it('busca a cobrança existente filtrando pelo meio de pagamento', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [{ id: 'cus_1' }] }))
      .mockResolvedValueOnce(json({ data: [] }))
      .mockResolvedValueOnce(json({ id: 'ins_1' }));
    vi.stubGlobal('fetch', fetchMock);

    await new AsaasGateway('sandbox-key', TOKEN, API).startPayment(
      input({
        plan: 'QUARTERLY',
        monthlyCents: 7590,
        totalCents: 22770,
        months: 3,
        installments: 3,
      }),
    );

    // Uma cobrança Pix pendente com a mesma referência nunca se passa pelo parcelamento.
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('billingType=CREDIT_CARD');
  });

  it('cancelamento de referência já removida (404) é sucesso; outro erro propaga', async () => {
    const gateway = new AsaasGateway('sandbox-key', TOKEN, API);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ errors: [] }, 404)));
    await expect(gateway.cancelContract({ paymentId: 'pay_1' })).resolves.toBeUndefined();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ errors: [{ description: 'indisponível' }] }, 500)),
    );
    await expect(gateway.cancelContract({ paymentId: 'pay_1' })).rejects.toThrow(/indisponível/);
  });
});
