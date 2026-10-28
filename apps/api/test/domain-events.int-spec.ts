/**
 * Integração — outbox de eventos de domínio. Pré-requisito: `pnpm run infra:up`.
 *
 * Prova as três garantias do outbox com Postgres real:
 *  1. o evento vive e morre com a transação que mudou o estado (rollback = sem evento);
 *  2. o relé publica cada evento uma vez (marca `published_at`);
 *  3. o dispatcher entrega a cada consumidor uma vez — entregas concorrentes e reenvios são
 *     pulados, e a falha de um consumidor libera a reivindicação para o retry.
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';
import {
  domainEventReceipts,
  domainEvents,
  studentProfiles,
  users,
} from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { DomainEventDispatcher } from '../src/modules/domain-events/domain-event-dispatcher';
import {
  DomainEventHandlers,
  type DomainEvent,
} from '../src/modules/domain-events/domain-event-handlers';
import { DomainEventRecorder } from '../src/modules/domain-events/domain-event-recorder';
import { OutboxRelay } from '../src/modules/domain-events/outbox-relay';

let app: INestApplication;
let db: TenantDatabase;
let recorder: DomainEventRecorder;
let relay: OutboxRelay;
let dispatcher: DomainEventDispatcher;
let userId: string;
const received: DomainEvent[] = [];

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  db = app.get(TenantDatabase);
  recorder = app.get(DomainEventRecorder);
  relay = app.get(OutboxRelay);
  dispatcher = app.get(DomainEventDispatcher);
  app.get(DomainEventHandlers).register({
    name: 'teste.consumidor-de-perfil',
    eventTypes: ['ConstraintChanged'],
    handle: async (event) => {
      received.push(event);
    },
  });
  userId = await db.runAsSystem(async (tx) => {
    const phone = `+55119${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const [user] = await tx
      .insert(users)
      .values({ phoneNumber: phone, email: `${phone.replace(/\D/g, '')}@example.invalid` })
      .returning({ id: users.id });
    if (!user) throw new Error('falha ao criar usuário de teste');
    return user.id;
  });
});

afterAll(async () => {
  if (db && userId) {
    await db.runAsSystem((tx) => tx.delete(users).where(inArray(users.id, [userId])));
  }
  await app?.close();
});

function eventsOf(id: string) {
  return db.runAsSystem((tx) => tx.select().from(domainEvents).where(eq(domainEvents.userId, id)));
}

describe('outbox de eventos de domínio', () => {
  it('rollback da mudança de estado desfaz o evento junto', async () => {
    await expect(
      db.runAsSystem(async (tx) => {
        await tx.insert(studentProfiles).values({ userId, profile: {} as never });
        await recorder.record(tx, { userId, type: 'ConstraintChanged', payload: { kind: 'x' } });
        throw new Error('falha depois de gravar estado e evento');
      }),
    ).rejects.toThrow('falha depois');
    expect(await eventsOf(userId)).toHaveLength(0);
  });

  it('commit grava o evento; o relé publica uma vez; o consumidor recebe uma vez', async () => {
    const eventId = await db.runAsSystem(async (tx) => {
      await tx.insert(studentProfiles).values({ userId, profile: {} as never });
      return recorder.record(tx, {
        userId,
        type: 'ConstraintChanged',
        payload: { kind: 'AVAILABILITY' },
      });
    });

    const [pending] = await eventsOf(userId);
    expect(pending?.publishedAt).toBeNull();

    expect(await relay.relay()).toBeGreaterThanOrEqual(1);
    const [published] = await eventsOf(userId);
    expect(published?.publishedAt).not.toBeNull();
    expect(await relay.relay()).toBe(0);

    // O relé também enfileira o evento para o worker da própria aplicação: o despacho manual
    // concorre com ele. A reivindicação garante que o consumidor roda uma vez, quem quer que ganhe.
    const attempts = await Promise.all([
      dispatcher.dispatch(eventId),
      dispatcher.dispatch(eventId),
      dispatcher.dispatch(eventId),
    ]);
    expect(attempts.flatMap((a) => a.delivered).length).toBeLessThanOrEqual(1);

    await vi.waitFor(async () => {
      const [receipt] = await db.runAsSystem((tx) =>
        tx
          .select({ status: domainEventReceipts.status })
          .from(domainEventReceipts)
          .where(eq(domainEventReceipts.eventId, eventId)),
      );
      expect(receipt?.status).toBe('DONE');
    });

    const again = await dispatcher.dispatch(eventId);
    expect(again.delivered).toHaveLength(0);
    expect(again.skipped).toContain('teste.consumidor-de-perfil');
    expect(received.filter((event) => event.id === eventId)).toHaveLength(1);
  });

  it('falha do consumidor libera a reivindicação para o retry', async () => {
    const handlers = app.get(DomainEventHandlers);
    let calls = 0;
    handlers.register({
      name: 'teste.consumidor-instavel',
      eventTypes: ['PreferenceObserved'],
      handle: async () => {
        calls += 1;
        if (calls === 1) throw new Error('falha transitória');
      },
    });
    const eventId = await db.runAsSystem((tx) =>
      recorder.record(tx, { userId, type: 'PreferenceObserved', payload: { goalVersion: 1 } }),
    );
    await expect(dispatcher.dispatch(eventId)).rejects.toThrow('falha transitória');
    const retry = await dispatcher.dispatch(eventId);
    expect(retry.delivered).toContain('teste.consumidor-instavel');
    expect(calls).toBe(2);
  });

  it('payload fora do contrato não é gravado', async () => {
    await expect(
      db.runAsSystem((tx) =>
        recorder.record(tx, {
          userId,
          type: 'ConstraintChanged',
          payload: { aninhado: { nao: 'permitido' } } as never,
        }),
      ),
    ).rejects.toThrow();
  });
});
