import { QUEUE } from './jobs.config';
import { type QueueManager } from './queue-manager.service';
import { type WhatsappOutboundJob } from './whatsapp-outbound.contract';

/**
 * Avisa a equipe, por WhatsApp, que um caso urgente entrou na fila de exceções. O texto leva só
 * o tipo e a prioridade, sem dado de saúde nem o nome do aluno: o conteúdo se vê no painel.
 * Melhor esforço: falhar aqui nunca pode desfazer o caso. `caseId` é a chave de idempotência.
 */
export async function enqueueStaffQueueAlert(
  queues: QueueManager,
  logger: { warn(obj: object, msg: string): void },
  input: { caseId: string; text: string },
): Promise<void> {
  const job: WhatsappOutboundJob = {
    userId: null,
    type: 'STAFF_QUEUE_ALERT',
    text: input.text,
    dedupeId: input.caseId,
  };
  try {
    await queues.enqueue(QUEUE.whatsappOutbound, 'staff-queue-alert', job, {
      jobId: `staff-queue-alert-${input.caseId}`,
    });
  } catch (err) {
    logger.warn(
      {
        event: 'staff_queue_alert_enqueue_failed',
        caseId: input.caseId,
        err: (err as Error).message,
      },
      'não foi possível enfileirar o alerta à equipe',
    );
  }
}
