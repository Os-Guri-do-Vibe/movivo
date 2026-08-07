import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { z } from 'zod';

import { CHECKIN_INBOUND_EVENT, type CheckinInboundEvent } from '../../core/event-bus/events';
import { DomainEventBus } from '../../core/event-bus/event-bus.service';
import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import { CheckinService } from './checkin.service';

const routeSchema = z.object({
  text: z.string().max(4096),
  buttonId: z.string().max(100).optional(),
});

@Injectable()
export class CheckinInboundHandler implements OnModuleInit, OnModuleDestroy {
  private unregister?: () => void;

  constructor(
    private readonly events: DomainEventBus,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly checkins: CheckinService,
  ) {}

  onModuleInit(): void {
    this.unregister = this.events.register<CheckinInboundEvent, boolean>(
      CHECKIN_INBOUND_EVENT,
      async ({ userId, routeKey }) => {
        const raw = await this.redis.get(routeKey);
        if (!raw) return false;
        try {
          const route = routeSchema.parse(JSON.parse(raw));
          return this.checkins.tryHandleInbound(userId, route.buttonId, route.text);
        } finally {
          await this.redis.del(routeKey);
        }
      },
    );
  }

  onModuleDestroy(): void {
    this.unregister?.();
  }
}
