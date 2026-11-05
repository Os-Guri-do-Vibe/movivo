/**
 * Envio de mensagens que os agentes iniciam (retorno de treino, orientação de dor, busca ativa…):
 * grava o turno na conversa do aluno (a memória de curto prazo dos agentes) e enfileira o
 * WhatsApp. `dedupeId` torna o envio idempotente: o mesmo fato nunca vira duas mensagens.
 */
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { ConversationStore } from '../conversation/conversation-store';
import type { FollowUpJob } from '../jobs/follow-up.contract';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import {
  WHATSAPP_BUBBLE_SEPARATOR,
  type WhatsappOutboundJob,
} from '../jobs/whatsapp-outbound.contract';

@Injectable()
export class AgentMessenger {
  constructor(
    private readonly store: ConversationStore,
    private readonly queues: QueueManager,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AgentMessenger.name);
  }

  async send(userId: string, messages: readonly string[], dedupeId: string): Promise<void> {
    const text = messages.join(WHATSAPP_BUBBLE_SEPARATOR);
    await this.store.persistTurn({
      userId,
      direction: 'OUTBOUND',
      content: text,
      validationPassed: true,
    });
    const job: WhatsappOutboundJob = { userId, type: 'CONVERSATION_MESSAGE', text, dedupeId };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'agent-message', job, {
      jobId: `agent-message_${dedupeId}`,
    });
    await this.audit(userId, dedupeId, text);
  }

  /** Auditoria de qualidade: melhor esforço, nunca atrapalha o envio. */
  private async audit(userId: string, dedupeId: string, text: string): Promise<void> {
    try {
      const flow = dedupeId.split('_')[0]?.slice(0, 40) || 'agent';
      const review: FollowUpJob = { kind: 'QUALITY_REVIEW', userId, dedupeId, flow, text };
      await this.queues.enqueue(QUEUE.studentFollowUp, 'quality-review', review, {
        jobId: `quality-review_${userId}_${dedupeId}`.slice(0, 200),
      });
    } catch (err: unknown) {
      this.logger.warn({ userId, err, event: 'quality_enqueue_failed' }, 'auditoria não agendada');
    }
  }
}
