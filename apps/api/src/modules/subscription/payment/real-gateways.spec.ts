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
    returnUrl: 'https://movivo.test/assinar/opaque',
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

  it.each([
    ['MONTHLY', 7990, 1, 'RECURRENT'],
    ['QUARTERLY', 22770, 3, 'INSTALLMENT'],
    ['SEMIANNUAL', 43140, 6, 'INSTALLMENT'],
    ['ANNUAL', 81480, 12, 'INSTALLMENT'],
  ] as const)(
    'cartão %s abre o Checkout hospedado com o cliente já cadastrado, sem PAN/CVV',
    async (plan, totalCents, months, chargeType) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(json({ data: [] })) // cliente ainda não existe
        .mockResolvedValueOnce(json({ id: 'cus_1' })) // cria o cliente
        .mockResolvedValueOnce(
          json({
            id: 'chk_1',
            link: 'https://sandbox.asaas.com/000/checkoutSession/show/chk_1',
          }),
        );
      vi.stubGlobal('fetch', fetchMock);

      const result = await new AsaasGateway('sandbox-key', TOKEN, API).startPayment(
        input({ plan, months, totalCents, installments: months }),
      );

      expect(result).toEqual({
        status: 'PENDING',
        externalCustomerId: 'cus_1',
        externalCheckoutSessionId: 'chk_1',
        checkoutUrl: 'https://sandbox.asaas.com/000/checkoutSession/show/chk_1',
      });
      const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
      expect(url).toBe(`${API}/checkouts`);
      expect(new Headers(init.headers).get('access_token')).toBe('sandbox-key');
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({
        customer: 'cus_1',
        billingTypes: ['CREDIT_CARD'],
        chargeTypes: chargeType === 'RECURRENT' ? ['RECURRENT'] : ['DETACHED', 'INSTALLMENT'],
        callback: {
          successUrl: 'https://movivo.test/assinar/opaque?retorno=sucesso',
          cancelUrl: 'https://movivo.test/assinar/opaque?retorno=cancelado',
          expiredUrl: 'https://movivo.test/assinar/opaque?retorno=expirado',
        },
        items: [{ quantity: 1, value: (chargeType === 'RECURRENT' ? 7990 : totalCents) / 100 }],
      });
      expect(JSON.stringify(body)).not.toContain('creditCard"');
      expect(JSON.stringify(body)).not.toContain('411111');
      if (chargeType === 'RECURRENT') {
        expect(body.subscription.cycle).toBe('MONTHLY');
        // Primeira cobrança hoje (data civil de Brasília): o cartão é cobrado no checkout.
        expect(body.subscription.nextDueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      } else {
        expect(body.installment.maxInstallmentCount).toBe(months);
      }
    },
  );

  it('atualiza o cliente existente (endereço) antes de abrir o Checkout', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [{ id: 'cus_existing' }] }))
      .mockResolvedValueOnce(json({ id: 'cus_existing' }))
      .mockResolvedValueOnce(
        json({ id: 'chk_2', link: 'https://asaas.com/checkoutSession/show/chk_2' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await new AsaasGateway('sandbox-key', TOKEN, API).startPayment(input());

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`${API}/customers/cus_existing`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toMatchObject({
      postalCode: '01310100',
      addressNumber: '100',
    });
  });

  it('desenvolvimento local volta por 127.0.0.1, porque o Asaas recusa localhost', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [{ id: 'cus_1' }] }))
      .mockResolvedValueOnce(json({ id: 'cus_1' }))
      .mockResolvedValueOnce(
        json({ id: 'chk_1', link: 'https://sandbox.asaas.com/000/checkoutSession/show/chk_1' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await new AsaasGateway('sandbox-key', TOKEN, API).startPayment(
      input({ returnUrl: 'http://localhost:3000/assinar/opaque' }),
    );

    const body = JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body));
    expect(body.callback).toEqual({
      successUrl: 'http://127.0.0.1:3000/assinar/opaque?retorno=sucesso',
      cancelUrl: 'http://127.0.0.1:3000/assinar/opaque?retorno=cancelado',
      expiredUrl: 'http://127.0.0.1:3000/assinar/opaque?retorno=expirado',
    });
  });

  it('recusa link de Checkout fora do domínio do Asaas', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json({ data: [{ id: 'cus_1' }] }))
        .mockResolvedValueOnce(json({ id: 'cus_1' }))
        .mockResolvedValueOnce(json({ id: 'chk_3', link: 'https://evil.example/pay' })),
    );
    await expect(new AsaasGateway('sandbox-key', TOKEN, API).startPayment(input())).rejects.toThrow(
      'link inválido',
    );
  });

  it('exige URL de retorno para o Checkout hospedado', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(
      new AsaasGateway('sandbox-key', TOKEN, API).startPayment(input({ returnUrl: undefined })),
    ).rejects.toThrow('URL de retorno ausente');
  });

  it('cria Pix à vista e devolve somente QR, payload e expiração', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [{ id: 'cus_1' }] }))
      .mockResolvedValueOnce(json({ id: 'cus_1' }))
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
      input({ method: 'PIX', installments: undefined }),
    );

    expect(result.externalPaymentId).toBe('pay_1');
    expect(result.qrCode?.payload).toBe('pix-copia-cola');
    // Hora de Brasília do Asaas vira ISO em UTC (todo navegador lê igual).
    expect(result.qrCode?.expirationDate).toBe('2026-09-24T03:00:00.000Z');
    const body = JSON.parse(String((fetchMock.mock.calls[3]?.[1] as RequestInit).body));
    expect(body).toMatchObject({ billingType: 'PIX', value: 79.9 });
  });

  it('o QR que o Asaas deixa valer por um ano é exibido só até o fim do dia de vencimento', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T15:00:00Z')); // 10/10 12:00 em Brasília
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [{ id: 'cus_1' }] }))
      .mockResolvedValueOnce(json({ id: 'cus_1' }))
      .mockResolvedValueOnce(json({ data: [] }))
      .mockResolvedValueOnce(json({ id: 'pay_1', status: 'PENDING', dueDate: '2026-10-11' }))
      .mockResolvedValueOnce(
        json({ encodedImage: 'img', payload: 'pix', expirationDate: '2027-10-11 23:59:59' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AsaasGateway('sandbox-key', TOKEN, API).startPayment(
      input({ method: 'PIX', installments: undefined }),
    );

    // Vencimento 11/10 (amanhã): o aluno vê 11/10 23:59:59 de Brasília = 12/10 02:59:59 UTC.
    expect(result.qrCode?.expirationDate).toBe('2026-10-12T02:59:59.000Z');
    vi.useRealTimers();
  });

  it('cria autorização Pix Automático SUBSCRIPTION com término e mensalidade explícitos', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [{ id: 'cus_1' }] }))
      .mockResolvedValueOnce(json({ id: 'cus_1' }))
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
        installments: undefined,
      }),
    );

    expect(result.externalAuthorizationId).toBe('aut_1');
    const body = JSON.parse(String((fetchMock.mock.calls[3]?.[1] as RequestInit).body));
    expect(body).toMatchObject({
      frequency: 'MONTHLY',
      value: 75.9,
      paymentCreationMode: 'SUBSCRIPTION',
      retryPolicy: 'NOT_ALLOWED',
    });
    expect(body.finishDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('reutiliza cliente e cobrança Pix pela externalReference em retentativa', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [{ id: 'cus_existing' }] }))
      .mockResolvedValueOnce(json({ id: 'cus_existing' }))
      .mockResolvedValueOnce(json({ data: [{ id: 'pay_existing', status: 'PENDING' }] }))
      .mockResolvedValueOnce(
        json({ encodedImage: 'qr', payload: 'pix', expirationDate: '2026-10-11' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AsaasGateway('sandbox-key', TOKEN, API).startPayment(
      input({ method: 'PIX', installments: undefined }),
    );

    expect(result.externalPaymentId).toBe('pay_existing');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('estorna parcelamento pelo parcelamento e cobrança avulsa pela cobrança', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({}));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new AsaasGateway('sandbox-key', TOKEN, API);

    await gateway.refundContract({ installmentId: 'ins/1', paymentId: 'pay_1' }, 'Arrependimento');
    await gateway.refundContract({ paymentId: 'pay_2' }, 'Arrependimento');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API}/installments/ins%2F1/refund`);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${API}/payments/pay_2/refund`);
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({
      description: 'Arrependimento',
    });
    await expect(gateway.refundContract({}, 'x')).rejects.toThrow('sem cobrança');
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

it('Asaas real envia cobrança Pix apenas ao domínio de produção com a chave correspondente', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json({ data: [{ id: 'cus_1' }] }))
    .mockResolvedValueOnce(json({ id: 'cus_1' }))
    .mockResolvedValueOnce(json({ data: [] }))
    .mockResolvedValueOnce(json({ id: 'pay_1', status: 'PENDING' }))
    .mockResolvedValueOnce(
      json({ encodedImage: 'qr', payload: 'pix', expirationDate: '2026-10-11' }),
    );
  vi.stubGlobal('fetch', fetchMock);
  const gateway = new AsaasGateway('production-key', TOKEN, 'https://api.asaas.com/v3');
  const result = await gateway.startPayment(input({ method: 'PIX' }));
  expect(result.externalPaymentId).toBe('pay_1');
  expect(
    fetchMock.mock.calls.every(([url]) => String(url).startsWith('https://api.asaas.com/v3/')),
  ).toBe(true);
  expect(
    new Headers((fetchMock.mock.calls[3]?.[1] as RequestInit).headers).get('access_token'),
  ).toBe('production-key');
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

  it('associa pagamento do Checkout hospedado pelo ID da sessão', () => {
    const event = gateway.parseWebhookEvent(
      Buffer.from(
        JSON.stringify({
          id: 'evt_checkout_1',
          event: 'PAYMENT_CONFIRMED',
          payment: {
            id: 'pay_1',
            customer: 'cus_1',
            checkoutSession: 'chk_1',
            subscription: 'sub_1',
            value: 79.9,
          },
        }),
      ),
      TOKEN,
      undefined,
    );
    expect(event).toMatchObject({
      type: 'CHECKOUT_CONFIRMED',
      externalCheckoutSessionId: 'chk_1',
      externalSubscriptionId: 'sub_1',
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

  it('às 22h de Brasília a primeira cobrança do Checkout ainda é "hoje" (não o dia seguinte em UTC)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T01:00:00Z')); // 23/09 22:00 em Brasília
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [{ id: 'cus_1' }] }))
      .mockResolvedValueOnce(json({ id: 'cus_1' }))
      .mockResolvedValueOnce(
        json({ id: 'chk_1', link: 'https://sandbox.asaas.com/000/checkoutSession/show/chk_1' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await new AsaasGateway('sandbox-key', TOKEN, API).startPayment(input());

    const body = JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body));
    expect(body.subscription.nextDueDate).toBe('2026-09-23');
  });

  it('cancelar um Checkout que já não está ativo (400) é sucesso; outro 400 propaga', async () => {
    const gateway = new AsaasGateway('sandbox-key', TOKEN, API);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json({ errors: [{ description: 'O Checkout não está ativo para ser cancelado.' }] }, 400),
        ),
    );
    await expect(gateway.cancelContract({ checkoutSessionId: 'chk_1' })).resolves.toBeUndefined();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ errors: [{ description: 'Valor inválido' }] }, 400)),
    );
    await expect(gateway.cancelContract({ checkoutSessionId: 'chk_1' })).rejects.toThrow(
      /Valor inválido/,
    );
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
