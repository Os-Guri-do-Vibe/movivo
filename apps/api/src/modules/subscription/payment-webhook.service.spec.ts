import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import { RedisKeyBuilder } from '../../core/redis/redis-key.util';
import type { QueueManager } from '../jobs/queue-manager.service';
import type { GatewayEvent, PaymentGateway } from './payment/payment-gateway.types';
import { PaymentWebhookService } from './payment-webhook.service';
import { InvalidTransitionError } from './subscription-model';
import type { SubscriptionService } from './subscription.service';

const RAW = Buffer.from('{"x":1}');

function event(over: Partial<GatewayEvent> = {}): GatewayEvent {
  return {
    type: 'CHECKOUT_CONFIRMED',
    eventId: 'evt_1',
    externalSubscriptionId: 'sub_1',
    userId: 'u1',
    ...over,
  };
}

interface Deps {
  parsed?: GatewayEvent | null;
  fresh?: boolean; // SET NX devolve OK?
  applyResult?: { status: string };
  applyThrows?: Error;
}

function make(deps: Deps = {}) {
  const parseWebhookEvent = vi.fn(() => (deps.parsed === undefined ? event() : deps.parsed));
  const gateway = { parseWebhookEvent } as unknown as PaymentGateway;

  const applyGatewayEvent = deps.applyThrows
    ? vi.fn(() => Promise.reject(deps.applyThrows))
    : vi.fn(() => Promise.resolve(deps.applyResult ?? { status: 'ACTIVE' }));
  const getForUser = vi.fn(() =>
    Promise.resolve({ id: 's1', plan: 'MONTHLY', termsVersion: 'v1' }),
  );
  const createCheckout = vi.fn(() =>
    Promise.resolve({ checkoutUrl: 'https://mock/co', externalSessionId: 'cs_1' }),
  );
  const subscriptions = {
    applyGatewayEvent,
    getForUser,
    createCheckout,
  } as unknown as SubscriptionService;

  const set = vi.fn(() => Promise.resolve(deps.fresh === false ? null : 'OK'));
  const redis = { set } as unknown as Redis;
  const keys = new RedisKeyBuilder('movivo');
  const enqueue = vi.fn(() => Promise.resolve('job'));
  const queues = { enqueue } as unknown as QueueManager;
  const logger = { info: vi.fn(), warn: vi.fn(), setContext: vi.fn() } as never;

  return {
    svc: new PaymentWebhookService(gateway, subscriptions, redis, keys, queues, logger),
    applyGatewayEvent,
    enqueue,
    set,
  };
}

const input = { rawBody: RAW, signature: 'sig', timestamp: '123', correlationId: 'c1' };

describe('PaymentWebhookService.ingest (US-4.2)', () => {
  it('assinatura inválida (parse → null) → não processa', async () => {
    const { svc, applyGatewayEvent } = make({ parsed: null });
    await svc.ingest(input);
    expect(applyGatewayEvent).not.toHaveBeenCalled();
  });

  it('corpo ausente → não processa', async () => {
    const { svc, applyGatewayEvent } = make();
    await svc.ingest({ ...input, rawBody: undefined });
    expect(applyGatewayEvent).not.toHaveBeenCalled();
  });

  it('checkout válido → aplica a transição (ativação)', async () => {
    const { svc, applyGatewayEvent } = make({ applyResult: { status: 'ACTIVE' } });
    await svc.ingest(input);
    expect(applyGatewayEvent).toHaveBeenCalledTimes(1);
  });

  it('replay (SET NX falha) → não aplica de novo (idempotência)', async () => {
    const { svc, applyGatewayEvent } = make({ fresh: false });
    await svc.ingest(input);
    expect(applyGatewayEvent).not.toHaveBeenCalled();
  });

  it('payment_failed → PAST_DUE e enfileira dunning no WhatsApp', async () => {
    const { svc, enqueue } = make({
      parsed: event({ type: 'PAYMENT_FAILED' }),
      applyResult: { status: 'PAST_DUE' },
    });
    await svc.ingest(input);
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'dunning',
      expect.objectContaining({ type: 'COACH_MESSAGE' }),
    );
  });

  it('transição inválida é engolida (responde 200, não relança)', async () => {
    const { svc } = make({ applyThrows: new InvalidTransitionError('CANCELED', 'ACTIVE') });
    await expect(svc.ingest(input)).resolves.toBeUndefined();
  });
});
