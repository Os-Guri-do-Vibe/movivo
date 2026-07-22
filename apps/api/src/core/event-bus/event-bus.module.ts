/**
 * `EventBusModule` — **stub registrado** (TASK-0.3.5).
 *
 * Casca vazia, de propósito. O barramento de eventos (CQRS — `ARQUITETURA.md` §4) é o
 * que vai permitir que módulos de domínio se comuniquem **sem se importar diretamente**,
 * eliminando a principal fonte de dependência circular num monólito modular.
 *
 * Regra que já vale para quem for implementar:
 *  - Módulo de domínio nunca importa outro módulo de domínio. A comunicação é por
 *    evento publicado aqui ou por job na fila (`JobsModule`).
 *  - Payload de evento não carrega PII: transporta `userId` (UUID) e o suficiente para
 *    o consumidor buscar o dado, com a autorização dele.
 */
import { Module } from '@nestjs/common';

@Module({})
export class EventBusModule {}
