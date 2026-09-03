import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import type { CheckinInboundEvent } from '../../core/event-bus/events';
import type { DomainEventBus } from '../../core/event-bus/event-bus.service';
import type { QueueManager } from '../jobs/queue-manager.service';
import { WORKOUT_DONE_ACK, WORKOUT_SKIPPED_ACK } from './workout-messages';
import { WorkoutInboundHandler } from './workout-inbound.handler';
import type { WorkoutCompletionService } from './workout-completion.service';
import type { WorkoutJournalService } from './workout-journal.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';

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
  const recordFromQuickReply = vi.fn(async () => true);
  const enqueue = vi.fn(async () => 'job');
  const respondToInsight = vi.fn(async () => true);
  const handler = new WorkoutInboundHandler(
    events,
    redis,
    { recordFromQuickReply } as unknown as WorkoutCompletionService,
    { respondToInsight } as unknown as WorkoutJournalService,
    { enqueue } as unknown as QueueManager,
  );
  handler.onModuleInit();
  return {
    handler,
    unregister,
    redis,
    recordFromQuickReply,
    enqueue,
    run: () => callback?.({ userId: USER_ID, routeKey: 'route' }),
  };
}

describe('WorkoutInboundHandler', () => {
  it('falha fechado quando a referência efêmera expirou', async () => {
    const { run, recordFromQuickReply } = makeHandler(null);
    await expect(run()).resolves.toBe(false);
    expect(recordFromQuickReply).not.toHaveBeenCalled();
  });

  it('deixa a routeKey intacta quando o botão não é do treino (cadeia continua)', async () => {
    const { run, redis, recordFromQuickReply, enqueue } = makeHandler({
      text: 'tudo certo',
      buttonId: 'checkin:PAIN:NENHUMA',
    });

    await expect(run()).resolves.toBe(false);
    expect(redis.del).not.toHaveBeenCalled();
    expect(recordFromQuickReply).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('"Treinei" registra a conclusão do dia previsto e confirma o recebimento', async () => {
    const { run, redis, recordFromQuickReply, enqueue } = makeHandler({
      text: 'Treinei ✅',
      buttonId: 'workout:DONE:2026-08-10:A',
    });

    await expect(run()).resolves.toBe(true);
    expect(recordFromQuickReply).toHaveBeenCalledWith(USER_ID, '2026-08-10', 'A');
    expect(redis.del).toHaveBeenCalledWith('route');
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'workout-quick-reply-ack',
      expect.objectContaining({
        userId: USER_ID,
        type: 'WORKOUT_QUICK_REPLY',
        dedupeId: 'workout-ack-2026-08-10',
        text: WORKOUT_DONE_ACK,
      }),
      { jobId: `wa-workout-ack-${USER_ID}-2026-08-10` },
    );
  });

  it('"Hoje não" NÃO grava conclusão — ausência de registro é o sinal —, mas reconhece o toque', async () => {
    const { run, recordFromQuickReply, enqueue } = makeHandler({
      text: 'Hoje não',
      buttonId: 'workout:SKIP:2026-08-10:A',
    });

    await expect(run()).resolves.toBe(true);
    expect(recordFromQuickReply).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'workout-quick-reply-ack',
      expect.objectContaining({ text: WORKOUT_SKIPPED_ACK }),
      { jobId: `wa-workout-ack-${USER_ID}-2026-08-10` },
    );
  });

  it('o jobId do ack é determinístico por dia — dois toques no mesmo dia não duplicam a mensagem', async () => {
    const { run, enqueue } = makeHandler({
      text: 'Treinei ✅',
      buttonId: 'workout:DONE:2026-08-10:A',
    });

    await run();
    await run();

    const [first, second] = enqueue.mock.calls as unknown as unknown[][];
    expect(first?.[3]).toEqual(second?.[3]);
    expect(first?.[3]).toEqual({ jobId: `wa-workout-ack-${USER_ID}-2026-08-10` });
  });

  it('libera o registro no bus ao destruir o módulo', () => {
    const { handler, unregister } = makeHandler(null);
    handler.onModuleDestroy();
    expect(unregister).toHaveBeenCalledOnce();
  });
});
