import { Injectable, type OnModuleInit } from '@nestjs/common';
import { inArray, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { domainEvents } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';

/** Job do dispatcher: só o id — o consumidor relê o evento no banco. */
export interface DomainEventJob {
  eventId: string;
}

type RelayJob = { kind: 'SCAN' | 'KICK' };

/** Eventos publicados por execução do relé. */
const RELAY_BATCH = 200;
/** Varredura de segurança: pega o que um `flushSoon` perdido deixou para trás. */
const RELAY_SCAN_EVERY_MS = 10_000;

/**
 * Relé do outbox: lê `domain_events` não publicados e enfileira um job por evento na fila
 * `domain-events`, com `jobId` = id do evento (o BullMQ não duplica um job ainda presente).
 *
 * O SELECT usa `FOR UPDATE SKIP LOCKED`: duas execuções simultâneas nunca publicam o mesmo
 * lote. Se o enqueue der certo e o commit falhar, o evento volta a sair no próximo ciclo — o
 * recibo por consumidor no dispatcher absorve a duplicata.
 */
@Injectable()
export class OutboxRelay implements OnModuleInit {
  constructor(
    private readonly db: TenantDatabase,
    private readonly queues: QueueManager,
    private readonly workers: WorkerFactory,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutboxRelay.name);
  }

  async onModuleInit(): Promise<void> {
    this.workers.create<RelayJob>(QUEUE.outboxRelay, async () => ({
      published: await this.relay(),
    }));
    await this.queues
      .get(QUEUE.outboxRelay)
      .upsertJobScheduler(
        'outbox-relay-scan',
        { every: RELAY_SCAN_EVERY_MS },
        { name: 'outbox-relay-scan', data: { kind: 'SCAN' } satisfies RelayJob },
      );
  }

  /**
   * Pede uma publicação imediata (chamar DEPOIS do commit da transação que gravou o evento).
   * Pedidos simultâneos colapsam num só job via deduplicação do BullMQ.
   */
  async flushSoon(): Promise<void> {
    await this.queues.enqueue(
      QUEUE.outboxRelay,
      'outbox-relay-kick',
      { kind: 'KICK' },
      {
        deduplication: { id: 'outbox-relay-kick' },
      },
    );
  }

  /** Publica um lote. Devolve quantos eventos saíram. */
  async relay(): Promise<number> {
    return this.db.runAsSystem(async (tx) => {
      const pending = await tx.execute<{ id: string; type: string }>(
        sql`select id, type from ${domainEvents}
            where ${domainEvents.publishedAt} is null
            order by ${domainEvents.occurredAt}
            limit ${RELAY_BATCH}
            for update skip locked`,
      );
      if (pending.length === 0) return 0;
      for (const event of pending) {
        await this.queues.enqueue(
          QUEUE.domainEvents,
          event.type,
          { eventId: event.id } satisfies DomainEventJob,
          { jobId: event.id },
        );
      }
      await tx
        .update(domainEvents)
        .set({ publishedAt: new Date(), attempts: sql`${domainEvents.attempts} + 1` })
        .where(
          inArray(
            domainEvents.id,
            pending.map((event) => event.id),
          ),
        );
      this.logger.debug({ published: pending.length }, 'eventos de domínio publicados');
      return pending.length;
    });
  }
}
