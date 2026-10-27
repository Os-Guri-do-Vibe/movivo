import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import type { DomainEventType } from '@movivo/shared';

import { domainEventReceipts, domainEvents } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { QUEUE } from '../jobs/jobs.config';
import { WorkerFactory } from '../jobs/worker.factory';
import { DomainEventHandlers, type DomainEvent } from './domain-event-handlers';
import type { DomainEventJob } from './outbox-relay';

/**
 * Entrega cada evento a todos os consumidores registrados para o tipo. Consumidor com recibo
 * é pulado; o recibo é gravado depois do sucesso. Se um consumidor falha, o job falha e o
 * retry da fila reentrega o evento — só os consumidores sem recibo rodam de novo.
 */
@Injectable()
export class DomainEventDispatcher implements OnModuleInit {
  constructor(
    private readonly db: TenantDatabase,
    private readonly handlers: DomainEventHandlers,
    private readonly workers: WorkerFactory,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DomainEventDispatcher.name);
  }

  onModuleInit(): void {
    this.workers.create<DomainEventJob>(QUEUE.domainEvents, (job) =>
      this.dispatch(job.data.eventId),
    );
  }

  async dispatch(eventId: string): Promise<{ delivered: string[]; skipped: string[] }> {
    const event = await this.load(eventId);
    const delivered: string[] = [];
    const skipped: string[] = [];
    if (!event) return { delivered, skipped };

    for (const handler of this.handlers.for(event.type)) {
      if (await this.hasReceipt(event.id, handler.name)) {
        skipped.push(handler.name);
        continue;
      }
      await handler.handle(event);
      await this.db.runAsSystem((tx) =>
        tx
          .insert(domainEventReceipts)
          .values({ eventId: event.id, consumer: handler.name })
          .onConflictDoNothing(),
      );
      delivered.push(handler.name);
    }
    this.logger.debug({ eventId, type: event.type, delivered, skipped }, 'evento entregue');
    return { delivered, skipped };
  }

  private async load(eventId: string): Promise<DomainEvent | null> {
    const [row] = await this.db.runAsSystem((tx) =>
      tx.select().from(domainEvents).where(eq(domainEvents.id, eventId)).limit(1),
    );
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      type: row.type as DomainEventType,
      payload: row.payload,
      occurredAt: row.occurredAt,
    };
  }

  private async hasReceipt(eventId: string, consumer: string): Promise<boolean> {
    const rows = await this.db.runAsSystem((tx) =>
      tx
        .select({ eventId: domainEventReceipts.eventId })
        .from(domainEventReceipts)
        .where(
          and(eq(domainEventReceipts.eventId, eventId), eq(domainEventReceipts.consumer, consumer)),
        )
        .limit(1),
    );
    return rows.length > 0;
  }
}
