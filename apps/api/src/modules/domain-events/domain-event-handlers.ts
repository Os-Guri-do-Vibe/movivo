import { Injectable } from '@nestjs/common';

import type { DomainEventPayload, DomainEventType } from '@movivo/shared';

/** Evento como os consumidores o recebem (relido do banco pelo dispatcher). */
export interface DomainEvent {
  id: string;
  userId: string | null;
  type: DomainEventType;
  payload: DomainEventPayload;
  occurredAt: Date;
}

/**
 * Consumidor de eventos. A entrega é AO MENOS UMA VEZ: o recibo evita reprocessar um consumidor
 * que já terminou, mas uma falha entre o efeito e o recibo faz o efeito rodar de novo — por isso
 * todo consumidor precisa ser idempotente (ex.: chaves únicas, `WHERE status = <origem>`).
 */
export interface DomainEventHandler {
  /** Nome estável (vira chave do recibo; trocar o nome reprocessa eventos antigos). */
  readonly name: string;
  readonly eventTypes: readonly DomainEventType[];
  handle(event: DomainEvent): Promise<void>;
}

/**
 * Registro dos consumidores. Cada módulo registra os seus no `onModuleInit`; o dispatcher
 * consulta o registro no momento da entrega.
 */
@Injectable()
export class DomainEventHandlers {
  private readonly byName = new Map<string, DomainEventHandler>();

  register(handler: DomainEventHandler): void {
    if (this.byName.has(handler.name)) {
      throw new Error(`consumidor de evento duplicado: ${handler.name}`);
    }
    this.byName.set(handler.name, handler);
  }

  for(type: DomainEventType): DomainEventHandler[] {
    return [...this.byName.values()].filter((handler) => handler.eventTypes.includes(type));
  }
}
