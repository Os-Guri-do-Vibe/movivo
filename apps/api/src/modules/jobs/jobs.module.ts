/**
 * `JobsModule` — **esqueleto vazio registrado** (TASK-0.3.6).
 *
 * Módulo JOBS (BullMQ) do C4 nível 3 (`ARQUITETURA.md` §4). Nesta sprint é só a casca:
 * nenhuma lógica de negócio, nenhum controller, nenhum provider. Existe para que a
 * sprint de implementação (Sprint 3+) encaixe código sem reestruturar o app.
 *
 * Conteúdo previsto pelo diagrama de Rafael:
 *  - `QueueManager`
 *  - `WorkerFactory`
 *  - `DLQ Handler`
 *
 * Regras que já valem para quem implementar:
 *  - Filas no Redis já provisionado (master + replica + Sentinel, `appendfsync everysec`). A conexão vem do `RedisModule` do CORE — o BullMQ **não** abre conexão própria fora do contrato.
 *  - Todo job precisa de: política de retry com backoff, limite de tentativas, DLQ e idempotência. Job sem DLQ não entra em produção.
 *  - A drenagem no shutdown depende do `enableShutdownHooks` já ativado em `main.ts` (TASK-0.3.1).
 *  - Payload de job carrega `userId` (UUID), nunca telefone nem dado de saúde em claro.
 *
 * # Fronteira do módulo (regra §12.5 — sem imports circulares)
 * Este módulo pode depender do **CORE** (config, banco, Redis, logger) por DI, já que
 * todos os providers do CORE são globais. Não pode importar outro módulo de domínio:
 * a comunicação entre domínios é por evento (`EventBusModule`) ou por fila (`JobsModule`).
 */
import { Module } from '@nestjs/common';

@Module({})
export class JobsModule {}
