/**
 * `ProtocolRenewalModule` — superfície pública do formulário de troca de protocolo por
 * fim de mesociclo.
 *
 * Mesma fronteira de módulo de `AnamnesisModule` (regra §12.5): depende só do CORE por
 * DI e comunica com o domínio de protocolo exclusivamente por fila
 * (`QUEUE.protocolRenewalGeneration`, consumida pelo `ProtocolRenewalGenerationWorker`
 * dentro de `ProtocolModule`) — nunca importa `ProtocolModule` diretamente.
 */
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

import { JobsModule } from '../jobs/jobs.module';
import { ProtocolRenewalController } from './protocol-renewal.controller';
import { ProtocolRenewalService } from './protocol-renewal.service';

@Module({
  imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 60 }] }), JobsModule],
  controllers: [ProtocolRenewalController],
  providers: [ProtocolRenewalService],
  exports: [ProtocolRenewalService],
})
export class ProtocolRenewalModule {}
