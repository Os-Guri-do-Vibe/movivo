/**
 * Ingestão do quick reply de treino (US-8.1 / TASK-8.1.3).
 *
 * Mesma cadeia de responsabilidade do `CheckinInboundHandler`, consultada logo antes
 * dele em `WhatsappInboundService`. Diferença deliberada: este handler **só apaga a
 * `routeKey` quando de fato tratou a mensagem** — se o botão não é `workout:*`, a rota
 * precisa continuar existindo para o check-in ler em seguida.
 *
 * "Hoje não" **não grava nada**: ausência de registro já é o sinal (a US é explícita —
 * contagem inflada é pior que contagem ausente). O aluno ainda recebe o reconhecimento,
 * para o toque não parecer perdido.
 */
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { z } from 'zod';

import { WORKOUT_INBOUND_EVENT, type CheckinInboundEvent } from '../../core/event-bus/events';
import { DomainEventBus } from '../../core/event-bus/event-bus.service';
import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { WORKOUT_DONE_ACK, WORKOUT_SKIPPED_ACK, parseWorkoutButton } from './workout-messages';
import { WorkoutCompletionService } from './workout-completion.service';

const routeSchema = z.object({
  text: z.string().max(4096),
  buttonId: z.string().max(100).optional(),
});

@Injectable()
export class WorkoutInboundHandler implements OnModuleInit, OnModuleDestroy {
  private unregister?: () => void;

  constructor(
    private readonly events: DomainEventBus,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly completions: WorkoutCompletionService,
    private readonly queues: QueueManager,
  ) {}

  onModuleInit(): void {
    this.unregister = this.events.register<CheckinInboundEvent, boolean>(
      WORKOUT_INBOUND_EVENT,
      async ({ userId, routeKey }) => {
        const raw = await this.redis.get(routeKey);
        if (!raw) return false;
        const route = routeSchema.parse(JSON.parse(raw));
        const button = parseWorkoutButton(route.buttonId);
        if (!button) return false; // não é nosso: deixa a routeKey para o próximo handler
        await this.redis.del(routeKey);

        if (button.done) {
          await this.completions.recordFromQuickReply(
            userId,
            button.completedAt,
            button.sessionKey,
          );
        }
        await this.ack(userId, button.completedAt, button.done);
        return true;
      },
    );
  }

  onModuleDestroy(): void {
    this.unregister?.();
  }

  private async ack(userId: string, completedAt: string, done: boolean): Promise<void> {
    const job: WhatsappOutboundJob = {
      userId,
      type: 'WORKOUT_QUICK_REPLY',
      dedupeId: `workout-ack-${completedAt}`,
      text: done ? WORKOUT_DONE_ACK : WORKOUT_SKIPPED_ACK,
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'workout-quick-reply-ack', job, {
      jobId: `wa-workout-ack-${userId}-${completedAt}`,
    });
  }
}
