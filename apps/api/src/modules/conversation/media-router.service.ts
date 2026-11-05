/**
 * Roteador das fotos e PDFs que chegam no WhatsApp. Antes toda imagem era tratada como exame;
 * agora a foto do prato vira registro alimentar, o exame segue para a leitura da medicina e o
 * resto recebe uma resposta honesta do que dá para fazer por aqui.
 *
 * PDF é sempre exame. Para imagem, um classificador visual barato decide o destino (com a legenda
 * e o lembrete de refeição mais recente como pistas).
 */
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { AgentRunner, AgentTaskError } from '../../core/agents/agent-runner';
import {
  MEDIA_EXAM_EVENT,
  MEDIA_INBOUND_EVENT,
  type InboundMediaEvent,
} from '../../core/event-bus/events';
import { DomainEventBus } from '../../core/event-bus/event-bus.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import {
  WHATSAPP_BUBBLE_SEPARATOR,
  type WhatsappOutboundJob,
} from '../jobs/whatsapp-outbound.contract';
import { imageKindTask } from '../vision/vision-tasks';
import { ConversationStore } from './conversation-store';
import { FoodChatService } from './food-chat.service';

const NO_CONTEXT = {
  methodology: async () => ({ text: '', versions: {} }),
  state: async () => ({ slices: {}, version: 0 }),
};

export const WORKOUT_SCREEN_MESSAGE =
  'Recebi o print do treino! Para ele entrar no seu acompanhamento, importe pelo seu link de treino (é rapidinho).';
export const BODY_PHOTO_MESSAGE =
  'Recebi a foto, mas por aqui eu não faço a avaliação física: ela acontece na reavaliação do seu ciclo, pelo link que eu te mando. Se era uma refeição, me conta por texto o que comeu.';
export const OTHER_IMAGE_MESSAGE =
  'Recebi a imagem, mas não identifiquei uma refeição nem um exame. Se for o seu prato, me manda de novo com uma legendinha ou me conta por texto o que comeu.';

@Injectable()
export class MediaRouterService implements OnModuleInit, OnModuleDestroy {
  private unregister?: () => void;

  constructor(
    private readonly events: DomainEventBus,
    private readonly runner: AgentRunner,
    private readonly foodChat: FoodChatService,
    private readonly store: ConversationStore,
    private readonly queues: QueueManager,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MediaRouterService.name);
  }

  onModuleInit(): void {
    this.unregister = this.events.register<InboundMediaEvent, boolean>(MEDIA_INBOUND_EVENT, (e) =>
      this.route(e),
    );
  }

  onModuleDestroy(): void {
    this.unregister?.();
  }

  /** `true` = recebido por quem cuida do assunto. */
  async route(event: InboundMediaEvent): Promise<boolean> {
    if (event.mediaType === 'application/pdf') return this.toExam(event);

    const pending = await this.redis.get(this.keys.forUser(event.userId, 'meal-log', 'pending'));
    let kind: 'MEAL' | 'EXAM' | 'WORKOUT_SCREEN' | 'BODY' | 'OTHER';
    try {
      const run = await this.runner.run(
        imageKindTask,
        { caption: event.caption ?? null, expectingMeal: pending !== null },
        {
          userId: event.userId,
          sources: NO_CONTEXT,
          images: [
            { type: 'image', mediaType: event.mediaType, base64: event.bytes.toString('base64') },
          ],
        },
      );
      kind = run.output.kind;
    } catch (error) {
      if (!(error instanceof AgentTaskError)) throw error;
      // Sem classificação, o comportamento antigo (exame) segue: nunca perder um exame.
      this.logger.warn({ userId: event.userId }, 'foto sem classificação: segue como exame');
      return this.toExam(event);
    }

    switch (kind) {
      case 'MEAL':
        return this.meal(event);
      case 'EXAM':
        return this.toExam(event);
      case 'WORKOUT_SCREEN':
        await this.reply(event, 'workout-screen', WORKOUT_SCREEN_MESSAGE);
        return true;
      case 'BODY':
        await this.reply(event, 'body-photo', BODY_PHOTO_MESSAGE);
        return true;
      case 'OTHER':
        await this.reply(event, 'other-image', OTHER_IMAGE_MESSAGE);
        return true;
    }
  }

  private async toExam(event: InboundMediaEvent): Promise<boolean> {
    return (
      (await this.events.request<InboundMediaEvent, boolean>(MEDIA_EXAM_EVENT, event)) === true
    );
  }

  private async meal(event: InboundMediaEvent): Promise<boolean> {
    if (event.mediaType === 'application/pdf') return false;
    try {
      const reply = await this.foodChat.logPhoto(
        event.userId,
        { mediaType: event.mediaType, base64: event.bytes.toString('base64') },
        event.caption ?? null,
      );
      await this.reply(event, 'meal-photo', reply.messages.join(WHATSAPP_BUBBLE_SEPARATOR));
      return true;
    } catch (error) {
      this.logger.warn(
        { userId: event.userId, err: error instanceof Error ? error.message : 'erro' },
        'registro por foto falhou',
      );
      await this.reply(
        event,
        'meal-photo-failed',
        'Não consegui ler bem essa foto do prato. Pode me contar por texto ou áudio o que você comeu?',
      );
      return true;
    }
  }

  private async reply(event: InboundMediaEvent, tag: string, text: string): Promise<void> {
    await this.store.persistTurn({
      userId: event.userId,
      direction: 'OUTBOUND',
      content: text,
      validationPassed: true,
    });
    const dedupeId = `${tag}_${event.messageKey}`;
    const job: WhatsappOutboundJob = {
      userId: event.userId,
      type: 'CONVERSATION_MESSAGE',
      text,
      dedupeId,
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'agent-message', job, {
      jobId: `agent-message_${dedupeId}`,
    });
  }
}
