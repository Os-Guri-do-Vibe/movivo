/**
 * `SubscriptionModule` (US-4.1) — planos por período, máquina de estados e o gateway confinado.
 *
 * O `PAYMENT_GATEWAY` é escolhido por config: `MOCK` em dev/CI ou `ASAAS` com credenciais
 * obrigatórias e URL fixa de Sandbox. O HTTP do gateway fica confinado a `payment/` (teste
 * estrutural). Fila `conversion-sequence` e webhooks são US-4.2/4.3.
 *
 * Fronteira §12.5: depende só do CORE (config/banco/logger) por DI global — sem outro domínio.
 */
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { PinoLogger } from 'nestjs-pino';

import { AppConfigService } from '../../core/config';
import { JobsModule } from '../jobs/jobs.module';
import { MockGateway } from './payment/mock-gateway';
import { type PaymentGateway, PAYMENT_GATEWAY } from './payment/payment-gateway.types';
import { AsaasGateway } from './payment/real-gateways';
import { CheckoutTokenService } from './checkout-token.service';
import { ConversionSequenceWorker } from './conversion-sequence.worker';
import { PaymentReconciliationWorker } from './payment-reconciliation.worker';
import { PaymentWebhookController } from './payment-webhook.controller';
import { PaymentWebhookService } from './payment-webhook.service';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionPeriodScheduler } from './subscription-period.scheduler';
import { SubscriptionRepository } from './subscription.repository';
import { SubscriptionService } from './subscription.service';

@Module({
  imports: [
    // JobsModule: enfileira o dunning (PAST_DUE) em `whatsapp-outbound` — via fila, sem ciclo (§12.5).
    JobsModule,
    // Rate limit das ações self-service (US-4.5). ponytail: storage em memória (MVP single-instance).
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 60 }] }),
  ],
  controllers: [PaymentWebhookController, SubscriptionController],
  providers: [
    {
      provide: PAYMENT_GATEWAY,
      inject: [AppConfigService, PinoLogger],
      useFactory: (config: AppConfigService, logger: PinoLogger): PaymentGateway => {
        const p = config.payment;
        if (p.provider === 'ASAAS' && p.asaasApiKey) {
          return new AsaasGateway(p.asaasApiKey, p.asaasWebhookSecret, p.asaasApiUrl, p.timeoutMs);
        }
        // MOCK é escolha explícita de dev/CI; em produção o schema o rejeita.
        return new MockGateway(logger);
      },
    },
    SubscriptionRepository,
    CheckoutTokenService,
    SubscriptionService,
    PaymentWebhookService,
    ConversionSequenceWorker,
    // US-8.5: grava a receita recebida a partir do evento já autenticado no webhook.
    PaymentReconciliationWorker,
    // Encerra o período pago sem renovação (ACTIVE → EXPIRED).
    SubscriptionPeriodScheduler,
  ],
  exports: [SubscriptionService, PAYMENT_GATEWAY],
})
export class SubscriptionModule {}
