/**
 * Ingestão do quick reply de ajuste de duração de treino (US-8.1 / TASK-8.1.3).
 *
 * Mesma cadeia de responsabilidade do `CheckinInboundHandler`, consultada logo antes
 * dele em `WhatsappInboundService`. Diferença deliberada: este handler **só apaga a
 * `routeKey` quando de fato tratou a mensagem** — se o botão não é `workout-insight:*`, a
 * rota precisa continuar existindo para o check-in ler em seguida.
 *
 * Achado 2026-09-12 (decisão do fundador): o quick reply "Treinei ✅"/"Hoje não" (US-8.1
 * original) foi REMOVIDO deste handler — nunca chegou a ser enviado por nenhum scheduler,
 * e "treinou" deixou de admitir qualquer canal de WhatsApp (ver `workout-messages.ts`).
 * Só o ack do insight de duração permanece.
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
import { parseDurationInsightButton } from './workout-messages';
import { WorkoutJournalService } from './workout-journal.service';

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
    private readonly journal: WorkoutJournalService,
    private readonly queues: QueueManager,
  ) {}

  onModuleInit(): void {
    this.unregister = this.events.register<CheckinInboundEvent, boolean>(
      WORKOUT_INBOUND_EVENT,
      async ({ userId, routeKey }) => {
        const raw = await this.redis.get(routeKey);
        if (!raw) return false;
        const route = routeSchema.parse(JSON.parse(raw));
        const insight = parseDurationInsightButton(route.buttonId);
        if (!insight) return false; // não é nosso: deixa a routeKey para o próximo handler
        await this.redis.del(routeKey);
        await this.journal.respondToInsight(userId, insight.id, insight.adjust);
        await this.queues.enqueue(
          QUEUE.whatsappOutbound,
          'workout-insight-ack',
          {
            userId,
            type: 'WORKOUT_INSIGHT',
            dedupeId: `workout-insight-ack-${insight.id}`,
            text: insight.adjust
              ? 'Pedido enviado ao profissional CREF da MOVIVO para avaliacao.'
              : 'Perfeito, vamos manter como esta e continuar acompanhando.',
          } satisfies WhatsappOutboundJob,
          { jobId: `wa-workout-insight-ack-${insight.id}` },
        );
        return true;
      },
    );
  }

  onModuleDestroy(): void {
    this.unregister?.();
  }
}
