/**
 * Avisa a equipe por WhatsApp quando um caso URGENTE ou de ALTA prioridade entra na fila (sinal
 * de segurança, falha de decisão). O texto leva só tipo e prioridade: sem nome nem dado de saúde.
 * Idempotente: o `caseId` é a chave do alerta.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { exceptionCases } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import {
  DomainEventHandlers,
  type DomainEvent,
  type DomainEventHandler,
} from '../domain-events/domain-event-handlers';
import { enqueueStaffQueueAlert } from '../jobs/staff-queue-alert';
import { QueueManager } from '../jobs/queue-manager.service';
import { staffQueueAlertMessage } from '../whatsapp/message-templates';

const KIND_LABEL: Readonly<Record<string, string>> = {
  SAFETY: 'sinal de segurança',
  NO_APPLICABLE_POLICY: 'decisão humana necessária',
  STUDENT_REVIEW_REQUEST: 'aluno pediu revisão',
  DECISION_FAILURE: 'falha ao executar uma decisão',
  CONVERSATION_TAKEOVER: 'conversa assumida',
};
const PRIORITY_LABEL: Readonly<Record<string, string>> = { URGENT: 'urgente', HIGH: 'alta' };

@Injectable()
export class ExceptionAlertHandler implements DomainEventHandler, OnModuleInit {
  readonly name = 'exception-staff-alert';
  readonly eventTypes = ['ExceptionOpened'] as const;

  constructor(
    private readonly handlers: DomainEventHandlers,
    private readonly db: TenantDatabase,
    private readonly queues: QueueManager,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ExceptionAlertHandler.name);
  }

  onModuleInit(): void {
    this.handlers.register(this);
  }

  async handle(event: DomainEvent): Promise<void> {
    const caseId = (event.payload as { exceptionCaseId?: string }).exceptionCaseId;
    if (!caseId) return;
    const [row] = await this.db.runAsSystem((tx) =>
      tx
        .select({ kind: exceptionCases.kind, priority: exceptionCases.priority })
        .from(exceptionCases)
        .where(eq(exceptionCases.id, caseId)),
    );
    const priority = row ? PRIORITY_LABEL[row.priority] : undefined;
    if (!row || !priority) return;
    await enqueueStaffQueueAlert(this.queues, this.logger, {
      caseId,
      text: staffQueueAlertMessage(KIND_LABEL[row.kind] ?? row.kind, priority),
    });
  }
}
