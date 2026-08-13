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
  const gateway = { name: 'MOCK', parseWebhookEvent } as unknown as PaymentGateway;

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
  const logger = { info: vi.fn(), warn: vi.fn(), setContext: vi.fn() };

  return {
    svc: new PaymentWebhookService(
      gateway,
      subscriptions,
      redis,
      keys,
      queues,
      logger as never,
    ),
    applyGatewayEvent,
    enqueue,
    logger,
    set,
  };
}

const input = { rawBody: RAW, signature: 'sig', timestamp: '123', correlationId: 'c1' };

describe('PaymentWebhookService.ingest (US-4.2)', () => {
  it('assinatura inválida (parse → null) → rejeita, não processa e não enfileira nada', async () => {
    const { svc, applyGatewayEvent, enqueue } = make({ parsed: null });
    await expect(svc.ingest(input)).resolves.toBe('REJECTED');
    expect(applyGatewayEvent).not.toHaveBeenCalled();
    // US-8.5: nada é persistido nem enfileirado antes da assinatura passar.
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('corpo ausente → rejeita e não processa', async () => {
    const { svc, applyGatewayEvent, enqueue } = make();
    await expect(svc.ingest({ ...input, rawBody: undefined })).resolves.toBe('REJECTED');
    expect(applyGatewayEvent).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('rejeição é REGISTRADA no log — tentativa de forja não é descartada em silêncio', async () => {
    const { svc, logger } = make({ parsed: null });
    await svc.ingest(input);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'webhook_rejected', reason: 'bad_signature' }),
      expect.any(String),
    );
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
    await expect(svc.ingest(input)).resolves.toBe('ACCEPTED');
  });
});

describe('PaymentWebhookService — conciliação da liquidação (US-8.5)', () => {
  it('evento válido enfileira a conciliação com o payload bruto e jobId determinístico', async () => {
    const { svc, enqueue } = make();
    await expect(svc.ingest(input)).resolves.toBe('ACCEPTED');
    expect(enqueue).toHaveBeenCalledWith(
      'payment-reconciliation',
      'reconcile',
      expect.objectContaining({
        gateway: 'MOCK',
        event: expect.objectContaining({ eventId: 'evt_1' }),
        rawPayload: { x: 1 },
      }),
      // Sem `:` — o BullMQ recusa custom id com dois-pontos (regressão pega no int-spec).
      expect.objectContaining({ jobId: expect.stringMatching(/^MOCK_[0-9a-f]{64}$/) }),
    );
  });

  /**
   * O dedup em Redis protege a MÁQUINA DE ESTADOS, não a receita. A idempotência de
   * `payments` é a UNIQUE do banco — por isso a reentrega precisa continuar chegando à
   * fila, senão uma queda entre o `SET NX` e a gravação perderia a liquidação para sempre.
   */
  it('reentrega (dedup do Redis) ainda enfileira a conciliação, mas não reaplica a transição', async () => {
    const { svc, enqueue, applyGatewayEvent } = make({ fresh: false });
    await svc.ingest(input);
    expect(enqueue).toHaveBeenCalledWith(
      'payment-reconciliation',
      'reconcile',
      expect.anything(),
      expect.anything(),
    );
    expect(applyGatewayEvent).not.toHaveBeenCalled();
  });

  it('o payload bruto NUNCA vai para o log de aplicação', async () => {
    const { svc, logger } = make();
    await svc.ingest({ ...input, rawBody: Buffer.from('{"card":"4111111111111111"}') });
    const logged = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls]);
    expect(logged).not.toContain('4111111111111111');
    expect(logged).not.toContain('card');
  });
});
