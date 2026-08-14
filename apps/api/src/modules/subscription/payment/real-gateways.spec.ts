import { describe, expect, it } from 'vitest';

import { PaymentGatewayError } from './payment-gateway.types';
import { AsaasGateway, StripeGateway } from './real-gateways';

/**
 * Os adaptadores reais são esqueletos MOCKS-FIRST (sem conta/SDK). O comportamento que
 * **já** vale hoje é o contrato de falha: nenhum caminho pode "meio funcionar" em
 * silêncio, e `hasCredentials()` é o que faz o factory cair no `MockGateway`.
 */
describe.each([
  ['STRIPE', () => new StripeGateway('sk_test', 'whsec')],
  ['ASAAS', () => new AsaasGateway('aact_test', 'whsec')],
] as const)('%s (esqueleto real)', (name, build) => {
  it('declara o próprio nome de provedor', () => {
    expect(build().name).toBe(name);
  });

  it('hasCredentials reflete a chave provisionada', () => {
    expect(build().hasCredentials()).toBe(true);
    const Gateway = build().constructor as new (
      key: string | undefined,
      secret: string | undefined,
    ) => ReturnType<typeof build>;
    expect(new Gateway(undefined, 'whsec').hasCredentials()).toBe(false);
    expect(new Gateway('', 'whsec').hasCredentials()).toBe(false);
  });

  it('toda operação falha alto enquanto o formato do provedor não estiver plugado', () => {
    const gateway = build();
    const calls = [
      () =>
        gateway.createCheckoutSession({
          userId: '11111111-1111-4111-8111-111111111111',
          plan: 'MONTHLY',
          priceCents: 3900,
          method: 'CARD',
          termsVersion: '2026-08-01',
          successUrl: 'https://movivo.app/ok',
          cancelUrl: 'https://movivo.app/cancel',
        }),
      () => gateway.parseWebhookEvent(Buffer.from('{}'), 'sig', '123'),
      () => gateway.cancelSubscription('sub_1'),
      () => gateway.getSubscription('sub_1'),
    ];
    for (const call of calls) {
      expect(call).toThrow(PaymentGatewayError);
    }
  });

  it('a mensagem de erro nomeia o provedor e o método, sem vazar a chave', () => {
    const gateway = build();
    try {
      gateway.cancelSubscription('sub_1');
      expect.unreachable('deveria ter lançado');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain(`${name}.cancelSubscription`);
      expect(message).toContain('mocks-first');
      expect(message).not.toContain('sk_test');
      expect(message).not.toContain('aact_test');
    }
  });
});

describe('endereço do provedor', () => {
  it('o endpoint real aparece na falha de checkout — e só o do provedor construído', () => {
    expect(() =>
      new StripeGateway('sk', undefined).createCheckoutSession({} as never),
    ).toThrow(/api\.stripe\.com/);
    expect(() => new AsaasGateway('aact', undefined).createCheckoutSession({} as never)).toThrow(
      /api\.asaas\.com/,
    );
  });
});
