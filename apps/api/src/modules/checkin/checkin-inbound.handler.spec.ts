import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import type { CheckinInboundEvent } from '../../core/event-bus/events';
import type { DomainEventBus } from '../../core/event-bus/event-bus.service';
import { CheckinInboundHandler } from './checkin-inbound.handler';
import type { CheckinService } from './checkin.service';

describe('CheckinInboundHandler', () => {
  it('resolve referencia efemera, processa e remove o payload do Redis', async () => {
    let callback: ((payload: CheckinInboundEvent) => Promise<boolean>) | undefined;
    const unregister = vi.fn();
    const events = {
      register: vi.fn((_event, handler) => {
        callback = handler;
        return unregister;
      }),
    } as unknown as DomainEventBus;
    const redis = {
      get: vi.fn(async () => JSON.stringify({ text: 'dor no quadril', buttonId: 'button' })),
      del: vi.fn(async () => 1),
    } as unknown as Redis;
    const tryHandleInbound = vi.fn(async () => true);
    const handler = new CheckinInboundHandler(events, redis, {
      tryHandleInbound,
    } as unknown as CheckinService);
    handler.onModuleInit();
    await expect(callback?.({ userId: 'u', routeKey: 'route' })).resolves.toBe(true);
    expect(tryHandleInbound).toHaveBeenCalledWith('u', 'button', 'dor no quadril');
    expect(redis.del).toHaveBeenCalledWith('route');
    handler.onModuleDestroy();
    expect(unregister).toHaveBeenCalledOnce();
  });

  it('falha fechado quando a referencia expirou', async () => {
    let callback: ((payload: CheckinInboundEvent) => Promise<boolean>) | undefined;
    const events = {
      register: vi.fn((_event, handler) => {
        callback = handler;
        return vi.fn();
      }),
    } as unknown as DomainEventBus;
    const handler = new CheckinInboundHandler(
      events,
      { get: vi.fn(async () => null) } as unknown as Redis,
      {} as CheckinService,
    );
    handler.onModuleInit();
    await expect(callback?.({ userId: 'u', routeKey: 'expired' })).resolves.toBe(false);
  });
});
