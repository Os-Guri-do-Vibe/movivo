/**
 * Dead Letter Queue — hook genérico (US-1.7 / TASK-1.7.2, ARQUITETURA §6).
 *
 * Job que falha DEPOIS de esgotar os retries cai na DLQ e dispara este hook. A
 * implementação concreta de §6 (alerta Sentry + fallback WhatsApp + task manual no
 * dashboard) é de sprints futuras — aqui fica a INTERFACE + um handler default que
 * apenas loga de forma estruturada. Trocar por DI é suficiente para plugar o real.
 *
 * O payload nunca carrega PII em claro (§ payload de job = `userId` UUID) — o record
 * copia `data` como veio, então quem enfileira é responsável por não pôr telefone/saúde
 * em claro. Aqui só registramos o que falhou e por quê.
 */
import { Injectable } from '@nestjs/common';
import { type Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';

export interface DeadLetterRecord {
  readonly queue: string;
  readonly jobId: string;
  readonly name: string;
  readonly attemptsMade: number;
  readonly failedReason: string;
  readonly correlationId?: string;
  readonly data: unknown;
}

export interface DeadLetterHandler {
  handle(record: DeadLetterRecord): Promise<void>;
}

export const DEAD_LETTER_HANDLER = Symbol('MOVIVO_DEAD_LETTER_HANDLER');

/** `true` quando o job esgotou todas as tentativas (falha terminal → DLQ). */
export function isFinalFailure(job: Pick<Job, 'attemptsMade' | 'opts'>): boolean {
  const max = job.opts.attempts ?? 1;
  return job.attemptsMade >= max;
}

/** Extrai o record de DLQ de um job falho, sem vazar o objeto inteiro do BullMQ. */
export function toDeadLetterRecord(queue: string, job: Job, reason: string): DeadLetterRecord {
  const correlationId =
    typeof (job.data as { correlationId?: unknown })?.correlationId === 'string'
      ? (job.data as { correlationId: string }).correlationId
      : undefined;
  return {
    queue,
    jobId: job.id ?? 'unknown',
    name: job.name,
    attemptsMade: job.attemptsMade,
    failedReason: reason,
    correlationId,
    data: job.data,
  };
}

/**
 * Handler default: loga em nível `error` com correlation id. Implementação real
 * (Sentry/WhatsApp/task manual) substitui este provider por DI numa sprint futura.
 */
@Injectable()
export class LoggingDeadLetterHandler implements DeadLetterHandler {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(LoggingDeadLetterHandler.name);
  }

  async handle(record: DeadLetterRecord): Promise<void> {
    this.logger.error(
      {
        queue: record.queue,
        jobId: record.jobId,
        jobName: record.name,
        attemptsMade: record.attemptsMade,
        failedReason: record.failedReason,
        correlationId: record.correlationId,
      },
      'job caiu na dead-letter queue após esgotar os retries',
    );
  }
}
