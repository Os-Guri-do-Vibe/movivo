/**
 * `WhatsappModule` — **esqueleto vazio registrado** (TASK-0.3.6).
 *
 * Módulo WHATSAPP do C4 nível 3 (`ARQUITETURA.md` §4). Nesta sprint é só a casca:
 * nenhuma lógica de negócio, nenhum controller, nenhum provider. Existe para que a
 * sprint de implementação (Sprint 3) encaixe código sem reestruturar o app.
 *
 * Conteúdo previsto pelo diagrama de Rafael:
 *  - `WebhookController`
 *  - `MessageService`
 *  - `TemplateService`
 *  - `RateLimiter`
 *
 * Regras que já valem para quem implementar:
 *  - Webhook da AraraHQ: verificação de assinatura HMAC obrigatória + janela anti-replay de ±5 min (§12.15). Assinatura inválida ⇒ 401, sem processar.
 *  - Entrega é assíncrona via BullMQ com DLQ — o handler do webhook responde 200 rápido e enfileira.
 *  - Corpo de mensagem contém PII e conteúdo de saúde: nunca logar payload em claro (`redactPii`).
 *
 * # Fronteira do módulo (regra §12.5 — sem imports circulares)
 * Este módulo pode depender do **CORE** (config, banco, Redis, logger) por DI, já que
 * todos os providers do CORE são globais. Não pode importar outro módulo de domínio:
 * a comunicação entre domínios é por evento (`EventBusModule`) ou por fila (`JobsModule`).
 */
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { PinoLogger } from 'nestjs-pino';

import { AppConfigService } from '../../core/config';
import { JobsModule } from '../jobs/jobs.module';
import { AraraHttpTransport } from './arara-transport';
import { EVOLUTION_TRANSPORT, EvolutionHttpTransport } from './evolution-transport';
import { UserJobLock } from './user-job-lock';
import { WebhookController } from './webhook.controller';
import { WhatsappInboundService } from './whatsapp-inbound.service';
import { WhatsappOutboundWorker } from './whatsapp-outbound.worker';
import { type WhatsappTransport, WHATSAPP_TRANSPORT } from './whatsapp-transport';

/**
 * `WhatsappModule` (US-2.5) — outbound WhatsApp via AraraHQ (produção) ou EvolutionAPI
 * (teste do número separado, QR Code/Baileys — `WHATSAPP_TRANSPORT_PROVIDER=EVOLUTION`).
 *
 * `EVOLUTION_TRANSPORT` é provido **sempre**, independente do provedor ativo: o painel
 * admin "Sistema → Integração" precisa dele pra criar/conectar a instância mesmo quando
 * o transporte real ainda é a AraraHQ. `WHATSAPP_TRANSPORT` reaproveita essa MESMA
 * instância (não cria um segundo cliente HTTP — quebraria o confinamento) quando o
 * provedor ativo é `EVOLUTION`; do contrário constrói o `AraraHttpTransport` de sempre.
 * Default de `WHATSAPP_TRANSPORT_PROVIDER` é `ARARA` — trocar é decisão explícita de
 * `.env` local, nunca automática.
 *
 * `WhatsappOutboundWorker` sobre a fila `whatsapp-outbound` (US-1.7). Sem webhook de
 * ENTRADA (Sprint 3). Importa `JobsModule` (fila é a via entre domínios — §12.5); o
 * resto (config, banco, Redis, logger) vem do CORE global por DI.
 */
@Module({
  imports: [
    JobsModule,
    // Rate limit do path do webhook (US-3.1.3). ponytail: storage em memória (MVP
    // single-instance); trocar por storage Redis ao escalar horizontalmente — igual anamnese.
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 120 }] }),
  ],
  controllers: [WebhookController],
  providers: [
    {
      provide: EVOLUTION_TRANSPORT,
      inject: [AppConfigService, PinoLogger],
      useFactory: (config: AppConfigService, logger: PinoLogger) =>
        new EvolutionHttpTransport(config.evolution.baseUrl, config.evolution.apiKey, logger),
    },
    {
      provide: WHATSAPP_TRANSPORT,
      inject: [AppConfigService, PinoLogger, EVOLUTION_TRANSPORT],
      useFactory: (
        config: AppConfigService,
        logger: PinoLogger,
        evolution: EvolutionHttpTransport,
      ): WhatsappTransport =>
        config.whatsapp.transportProvider === 'EVOLUTION'
          ? evolution
          : new AraraHttpTransport(config.whatsapp.araraBaseUrl, config.whatsapp.araraApiKey, logger),
    },
    WhatsappOutboundWorker,
    WhatsappInboundService,
    // UserJobLock: provido aqui, consumido pelo AIResponseWorker (US-3.5).
    UserJobLock,
  ],
  exports: [UserJobLock, EVOLUTION_TRANSPORT],
})
export class WhatsappModule {}
