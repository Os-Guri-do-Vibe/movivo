import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, lt, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import type { DomainEventType } from '@movivo/shared';

import { domainEventReceipts, domainEvents } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { QUEUE } from '../jobs/jobs.config';
import { WorkerFactory } from '../jobs/worker.factory';
import { DomainEventHandlers, type DomainEvent } from './domain-event-handlers';
import type { DomainEventJob } from './outbox-relay';

/** Quanto tempo uma reivindicação sem conclusão vale antes de poder ser retomada. */
const CLAIM_LEASE_SECONDS = 300;

/**
 * Entrega cada evento a todos os consumidores registrados para o tipo. O consumidor é
 * reivindicado antes de rodar (duas entregas simultâneas não executam em paralelo) e concluído
 * depois. Se falha, a reivindicação é liberada e o job falha: o retry da fila reentrega só a
 * quem não terminou. Se o processo cai no meio, a reivindicação vence e o retry assume —
 * entrega ao menos uma vez, então todo consumidor continua precisando ser idempotente.
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
      if (!(await this.claim(event.id, handler.name))) {
        skipped.push(handler.name);
        continue;
      }
      try {
        await handler.handle(event);
      } catch (error) {
        // Libera a reivindicação: o retry da fila reentrega só a quem não terminou.
        await this.release(event.id, handler.name);
        throw error;
      }
      await this.complete(event.id, handler.name);
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

  /**
   * Reivindica (evento, consumidor). Devolve `false` se outro despacho já concluiu ou ainda está
   * processando dentro do prazo. Reivindicação vencida (processo caiu) é retomada.
   */
  private async claim(eventId: string, consumer: string): Promise<boolean> {
    const rows = await this.db.runAsSystem((tx) =>
      tx
        .insert(domainEventReceipts)
        .values({ eventId, consumer })
        .onConflictDoUpdate({
          target: [domainEventReceipts.eventId, domainEventReceipts.consumer],
          set: { claimedAt: sql`now()` },
          setWhere: and(
            eq(domainEventReceipts.status, 'PROCESSING'),
            lt(
              domainEventReceipts.claimedAt,
              sql`now() - make_interval(secs => ${CLAIM_LEASE_SECONDS})`,
            ),
          ),
        })
        .returning({ eventId: domainEventReceipts.eventId }),
    );
    return rows.length > 0;
  }

  private async complete(eventId: string, consumer: string): Promise<void> {
    await this.db.runAsSystem((tx) =>
      tx
        .update(domainEventReceipts)
        .set({ status: 'DONE', processedAt: new Date() })
        .where(
          and(eq(domainEventReceipts.eventId, eventId), eq(domainEventReceipts.consumer, consumer)),
        ),
    );
  }

  private async release(eventId: string, consumer: string): Promise<void> {
    await this.db.runAsSystem((tx) =>
      tx
        .delete(domainEventReceipts)
        .where(
          and(
            eq(domainEventReceipts.eventId, eventId),
            eq(domainEventReceipts.consumer, consumer),
            eq(domainEventReceipts.status, 'PROCESSING'),
          ),
        ),
    );
  }
}
