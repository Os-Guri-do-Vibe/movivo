/**
 * Unitários do `SubscriptionController` (US-4.6 / TASK-4.6.1-2).
 *
 * Controller fino: prova a fronteira IDOR-safe (token não-UUID → 404 sem tocar o serviço),
 * a validação Zod do checkout, o mapeamento da view (sem assinatura → 404) e que só a
 * `checkoutUrl` volta (nenhum dado de cartão).
 */
import { NotFoundException } from '@nestjs/common';
import type { SubscriptionView } from '@movivo/shared';
import { describe, expect, it, vi } from 'vitest';

import { SubscriptionController } from './subscription.controller';
import { type SubscriptionService } from './subscription.service';

const VALID = '11111111-1111-4111-8111-111111111111';

const view: SubscriptionView = {
  plan: 'QUARTERLY',
  status: 'ACTIVE',
  access: 'FULL',
  currentPeriodEnd: '2026-11-01T00:00:00.000Z',
};

function make(overrides: Partial<Record<keyof SubscriptionService, unknown>> = {}) {
  const svc = {
    getView: vi.fn(() => Promise.resolve<SubscriptionView | null>(view)),
    createCheckout: vi.fn(() =>
      Promise.resolve({ checkoutUrl: 'https://gw.test/c/abc', externalSessionId: 'abc' }),
    ),
    ...overrides,
  } as unknown as SubscriptionService;
  return { controller: new SubscriptionController(svc), svc };
}

describe('SubscriptionController — view (US-4.6)', () => {
  it('token válido devolve a view (sem PII/cartão)', async () => {
    const { controller } = make();
    const result = await controller.view(VALID);
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
    await expect(controller.view(VALID)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SubscriptionController — checkout (US-4.6)', () => {
  it('body válido chama createCheckout e devolve só a checkoutUrl', async () => {
    const { controller, svc } = make();
    const result = await controller.checkout(VALID, { plan: 'ANNUAL', method: 'PIX' });
    expect(svc.createCheckout).toHaveBeenCalledWith(VALID, 'ANNUAL', 'PIX', expect.any(String));
    expect(result).toEqual({ checkoutUrl: 'https://gw.test/c/abc' });
    expect(Object.keys(result)).toEqual(['checkoutUrl']);
  });

  it('body inválido (plano/método desconhecido) → rejeita, não cria checkout', async () => {
    const { controller, svc } = make();
    await expect(controller.checkout(VALID, { plan: 'X', method: 'BOLETO' })).rejects.toThrow();
    expect(svc.createCheckout).not.toHaveBeenCalled();
  });

  it('token não-UUID → 404 antes de validar o corpo', async () => {
    const { controller, svc } = make();
    await expect(
      controller.checkout('nope', { plan: 'ANNUAL', method: 'PIX' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(svc.createCheckout).not.toHaveBeenCalled();
  });
});

describe('SubscriptionController — cancelar / pausar / retomar (US-4.5)', () => {
  it.each([
    ['cancel', 'CANCELED'],
    ['pause', 'PAUSED'],
    ['resume', 'ACTIVE'],
  ] as const)('%s devolve o novo status da assinatura', async (action, status) => {
    const { controller, svc } = make({ [action]: vi.fn(() => Promise.resolve({ status })) });
    await expect(controller[action](VALID, {})).resolves.toEqual({ status });
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
      await expect(controller[action](VALID, {})).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it('motivo do cancelamento é aparado e limitado a 500 caracteres', async () => {
    const cancel = vi.fn(() => Promise.resolve({ status: 'CANCELED' }));
    const { controller } = make({ cancel });

    await controller.cancel(VALID, { reason: `  ${'x'.repeat(600)}  ` });

    expect(cancel).toHaveBeenCalledWith(VALID, 'x'.repeat(500));
  });

  it.each([
    ['corpo ausente', null],
    ['sem motivo', {}],
    ['motivo em branco', { reason: '   ' }],
    ['motivo de outro tipo', { reason: 42 }],
  ])('cancelamento com %s não inventa motivo', async (_label, body) => {
    const cancel = vi.fn(() => Promise.resolve({ status: 'CANCELED' }));
    const { controller } = make({ cancel });

    await controller.cancel(VALID, body);

    expect(cancel).toHaveBeenCalledWith(VALID, undefined);
  });
});
