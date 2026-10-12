import { QUEUE } from './jobs.config';
import { type QueueManager } from './queue-manager.service';
import { type StaffQueueAlertKind, type WhatsappOutboundJob } from './whatsapp-outbound.contract';

/**
 * Avisa o profissional, por WhatsApp, que um item novo entrou na fila de revisão. Melhor
 * esforço: falhar aqui nunca pode desfazer nem atrasar a criação do protocolo/proposta.
 * `refId` (protocolo ou proposta) é a chave de idempotência — reentrega do mesmo item não
 * duplica o alerta. O destino e o texto são resolvidos no worker de outbound.
 */
export async function enqueueStaffQueueAlert(
  queues: QueueManager,
  logger: { warn(obj: object, msg: string): void },
  input: { userId: string; kind: StaffQueueAlertKind; refId: string },
): Promise<void> {
  const job: WhatsappOutboundJob = {
    userId: input.userId,
    type: 'STAFF_QUEUE_ALERT',
    staffAlertKind: input.kind,
    dedupeId: input.refId,
  };
  try {
    await queues.enqueue(QUEUE.whatsappOutbound, 'staff-queue-alert', job, {
      jobId: `staff-queue-alert-${input.kind}-${input.refId}`,
    });
  } catch (err) {
    logger.warn(
      { event: 'staff_queue_alert_enqueue_failed', kind: input.kind, err: (err as Error).message },
      'não foi possível enfileirar o alerta ao profissional',
    );
  }
}
