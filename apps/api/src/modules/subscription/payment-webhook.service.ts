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
import {
  type GatewayEvent,
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from './payment/payment-gateway.types';
import type { PaymentReconciliationJob } from './payment-reconciliation.worker';
import { InvalidTransitionError, SUBSCRIPTION_TERMS_VERSION } from './subscription-model';
import { dunningMessage } from './subscription-messages';
import { SubscriptionService } from './subscription.service';

/** TTL do dedup de evento — cobre a janela de reentrega do provedor com folga. */
const EVENT_DEDUP_TTL_SECONDS = 7 * 24 * 3600;

/** `REJECTED` só quando a assinatura não foi provada — ver `ingest`. */
export type WebhookVerdict = 'ACCEPTED' | 'REJECTED';

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

  /**
   * Nunca lança ao chamador. Devolve o veredito para o controller escolher o status:
   * `REJECTED` (assinatura ausente/inválida) vira **401**, tudo o mais vira 200.
   *
   * O 401 é uniforme para toda rejeição — não distingue corpo ausente de assinatura errada
   * de janela expirada, então continua não vazando QUAL camada falhou (Sato T-15). Devolver
   * 200 a um evento não autenticado seria pior de dois jeitos: diz ao gateway legítimo que
   * um evento corrompido foi aceito (ele para de reentregar), e dá ao atacante a mesma
   * resposta de um evento válido, apagando o sinal de que a forja foi barrada.
   */
  async ingest(input: PaymentWebhookInput): Promise<WebhookVerdict> {
    if (!input.rawBody) {
      return this.reject('missing_body', input.correlationId);
    }

    // 1. Assinatura sobre o corpo bruto (Stripe constructEvent / Asaas HMAC) → GatewayEvent.
    //    NADA acontece antes desta linha: nem persistência, nem fila, nem efeito.
    const event = this.gateway.parseWebhookEvent(input.rawBody, input.signature, input.timestamp);
    if (!event) {
      return this.reject('bad_signature', input.correlationId); // T-15: tentativa de forja
    }

    // 2. Liquidação (US-8.5): enfileira a conciliação ANTES do dedup em Redis, de propósito.
    //    A idempotência de `payments` é a UNIQUE `(gateway, gateway_event_id)` no banco —
    //    nunca uma checagem em código, que tem janela de corrida. Se o dedup do Redis
    //    barrasse aqui, uma queda entre o `SET NX` e o enqueue perderia a receita para
    //    sempre; deixando o banco decidir, reentregar 5× continua produzindo 1 linha.
    //    `jobId` determinístico só evita fila entupida de reentrega — não é a garantia.
    await this.enqueueReconciliation(event, input);

    // 3. Idempotência por event_id (SET NX) — reentrega do mesmo evento é descartada.
    const dedupKey = this.keys.global('pay-evt', this.hash(event.eventId));
    const fresh = await this.redis.set(dedupKey, '1', 'EX', EVENT_DEDUP_TTL_SECONDS, 'NX');
    if (fresh !== 'OK') {
      this.logger.info(
        { event: 'webhook_replay', type: event.type, correlationId: input.correlationId },
        'evento de pagamento repetido — ignorado',
      );
      return 'ACCEPTED';
    }

    // 4. Transição de estado (sob RLS). `uniqueIndex(externalSubscriptionId)` é a 2ª barreira.
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
        return 'ACCEPTED';
      }
      throw error;
    }
    return 'ACCEPTED';
  }

  /**
   * Enfileira a conciliação da liquidação (US-8.5). O corpo bruto — já autenticado pela
   * assinatura — segue como `rawPayload` para virar a coluna jsonb de `payments`.
   *
   * **Nada disto vai para o log**: o payload do gateway carrega dado de cobrança e fica
   * exclusivamente na tabela, sob RLS. O que se registra aqui é id de evento e tipo.
   */
  private async enqueueReconciliation(
    event: GatewayEvent,
    input: PaymentWebhookInput,
  ): Promise<void> {
    const job: PaymentReconciliationJob = {
      gateway: this.gateway.name,
      event,
      rawPayload: parseJson(input.rawBody),
      correlationId: input.correlationId,
    };
    await this.queues.enqueue(QUEUE.paymentReconciliation, 'reconcile', job, {
      // `_` e não `:` — o BullMQ recusa `:` em custom id (colide com o keyspace do Redis).
      jobId: `${this.gateway.name}_${this.hash(event.eventId)}`,
    });
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

  /**
   * Registra a tentativa e devolve o veredito. **Registrar não é opcional**: tentar forjar
   * uma liquidação é sinal de segurança, não ruído de log — descartar em silêncio apagaria
   * o único rastro. O que se registra é motivo + correlation id; o corpo rejeitado **não**
   * é logado (é justamente o conteúdo que um atacante controla).
   */
  private reject(reason: string, correlationId: string): WebhookVerdict {
    // `bad_signature`/`missing_body` sobem warn — pico é sinal de fraude (P2, Sato §6.1).
    this.logger.warn(
      { event: 'webhook_rejected', reason, correlationId },
      'webhook de pagamento rejeitado (401, nada persistido)',
    );
    return 'REJECTED';
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}

/**
 * Corpo bruto → jsonb. A assinatura já provou a origem, então o parse aqui é sobre forma,
 * não sobre confiança. Corpo não-JSON não descarta a liquidação: guarda-se um marcador e a
 * linha entra assim mesmo — evento financeiro autenticado nunca é jogado fora em silêncio.
 */
function parseJson(rawBody: Buffer | undefined): unknown {
  if (!rawBody) return {};
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { unparsed: true };
  }
}
