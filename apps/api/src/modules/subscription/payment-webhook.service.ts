/**
 * Ingestão do webhook de pagamento (US-4.2.2) — o vetor de fraude nº 1 (Sato T-15). Reusa o
 * padrão da US-3.1: verifica assinatura sobre o **corpo bruto** (via `PaymentGateway`), resiste a
 * replay (dedup por `event_id` `SET NX` + `uniqueIndex(externalSubscriptionId)` da ativação) e
 * NUNCA vaza QUAL camada falhou — assinatura inválida/replay são descartados (o controller
 * responde 200). A transição roda sob RLS via `SubscriptionService.applyGatewayEvent`.
 *
 * PAST_DUE (decisão do fundador): dunning conversacional — a MOVI envia o link de pagamento no
 * WhatsApp (fila `whatsapp-outbound`); o acesso segue na janela de graça (gate em US-4.2.3).
 */
import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import { REDIS_KEY_BUILDER, RedisKeyBuilder } from '../../core/redis/redis-key.util';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { PAYMENT_GATEWAY, type PaymentGateway } from './payment/payment-gateway.types';
import { InvalidTransitionError, SUBSCRIPTION_TERMS_VERSION } from './subscription-model';
import { dunningMessage } from './subscription-messages';
import { SubscriptionService } from './subscription.service';

/** TTL do dedup de evento — cobre a janela de reentrega do provedor com folga. */
const EVENT_DEDUP_TTL_SECONDS = 7 * 24 * 3600;

export interface PaymentWebhookInput {
  readonly rawBody: Buffer | undefined;
  readonly signature: string | undefined;
  readonly timestamp: string | undefined;
  readonly correlationId: string;
}

@Injectable()
export class PaymentWebhookService {
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly subscriptions: SubscriptionService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly queues: QueueManager,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PaymentWebhookService.name);
  }

  /** Nunca lança ao chamador: toda rejeição vira 200 + log (não vaza informação ao atacante). */
  async ingest(input: PaymentWebhookInput): Promise<void> {
    if (!input.rawBody) {
      this.reject('missing_body', input.correlationId);
      return;
    }

    // 1. Assinatura sobre o corpo bruto (Stripe constructEvent / Asaas HMAC) → GatewayEvent.
    const event = this.gateway.parseWebhookEvent(input.rawBody, input.signature, input.timestamp);
    if (!event) {
      this.reject('bad_signature', input.correlationId); // T-15: sobe warn (tentativa de forja)
      return;
    }

    // 2. Idempotência por event_id (SET NX) — reentrega do mesmo evento é descartada.
    const dedupKey = this.keys.global('pay-evt', this.hash(event.eventId));
    const fresh = await this.redis.set(dedupKey, '1', 'EX', EVENT_DEDUP_TTL_SECONDS, 'NX');
    if (fresh !== 'OK') {
      this.logger.info(
        { event: 'webhook_replay', type: event.type, correlationId: input.correlationId },
        'evento de pagamento repetido — ignorado',
      );
      return;
    }

    // 3. Transição de estado (sob RLS). `uniqueIndex(externalSubscriptionId)` é a 2ª barreira.
    try {
      const result = await this.subscriptions.applyGatewayEvent(event);
      await this.afterTransition(event.type, event.userId, result.status, input.correlationId);
    } catch (error) {
      if (error instanceof InvalidTransitionError) {
        this.logger.warn(
          {
            event: 'webhook_invalid_transition',
            err: error.message,
            correlationId: input.correlationId,
          },
          'evento de pagamento em transição inválida — ignorado',
        );
        return;
      }
      throw error;
    }
  }

  /** Efeitos por evento: analytics + dunning conversacional no PAST_DUE. */
  private async afterTransition(
    type: string,
    userId: string,
    status: string,
    correlationId: string,
  ): Promise<void> {
    if (status === 'IDEMPOTENT' || status === 'NO_SUBSCRIPTION') return;

    if (type === 'CHECKOUT_CONFIRMED') {
      this.logger.info(
        { event: 'subscription_created', userId, correlationId },
        'assinatura ativada',
      );
    } else if (type === 'PAYMENT_FAILED') {
      this.logger.info({ event: 'payment_failed', userId, correlationId }, 'pagamento falhou');
      await this.enqueueDunning(userId);
    } else if (status === 'CANCELED') {
      this.logger.info(
        { event: 'subscription_cancelled', userId, correlationId },
        'assinatura cancelada',
      );
    }
  }

  /** Dunning: cria um link de checkout e o envia no WhatsApp (fila outbound). */
  private async enqueueDunning(userId: string): Promise<void> {
    const sub = await this.subscriptions.getForUser(userId);
    if (!sub) return;
    const session = await this.subscriptions.createCheckout(
      userId,
      sub.plan,
      'CARD',
      sub.termsVersion ?? SUBSCRIPTION_TERMS_VERSION,
    );
    const job: WhatsappOutboundJob = {
      userId,
      type: 'COACH_MESSAGE',
      text: dunningMessage(session.checkoutUrl),
      dedupeId: `dunning_${sub.id}_${Date.now()}`,
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'dunning', job);
  }

  private reject(reason: string, correlationId: string): void {
    // `bad_signature`/`missing_body` sobem warn — pico é sinal de fraude (P2, Sato §6.1).
    this.logger.warn(
      { event: 'webhook_rejected', reason, correlationId },
      'webhook de pagamento descartado (200, sem processar)',
    );
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
