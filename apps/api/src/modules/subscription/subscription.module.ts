/**
 * `SubscriptionModule` (US-4.1) — planos por período, máquina de estados e o gateway confinado.
 *
 * O `PAYMENT_GATEWAY` é escolhido por config: `STRIPE`/`ASAAS` só quando a chave existe, senão
 * cai no `MockGateway` (dev/CI bootam sem credencial — igual ao LLM). O SDK/HTTP do gateway fica
 * confinado a `payment/` (teste estrutural). Fila `conversion-sequence` e webhooks são US-4.2/4.3.
 *
 * Fronteira §12.5: depende só do CORE (config/banco/logger) por DI global — sem outro domínio.
 */
import { Module } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { AppConfigService } from '../../core/config';
import { JobsModule } from '../jobs/jobs.module';
import { MockGateway } from './payment/mock-gateway';
import { type PaymentGateway, PAYMENT_GATEWAY } from './payment/payment-gateway.types';
import { AsaasGateway, StripeGateway } from './payment/real-gateways';
import { ConversionSequenceWorker } from './conversion-sequence.worker';
import { PaymentWebhookController } from './payment-webhook.controller';
import { PaymentWebhookService } from './payment-webhook.service';
import { SubscriptionRepository } from './subscription.repository';
import { SubscriptionService } from './subscription.service';

@Module({
  // JobsModule: enfileira o dunning (PAST_DUE) em `whatsapp-outbound` — via fila, sem ciclo (§12.5).
  imports: [JobsModule],
  controllers: [PaymentWebhookController],
  providers: [
    {
      provide: PAYMENT_GATEWAY,
      inject: [AppConfigService, PinoLogger],
      useFactory: (config: AppConfigService, logger: PinoLogger): PaymentGateway => {
        const p = config.payment;
        if (p.provider === 'STRIPE' && p.stripeSecretKey) {
          return new StripeGateway(p.stripeSecretKey, p.stripeWebhookSecret);
        }
        if (p.provider === 'ASAAS' && p.asaasApiKey) {
          return new AsaasGateway(p.asaasApiKey, p.asaasWebhookSecret);
        }
        // Default/fallback: MOCK (sem credencial real). Boot nunca quebra por falta de chave.
        return new MockGateway(logger);
      },
    },
    SubscriptionRepository,
    SubscriptionService,
    PaymentWebhookService,
    ConversionSequenceWorker,
  ],
  exports: [SubscriptionService, PAYMENT_GATEWAY],
})
export class SubscriptionModule {}
