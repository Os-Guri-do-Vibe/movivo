/**
 * `CoreModule` — bloco CORE do C4 nível 3 (`ARQUITETURA.md` §4).
 *
 * Agrega a infraestrutura compartilhada e é o **único** módulo que o `AppModule`
 * precisa importar para que tudo de infra fique disponível. Todos os submódulos são
 * `@Global()`, então os módulos de domínio consomem seus providers por DI sem
 * importar nada — é isso que mantém a árvore acíclica.
 *
 * Fronteira: CORE nunca importa módulo de domínio. A seta aponta sempre para dentro.
 */
import { Module } from '@nestjs/common';

import { ConfigModule } from './config';
import { DatabaseModule } from './database';
import { EventBusModule } from './event-bus/event-bus.module';
import { LoggerModule } from './logger';
import { RedisModule } from './redis';
import { TelemetryModule } from './telemetry/telemetry.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    RedisModule,
    TelemetryModule,
    EventBusModule,
  ],
  exports: [
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    RedisModule,
    TelemetryModule,
    EventBusModule,
  ],
})
export class CoreModule {}
