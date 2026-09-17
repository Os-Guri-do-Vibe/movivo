import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import type { CheckinInboundEvent } from '../../core/event-bus/events';
import type { DomainEventBus } from '../../core/event-bus/event-bus.service';
import type { QueueManager } from '../jobs/queue-manager.service';
import { WorkoutInboundHandler } from './workout-inbound.handler';
import type { WorkoutJournalService } from './workout-journal.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const INSIGHT_ID = '22222222-2222-4222-8222-222222222222';

function makeHandler(route: unknown) {
  let callback: ((payload: CheckinInboundEvent) => Promise<boolean>) | undefined;
  const unregister = vi.fn();
  const events = {
    register: vi.fn((_event, handler) => {
      callback = handler;
      return unregister;
    }),
  } as unknown as DomainEventBus;
  const redis = {
    get: vi.fn(async () => (route === null ? null : JSON.stringify(route))),
    del: vi.fn(async () => 1),
  } as unknown as Redis;
  const enqueue = vi.fn(async () => 'job');
  const respondToInsight = vi.fn(async () => true);
  const handler = new WorkoutInboundHandler(
    events,
    redis,
    { respondToInsight } as unknown as WorkoutJournalService,
    { enqueue } as unknown as QueueManager,
  );
  handler.onModuleInit();
  return {
    handler,
    unregister,
    redis,
    respondToInsight,
    enqueue,
    run: () => callback?.({ userId: USER_ID, routeKey: 'route' }),
  };
}

describe('WorkoutInboundHandler', () => {
  it('falha fechado quando a referência efêmera expirou', async () => {
    const { run, respondToInsight } = makeHandler(null);
    await expect(run()).resolves.toBe(false);
    expect(respondToInsight).not.toHaveBeenCalled();
  });

  it('deixa a routeKey intacta quando o botão não é do insight de duração (cadeia continua)', async () => {
    const { run, redis, respondToInsight, enqueue } = makeHandler({
      text: 'tudo certo',
      buttonId: 'checkin:PAIN:NENHUMA',
    });

    await expect(run()).resolves.toBe(false);
    expect(redis.del).not.toHaveBeenCalled();
    expect(respondToInsight).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('"Quero ajustar": registra o pedido e confirma o encaminhamento ao CREF', async () => {
    const { run, redis, respondToInsight, enqueue } = makeHandler({
      text: 'Quero ajustar',
      buttonId: `workout-insight:${INSIGHT_ID}:ADJUST`,
    });

    await expect(run()).resolves.toBe(true);
    expect(respondToInsight).toHaveBeenCalledWith(USER_ID, INSIGHT_ID, true);
    expect(redis.del).toHaveBeenCalledWith('route');
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'workout-insight-ack',
      expect.objectContaining({
        userId: USER_ID,
        type: 'WORKOUT_INSIGHT',
        dedupeId: `workout-insight-ack-${INSIGHT_ID}`,
        text: 'Pedido enviado ao profissional CREF da MOVIVO para avaliacao.',
      }),
      { jobId: `wa-workout-insight-ack-${INSIGHT_ID}` },
    );
  });

  it('"Esta tranquilo": reconhece sem pedir ajuste', async () => {
    const { run, respondToInsight, enqueue } = makeHandler({
      text: 'Esta tranquilo',
      buttonId: `workout-insight:${INSIGHT_ID}:OK`,
    });

    await expect(run()).resolves.toBe(true);
    expect(respondToInsight).toHaveBeenCalledWith(USER_ID, INSIGHT_ID, false);
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'workout-insight-ack',
      expect.objectContaining({
        text: 'Perfeito, vamos manter como esta e continuar acompanhando.',
      }),
      { jobId: `wa-workout-insight-ack-${INSIGHT_ID}` },
    );
  });

  it('libera o registro no bus ao destruir o módulo', () => {
    const { handler, unregister } = makeHandler(null);
    handler.onModuleDestroy();
    expect(unregister).toHaveBeenCalledOnce();
  });
});
