/**
 * Unitários do `SubscriptionController` (US-4.6 / TASK-4.6.1-2).
 *
 * Controller fino: prova a fronteira IDOR-safe (token não-UUID → 404 sem tocar o serviço),
 * a validação Zod do checkout, o mapeamento da view (sem assinatura → 404) e que só a
 * `checkoutUrl` volta (nenhum dado de cartão).
 */
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { CheckoutSummary, SubscriptionView } from '@movivo/shared';
import { ZodError } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import { SubscriptionController } from './subscription.controller';
import { type SubscriptionService } from './subscription.service';

const PORTAL = 'B'.repeat(43);
const VALID = '11111111-1111-4111-8111-111111111111';

const view: SubscriptionView = {
  plan: 'QUARTERLY',
  status: 'ACTIVE',
  access: 'FULL',
  currentPeriodEnd: '2026-11-01T00:00:00.000Z',
};

const summary: CheckoutSummary = {
  plan: 'QUARTERLY',
  label: 'Trimestral',
  monthlyCents: 7590,
  totalCents: 22770,
  months: 3,
  maxInstallments: 3,
  status: 'TRIALING',
  expiresAt: '2026-09-26T00:00:00.000Z',
  methods: ['CARD', 'PIX', 'PIX_AUTOMATIC'],
};

function make(overrides: Partial<Record<keyof SubscriptionService, unknown>> = {}) {
  const svc = {
    getView: vi.fn(() => Promise.resolve<SubscriptionView | null>(view)),
    getCheckoutSummary: vi.fn(() => Promise.resolve<CheckoutSummary | null>(summary)),
    startCheckoutPayment: vi.fn(() => Promise.resolve({ status: 'PENDING', method: 'PIX' })),
    ...overrides,
  } as unknown as SubscriptionService;
  const tokens = {
    verify: vi.fn((token: string) =>
      token === 'opaque' ? { userId: VALID, expiresAt: Date.parse(summary.expiresAt) } : null,
    ),
  } as never;
  return {
    controller: new SubscriptionController(svc, tokens, {
      verify: vi.fn(async (token: string) => (token === PORTAL ? { userId: VALID } : null)),
    } as never),
    svc,
  };
}

describe('SubscriptionController — view (US-4.6)', () => {
  it('token válido devolve a view (sem PII/cartão)', async () => {
    const { controller } = make();
    const result = await controller.view(PORTAL);
    expect(result).toEqual(view);
    expect(Object.keys(result)).not.toContain('userId');
  });

  it('token não-UUID → 404 sem tocar o serviço', async () => {
    const { controller, svc } = make();
    await expect(controller.view('nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(svc.getView).not.toHaveBeenCalled();
  });

  it('sem assinatura (null) → 404', async () => {
    const { controller } = make({ getView: vi.fn(() => Promise.resolve(null)) });
    await expect(controller.view(PORTAL)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SubscriptionController — checkout (US-4.6)', () => {
  it('não inicia pagamento sem contrato de assinatura publicado', async () => {
    const { controller, svc } = make();
    await expect(
      controller.checkoutPayment(
        'opaque',
        {
          method: 'PIX',
          acceptTerms: true,
          payer: {
            name: 'Aluno Teste',
            email: 'aluno@example.invalid',
            cpfCnpj: '12345678901',
            postalCode: '01234567',
            addressNumber: '10',
            phone: '11999999999',
          },
        },
        { ip: '127.0.0.1' } as never,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(svc.startCheckoutPayment).not.toHaveBeenCalled();
  });

  it('token opaco válido devolve o snapshot autoritativo', async () => {
    const { controller, svc } = make();
    await expect(controller.checkoutSummary('opaque')).resolves.toEqual(summary);
    expect(svc.getCheckoutSummary).toHaveBeenCalledWith(VALID, Date.parse(summary.expiresAt));
  });

  it.each([
    ['priceCents', { priceCents: 1 }],
    ['status', { status: 'ACTIVE' }],
    ['userId', { userId: '00000000-0000-0000-0000-000000000001' }],
    ['subscriptionActive', { subscriptionActive: true }],
  ])(
    'rejeita (400) mass assignment de %s no checkout, antes de qualquer cobrança',
    async (_l, extra) => {
      const { controller, svc } = make();
      await expect(
        controller.checkoutPayment(
          'opaque',
          {
            method: 'PIX',
            acceptTerms: true,
            payer: {
              name: 'Aluno Teste',
              email: 'aluno@example.invalid',
              cpfCnpj: '12345678901',
              postalCode: '01234567',
              addressNumber: '10',
              phone: '11999999999',
            },
            ...extra,
          },
          { ip: '127.0.0.1' } as never,
        ),
      ).rejects.toBeInstanceOf(ZodError);
      expect(svc.startCheckoutPayment).not.toHaveBeenCalled();
    },
  );

  it('rejeita campo extra aninhado em payer', async () => {
    const { controller, svc } = make();
    await expect(
      controller.checkoutPayment(
        'opaque',
        {
          method: 'PIX',
          acceptTerms: true,
          payer: {
            name: 'Aluno Teste',
            email: 'aluno@example.invalid',
            cpfCnpj: '12345678901',
            postalCode: '01234567',
            addressNumber: '10',
            phone: '11999999999',
            isAdmin: true,
          },
        },
        { ip: '127.0.0.1' } as never,
      ),
    ).rejects.toBeInstanceOf(ZodError);
    expect(svc.startCheckoutPayment).not.toHaveBeenCalled();
  });

  it('body inválido é rejeitado antes de iniciar pagamento', async () => {
    const { controller, svc } = make();
    await expect(
      controller.checkoutPayment('opaque', { method: 'BOLETO' }, { ip: '127.0.0.1' } as never),
    ).rejects.toThrow();
    expect(svc.startCheckoutPayment).not.toHaveBeenCalled();
  });

  it('token opaco inválido → 404 antes de validar o corpo', async () => {
    const { controller, svc } = make();
    await expect(
      controller.checkoutPayment('nope', { method: 'PIX' }, { ip: '127.0.0.1' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(svc.startCheckoutPayment).not.toHaveBeenCalled();
  });
});

describe('SubscriptionController — cancelar / pausar / retomar (US-4.5)', () => {
  it.each([
    ['cancel', 'CANCELED'],
    ['pause', 'PAUSED'],
    ['resume', 'ACTIVE'],
  ] as const)('%s devolve o novo status da assinatura', async (action, status) => {
    const { controller, svc } = make({ [action]: vi.fn(() => Promise.resolve({ status })) });
    await expect(controller[action](PORTAL, {})).resolves.toEqual({ status });
    expect(svc[action]).toHaveBeenCalled();
  });

  it.each(['cancel', 'pause', 'resume'] as const)(
    '%s com token não-UUID → 404 sem tocar o serviço',
    async (action) => {
      const { controller, svc } = make({ [action]: vi.fn() });
      await expect(controller[action]('nope', {})).rejects.toBeInstanceOf(NotFoundException);
      expect(svc[action]).not.toHaveBeenCalled();
    },
  );

  it.each(['cancel', 'pause', 'resume'] as const)(
    '%s sem assinatura → 404 uniforme (não vaza existência)',
    async (action) => {
      const { controller } = make({
        [action]: vi.fn(() => Promise.resolve({ status: 'NO_SUBSCRIPTION' })),
      });
      await expect(controller[action](PORTAL, {})).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it('motivo do cancelamento é aparado e validado antes da mutação', async () => {
    const cancel = vi.fn(() => Promise.resolve({ status: 'CANCELED' }));
    const { controller } = make({ cancel });

    await expect(controller.cancel(PORTAL, { reason: 'x'.repeat(501) })).rejects.toThrow();
    expect(cancel).not.toHaveBeenCalled();
    await controller.cancel(PORTAL, { reason: `  ${'x'.repeat(500)}  ` });

    expect(cancel).toHaveBeenCalledWith(VALID, 'x'.repeat(500));
  });

  it.each([
    ['corpo ausente', null],
    ['sem motivo', {}],
    ['motivo em branco', { reason: '   ' }],
  ])('cancelamento com %s não inventa motivo', async (_label, body) => {
    const cancel = vi.fn(() => Promise.resolve({ status: 'CANCELED' }));
    const { controller } = make({ cancel });

    await controller.cancel(PORTAL, body);

    expect(cancel).toHaveBeenCalledWith(VALID, undefined);
  });
});

it('recusa userId como credencial de gestão', async () => {
  const { controller, svc } = make();
  await expect(controller.view(VALID)).rejects.toBeInstanceOf(NotFoundException);
  await expect(controller.pause(VALID)).rejects.toBeInstanceOf(NotFoundException);
  expect(svc.getView).not.toHaveBeenCalled();
});

it.each([{ reason: 42 }, { reason: [] }, { reason: 'x'.repeat(501) }, { userId: VALID }])(
  'recusa corpo de cancelamento inválido sem executar o serviço',
  async (body) => {
    const cancel = vi.fn();
    const { controller } = make({ cancel });
    await expect(controller.cancel(PORTAL, body)).rejects.toThrow();
    expect(cancel).not.toHaveBeenCalled();
  },
);
