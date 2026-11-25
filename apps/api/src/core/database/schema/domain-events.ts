/**
 * `domain_events` — transactional outbox dos eventos de domínio.
 *
 * O evento é gravado na MESMA transação da mudança de estado que ele descreve; um relé lê as
 * linhas não publicadas e as entrega às filas. Assim nunca existe estado novo sem evento, nem
 * evento de algo que foi desfeito por rollback. Consumidores deduplicam por `id`.
 */
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, primaryKey, smallint, uuid, varchar } from 'drizzle-orm/pg-core';

import { domainEventTypeSchema, type DomainEventPayload } from '@movivo/shared';

import { checkOneOf, eventTimestamp, primaryKeyColumn } from './_shared';
import { users } from './users';

export const domainEvents = pgTable(
  'domain_events',
  {
    id: primaryKeyColumn(),
    /** Titular afetado; nulo para eventos sem titular (ex.: metodologia publicada). */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 40 }).notNull(),
    payload: jsonb('payload').$type<DomainEventPayload>().notNull(),
    occurredAt: eventTimestamp('occurred_at').notNull().defaultNow(),
    publishedAt: eventTimestamp('published_at'),
    attempts: smallint('attempts').notNull().default(0),
  },
  (t) => [
    index('idx_domain_events_unpublished')
      .on(t.occurredAt)
      .where(sql`${t.publishedAt} is null`),
    index('idx_domain_events_user').on(t.userId, t.occurredAt),
    checkOneOf('ck_domain_events_type', t.type, domainEventTypeSchema.options),
  ],
);

/**
 * Recibo de processamento: (evento, consumidor). O dispatcher REIVINDICA o recibo antes de
 * chamar o consumidor (`PROCESSING`) e o conclui depois (`DONE`): duas entregas simultâneas do
 * mesmo evento ao mesmo consumidor nunca executam em paralelo. Reivindicação que ficou para trás
 * (processo caiu no meio) pode ser retomada depois do prazo. Falha do consumidor libera a
 * reivindicação para o retry. Sem dado de titular (só ids), por isso fora da RLS.
 */
export const domainEventReceipts = pgTable(
  'domain_event_receipts',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => domainEvents.id, { onDelete: 'cascade' }),
    consumer: varchar('consumer', { length: 60 }).notNull(),
    status: varchar('status', { length: 12 }).notNull().default('PROCESSING'),
    claimedAt: eventTimestamp('claimed_at').notNull().defaultNow(),
    processedAt: eventTimestamp('processed_at'),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.consumer] }),
    checkOneOf('ck_domain_event_receipts_status', t.status, ['PROCESSING', 'DONE']),
  ],
);
