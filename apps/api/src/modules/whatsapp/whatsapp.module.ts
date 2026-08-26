/**
 * `WhatsappModule` — módulo WHATSAPP do C4 nível 3 (`ARQUITETURA.md` §4).
 *
 * Cobre os dois sentidos do canal:
 *  - **OUTBOUND** — `WhatsappOutboundWorker` sobre a fila `whatsapp-outbound` (US-1.7/2.5),
 *    com o transporte ativo escolhido por `WHATSAPP_TRANSPORT_PROVIDER`.
 *  - **INBOUND** — `WebhookController` + `WhatsappInboundService` (US-3.1/US-3.1-EVO), com
 *    uma `WhatsappInboundEdge` por provedor fazendo autenticação e normalização na borda.
 *
 * Regras que valem para qualquer mudança aqui:
 *  - Toda entrada é autenticada antes de qualquer parse, e responde 200 mesmo ao rejeitar
 *    (nunca revela ao atacante QUAL camada recusou — §12.15).
 *  - Entrega é assíncrona via BullMQ com DLQ — o handler do webhook responde rápido e enfileira.
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
import { AraraInboundEdge } from './inbound/arara-inbound.edge';
import { EvolutionInboundEdge } from './inbound/evolution-inbound.edge';
import {
  WHATSAPP_INBOUND_EDGES,
  type WhatsappInboundEdges,
} from './inbound/whatsapp-inbound-edge';
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
 * `WhatsappOutboundWorker` sobre a fila `whatsapp-outbound` (US-1.7) e o webhook de
 * ENTRADA dos dois provedores (US-3.1/US-3.1-EVO). Importa `JobsModule` (fila é a via
 * entre domínios — §12.5); o resto (config, banco, Redis, logger) vem do CORE global por DI.
 */
/**
 * URL PÚBLICA da rota de entrada da EvolutionAPI, montada a partir de `API_PUBLIC_URL` +
 * do prefixo global. Fica aqui (e não no transporte) porque só o módulo conhece as duas
 * pontas: a config da API e o caminho declarado pelo `WebhookController`. A reescrita
 * `localhost` → `host.docker.internal` acontece depois, no transporte, na hora de registrar.
 */
function evolutionWebhookUrl(config: AppConfigService): string {
  const base = config.apiPublicUrl.replace(/\/+$/, '');
  const prefix = config.globalPrefix.replace(/^\/+|\/+$/g, '');
  return `${base}/${prefix}/webhook/whatsapp/evolution`;
}

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
        new EvolutionHttpTransport(config.evolution.baseUrl, config.evolution.apiKey, logger, {
          url: evolutionWebhookUrl(config),
          token: config.evolution.webhookToken,
        }),
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
          : new AraraHttpTransport(
              config.whatsapp.araraBaseUrl,
              config.whatsapp.araraApiKey,
              logger,
            ),
    },
    WhatsappOutboundWorker,
    WhatsappInboundService,
    AraraInboundEdge,
    {
      // A borda da EvolutionAPI precisa saber QUAL instância é a nossa para rejeitar
      // entrega de uma segunda conta. O nome é descoberto em runtime (o painel cria a
      // instância), então é injetado como getter do cache do transporte — resolvido uma
      // vez aqui, no boot, e nunca por chamada HTTP no caminho de cada mensagem.
      provide: EvolutionInboundEdge,
      inject: [AppConfigService, EVOLUTION_TRANSPORT, PinoLogger],
      useFactory: (
        config: AppConfigService,
        evolution: EvolutionHttpTransport,
        logger: PinoLogger,
      ) => new EvolutionInboundEdge(config, () => evolution.lastKnownInstanceName(), logger),
    },
    {
      // Objeto (e não Map) indexado por `InboundProvider`: o `Record` completo é checado
      // pelo compilador, então acrescentar um provedor sem registrar a borda dele não
      // compila — melhor que descobrir o buraco com um `undefined` em runtime.
      provide: WHATSAPP_INBOUND_EDGES,
      inject: [AraraInboundEdge, EvolutionInboundEdge],
      useFactory: (
        arara: AraraInboundEdge,
        evolution: EvolutionInboundEdge,
      ): WhatsappInboundEdges => ({ ARARA: arara, EVOLUTION: evolution }),
    },
    // UserJobLock: provido aqui, consumido pelo AIResponseWorker (US-3.5).
    UserJobLock,
  ],
  exports: [UserJobLock, EVOLUTION_TRANSPORT],
})
export class WhatsappModule {}
