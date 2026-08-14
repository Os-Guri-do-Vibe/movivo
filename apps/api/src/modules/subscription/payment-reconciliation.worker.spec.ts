/**
 * US-8.5 / TASK-8.5.3 — conciliação da liquidação.
 *
 * O que estes testes provam: o sinal do valor por tipo de evento (estorno é linha
 * NEGATIVA, nunca alteração da original), o líquido de taxa, o vínculo com a assinatura,
 * a fila de exceção do órfão e o `onConflictDoNothing` que delega a idempotência ao banco.
 *
 * O que NÃO é provado aqui, de propósito: a idempotência em si. Ela é uma constraint do
 * PostgreSQL e um mock de Drizzle não consegue demonstrá-la — está em
 * `test/payments-immutability.int-spec.ts`, contra o banco real.
 */
import { describe, expect, it, vi } from 'vitest';

import type { GatewayEvent } from './payment/payment-gateway.types';
import {
  PaymentReconciliationWorker,
  type PaymentReconciliationJob,
  settlementOf,
} from './payment-reconciliation.worker';

function event(over: Partial<GatewayEvent> = {}): GatewayEvent {
  return {
    type: 'CHECKOUT_CONFIRMED',
    eventId: 'evt_1',
    externalSubscriptionId: 'sub_ext_1',
    userId: 'u1',
    amountCents: 3900,
    ...over,
  };
}

/** Mock do `tx` do Drizzle: só o encadeamento usado pelo worker. */
function makeTx(linked: { id: string; userId: string } | null) {
  const values = vi.fn(() => ({ onConflictDoNothing: vi.fn(() => Promise.resolve()) }));
  const insert = vi.fn(() => ({ values }));
  const select = vi.fn(() => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({ limit: () => Promise.resolve(linked ? [linked] : []) }),
      }),
    }),
  }));
  return { tx: { select, insert }, values };
}

function make(linked: { id: string; userId: string } | null = { id: 's1', userId: 'u1' }) {
  const { tx, values } = makeTx(linked);
  const db = { runAsSystem: (cb: (t: unknown) => Promise<void>) => cb(tx) } as never;
  const workers = { create: vi.fn() } as never;
  const logger = { info: vi.fn(), warn: vi.fn(), setContext: vi.fn() };
  return {
    worker: new PaymentReconciliationWorker(workers, db, logger as never),
    values,
    logger,
  };
}

function job(over: Partial<PaymentReconciliationJob> = {}) {
  return {
    data: {
      gateway: 'MOCK' as const,
      event: event(),
      rawPayload: { id: 'evt_1' },
      correlationId: 'c1',
      ...over,
    },
  } as never;
}

describe('settlementOf — sinal e status por tipo de evento', () => {
  it('checkout confirmado é positivo e SETTLED', () => {
    expect(settlementOf(event())).toEqual({ status: 'SETTLED', amountCents: 3900 });
  });

  it('estorno é linha NEGATIVA (nunca alteração da original)', () => {
    expect(settlementOf(event({ type: 'REFUNDED' }))).toEqual({
      status: 'REFUNDED',
      amountCents: -3900,
    });
  });

  it('estorno com valor já negativo no provedor não vira positivo', () => {
    expect(settlementOf(event({ type: 'REFUNDED', amountCents: -3900 }))?.amountCents).toBe(-3900);
  });

  it('cobrança falha registra o fato com valor zero — nada entrou', () => {
    expect(settlementOf(event({ type: 'PAYMENT_FAILED' }))).toEqual({
      status: 'FAILED',
      amountCents: 0,
    });
  });

  it('cancelamento não é movimento financeiro e não gera linha', () => {
    expect(settlementOf(event({ type: 'SUBSCRIPTION_CANCELED' }))).toBeNull();
  });

  it('sem `amountCents` cai no preço contratado do evento', () => {
    expect(
      settlementOf({ ...event(), amountCents: undefined, priceCents: 9900 })?.amountCents,
    ).toBe(9900);
  });
});

describe('PaymentReconciliationWorker.process', () => {
  it('vincula à assinatura e desconta a taxa do gateway do líquido', async () => {
    const { worker, values } = make();
    await worker.process(job({ event: event({ feeCents: 150 }) }));
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 's1',
        userId: 'u1',
        gateway: 'MOCK',
        gatewayEventId: 'evt_1',
        status: 'SETTLED',
        amountCents: 3900,
        netAmountCents: 3750,
      }),
    );
  });

  it('sem taxa informada o líquido é igual ao bruto — taxa nunca é inventada', async () => {
    const { worker, values } = make();
    await worker.process(job());
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 3900, netAmountCents: 3900 }),
    );
  });

  it('no estorno a taxa aproxima o líquido de zero, não o afasta', async () => {
    const { worker, values } = make();
    await worker.process(job({ event: event({ type: 'REFUNDED', feeCents: 150 }) }));
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: -3900, netAmountCents: -3750 }),
    );
  });

  it('pagamento órfão é GRAVADO com titular nulo e avisado — nunca descartado', async () => {
    const { worker, values, logger } = make(null);
    await worker.process(job());
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: null, userId: null, amountCents: 3900 }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'payment_orphan' }),
      expect.any(String),
    );
  });

  it('evento sem movimento financeiro não grava linha nenhuma', async () => {
    const { worker, values } = make();
    await worker.process(job({ event: event({ type: 'SUBSCRIPTION_CANCELED' }) }));
    expect(values).not.toHaveBeenCalled();
  });

  it('o payload bruto vai para a coluna jsonb e não para o log', async () => {
    const { worker, values, logger } = make(null);
    await worker.process(job({ rawPayload: { card: '4111111111111111' } }));
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ rawPayload: { card: '4111111111111111' } }),
    );
    const logged = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls]);
    expect(logged).not.toContain('4111111111111111');
  });
});
