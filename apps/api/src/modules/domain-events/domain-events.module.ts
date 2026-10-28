import { Module } from '@nestjs/common';

import { JobsModule } from '../jobs/jobs.module';
import { DomainEventDispatcher } from './domain-event-dispatcher';
import { DomainEventHandlers } from './domain-event-handlers';
import { DomainEventRecorder } from './domain-event-recorder';
import { OutboxRelay } from './outbox-relay';

/**
 * Outbox de eventos de domínio: gravação transacional, relé para a fila e despacho idempotente
 * aos consumidores. Quem grava ou consome eventos importa este módulo — não é `@Global` porque o
 * Nest inicializa módulos globais primeiro, e o relé precisa das filas já registradas pelo
 * `JobsModule` no `onModuleInit`.
 */
@Module({
  imports: [JobsModule],
  providers: [DomainEventRecorder, DomainEventHandlers, OutboxRelay, DomainEventDispatcher],
  exports: [DomainEventRecorder, DomainEventHandlers, OutboxRelay],
})
export class DomainEventsModule {}
