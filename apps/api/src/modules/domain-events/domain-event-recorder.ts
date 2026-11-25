import { Injectable } from '@nestjs/common';

import {
  domainEventPayloadSchema,
  type DomainEventPayload,
  type DomainEventType,
} from '@movivo/shared';

import { domainEvents } from '../../core/database/schema';
import type { TenantTransaction } from '../../core/database/tenant-database.service';

export interface DomainEventInput {
  /** Titular afetado; `null` para eventos sem titular (ex.: metodologia publicada). */
  userId: string | null;
  type: DomainEventType;
  payload: DomainEventPayload;
}

/**
 * Grava um evento de domínio DENTRO da transação de quem mudou o estado (outbox). Não publica
 * nada: o relé (`OutboxRelay`) entrega depois do commit. Quem grava e quer entrega imediata
 * chama `OutboxRelay.flushSoon()` depois que a transação terminou.
 */
@Injectable()
export class DomainEventRecorder {
  async record(tx: TenantTransaction, event: DomainEventInput): Promise<string> {
    const payload = domainEventPayloadSchema.parse(event.payload);
    const [row] = await tx
      .insert(domainEvents)
      .values({ userId: event.userId, type: event.type, payload })
      .returning({ id: domainEvents.id });
    if (!row) throw new Error('falha ao gravar evento de domínio');
    return row.id;
  }
}
