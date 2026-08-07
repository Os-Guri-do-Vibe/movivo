/**
 * Ingestão do webhook de ENTRADA da AraraHQ (US-3.1 — Leonardo).
 *
 * Primeira superfície inbound do sistema (T-01 do threat model de Sato: spoofing de
 * webhook). O fluxo NUNCA processa IA de forma síncrona — valida, coalesce a rajada e
 * enfileira em `ai-response` para o `AIResponseWorker` (US-3.5). Camadas, em ordem:
 *
 *   1. HMAC sobre corpo bruto + janela ±5min de timestamp (`webhook-signature.ts`).
 *   2. Nonce de uso único (`SET NX` TTL 600s) — pega replay dentro da janela.
 *   3. Resolve o titular pelo telefone (contexto SYSTEM — inbound é não autenticado).
 *   4. Debounce (3-5s): concatena as mensagens picadas do mesmo `user_id` num batch
 *      (buffer LIST Redis) e enfileira **um** job por janela (coalesce via `SET NX`).
 *
 * Qualquer falha (assinatura inválida, replay, remetente desconhecido, payload inválido)
 * → **descarta em silêncio** (o controller responde 200 para não vazar informação ao
 * atacante) + log de segurança. Nunca loga telefone/texto em claro (só `userId` UUID e o
 * hash do `messageId`).
 */
import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import { AppConfigService } from '../../core/config';
import { HealthConsentService } from '../../core/database/health-consent.service';
import { conversations, users } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { CHECKIN_INBOUND_EVENT, type CheckinInboundEvent } from '../../core/event-bus/events';
import { DomainEventBus } from '../../core/event-bus/event-bus.service';
import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import { REDIS_KEY_BUILDER, RedisKeyBuilder } from '../../core/redis/redis-key.util';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { parseFeedback } from './feedback';
import { verifyWebhookSignature } from './webhook-signature';

/** Janela de debounce (Rafael §6): 3-5s. Concatena a rajada do usuário num só job. */
const DEBOUNCE_MS = 3_000;
/** TTL do buffer de batch: cobre a janela de debounce + o processamento de US-3.5. */
const BATCH_TTL_SECONDS = 120;
/** TTL do nonce anti-replay (Sato §6). */
const NONCE_TTL_SECONDS = 600;
const INBOUND_ROUTE_TTL_SECONDS = 60;

export const HEALTH_CONSENT_REVOCATION_PHRASE = 'REVOGAR CONSENTIMENTO DE SAUDE';

/**
 * ⚠️ PAYLOAD PLACEHOLDER (mock — conta AraraHQ não assinada). O shape real é desconhecido;
 * quando existir, ajuste este schema. `passthrough` tolera campos extras do provedor.
 */
const inboundPayloadSchema = z
  .object({
    messageId: z.string().min(1).max(200),
    from: z.string().min(8).max(20), // telefone E.164 do remetente
    text: z.string().min(1).max(4096),
    /** Toque num quick-reply (ex.: feedback 👍/👎, US-3.6). ausente numa mensagem normal. */
    buttonId: z.string().max(100).optional(),
  })
  .passthrough();

export type InboundPayload = z.infer<typeof inboundPayloadSchema>;

/**
 * Contrato do job enfileirado em `ai-response`, consumido pelo `AIResponseWorker` (US-3.5).
 * Não carrega texto/PII: o worker drena o `batchKey` sob RLS. `enqueuedAt` marca o início
 * do SLA submit→resposta (≤30s p95).
 */
export interface AiResponseJob {
  readonly userId: string;
  readonly batchKey: string;
  readonly correlationId: string;
  readonly enqueuedAt: number;
}

export interface IngestInput {
  readonly rawBody: Buffer | undefined;
  readonly signature: string | undefined;
  readonly timestamp: string | undefined;
  readonly body: unknown;
  readonly correlationId: string;
}

@Injectable()
export class WhatsappInboundService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly db: TenantDatabase,
    private readonly queues: QueueManager,
    private readonly healthConsent: HealthConsentService,
    private readonly events: DomainEventBus,
    private readonly queueEvents: DashboardQueueEventsService,
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WhatsappInboundService.name);
  }

  /**
   * Processa uma entrega do webhook. Nunca lança para o chamador: toda rejeição é
   * descartada em silêncio (200 no controller) + log. Métrica de ingestão via evento
   * estruturado (Loki → Grafana; scrape Prometheus é infra de Henrique — US-3.1.3).
   */
  async ingest(input: IngestInput): Promise<void> {
    const startedAt = Date.now();
    this.logger.info(
      { event: 'webhook_received', correlationId: input.correlationId },
      'webhook recebido',
    );

    const verdict = verifyWebhookSignature({
      secret: this.config.whatsapp.webhookSecret,
      rawBody: input.rawBody,
      signature: input.signature,
      timestamp: input.timestamp,
    });
    if (!verdict.ok) {
      // bad_signature é o P2 de Sato §6.1 (tentativa de forjar) — merece alerta no painel.
      this.reject(verdict.reason, input.correlationId);
      return;
    }

    const parsed = inboundPayloadSchema.safeParse(input.body);
    if (!parsed.success) {
      this.reject('invalid_payload', input.correlationId);
      return;
    }
    const { messageId, from, text } = parsed.data;

    // Nonce de uso único: `SET NX` — se já existe, é replay dentro da janela. O messageId
    // é hasheado para virar um segmento de chave válido (independe do formato do provedor).
    const nonceKey = this.keys.global('wa-nonce', this.hash(messageId));
    const fresh = await this.redis.set(nonceKey, '1', 'EX', NONCE_TTL_SECONDS, 'NX');
    if (fresh !== 'OK') {
      this.reject('replay', input.correlationId);
      return;
    }

    const userId = await this.resolveUser(from);
    if (!userId) {
      this.reject('unknown_sender', input.correlationId);
      return;
    }

    const consentCommandId = this.hash(messageId);

    if (this.isHealthConsentRevocation(text)) {
      await this.healthConsent.revokeForUser(userId);
      this.queueEvents.emit('consent');
      await this.queues.enqueue(
        QUEUE.whatsappOutbound,
        'health-consent-revoked',
        {
          userId,
          type: 'CONSENT_STATUS',
          dedupeId: `health-consent-revoked-${consentCommandId}`,
          text: 'Seu consentimento para uso de dados de saude foi revogado. A MOVIVO cessou novos processamentos de dados de saude neste canal. O historico ja registrado sera mantido somente pelos prazos legais e para exercicio regular de direitos.',
        },
        { jobId: `health-consent-revoked-${consentCommandId}` },
      );
      this.logger.info(
        { event: 'health_consent_revoked_whatsapp', userId, correlationId: input.correlationId },
        'consentimento de dados de saude revogado pelo titular',
      );
      return;
    }

    if (!(await this.healthConsent.hasActiveForUser(userId))) {
      await this.queues.enqueue(
        QUEUE.whatsappOutbound,
        'health-consent-inactive',
        {
          userId,
          type: 'CONSENT_STATUS',
          dedupeId: `health-consent-inactive-${consentCommandId}`,
          text: 'Seu consentimento para uso de dados de saude nao esta ativo. Esta mensagem nao foi processada. Para exercer seus direitos ou solicitar orientacao, contate o Encarregado de Dados indicado na Politica de Privacidade.',
        },
        { jobId: `health-consent-inactive-${consentCommandId}` },
      );
      this.logger.info(
        {
          event: 'health_processing_refused_no_consent',
          userId,
          correlationId: input.correlationId,
        },
        'inbound recusado por ausencia de consentimento vigente',
      );
      return;
    }

    // US-3.6 — toque num botão de feedback (👍/👎): registra o voto e NÃO enfileira resposta
    // (não é pergunta). Escopado ao titular; não altera treino.
    const feedback = parseFeedback(parsed.data.buttonId);
    if (feedback) {
      await this.registerFeedback(userId, feedback, input.correlationId);
      return;
    }

    const routeKey = this.keys.forUser(userId, 'inbound-route', this.hash(messageId));
    await this.redis.set(
      routeKey,
      JSON.stringify({ text, buttonId: parsed.data.buttonId }),
      'EX',
      INBOUND_ROUTE_TTL_SECONDS,
    );
    const handled =
      (await this.events.request<CheckinInboundEvent, boolean>(CHECKIN_INBOUND_EVENT, {
        userId,
        routeKey,
      })) ?? false;
    if (handled) {
      this.logger.info(
        { event: 'checkin_inbound_handled', userId, correlationId: input.correlationId },
        'resposta de check-in tratada sem LLM',
      );
      return;
    }
    await this.redis.del(routeKey);

    // US-3.6 — engajamento: 2ª mensagem (real) do usuário no mesmo dia (meta ≥40%, Épico 4).
    await this.trackSecondMessageSameDay(userId, input.correlationId);

    // Debounce: empilha no buffer e enfileira UM job por janela (coalesce via SET NX).
    const batchKey = this.keys.forUser(userId, 'ai-response', 'batch');
    await this.redis.rpush(batchKey, JSON.stringify({ text, ts: startedAt, messageId }));
    await this.redis.expire(batchKey, BATCH_TTL_SECONDS);

    const debounceKey = this.keys.forUser(userId, 'ai-response', 'debounce');
    const isFirstOfWindow = await this.redis.set(
      debounceKey,
      '1',
      'EX',
      Math.ceil(DEBOUNCE_MS / 1000),
      'NX',
    );
    if (isFirstOfWindow === 'OK') {
      const job: AiResponseJob = {
        userId,
        batchKey,
        correlationId: input.correlationId,
        enqueuedAt: startedAt,
      };
      await this.queues.enqueue(QUEUE.aiResponse, 'coach-response', job, { delay: DEBOUNCE_MS });
      this.logger.info(
        {
          event: 'webhook_enqueued',
          userId,
          correlationId: input.correlationId,
          latencyMs: Date.now() - startedAt,
        },
        'inbound enfileirado em ai-response',
      );
    } else {
      // Mensagem chegou com a janela já aberta: coalesce (sem novo job).
      this.logger.info(
        { event: 'webhook_debounced', userId, correlationId: input.correlationId },
        'inbound agregado à janela de debounce em curso',
      );
    }
  }

  /** Loga a rejeição sem vazar detalhe. `bad_signature` sobe a warn (sinal de forja). */
  private reject(reason: string, correlationId: string): void {
    const level = reason === 'bad_signature' ? 'warn' : 'info';
    this.logger[level](
      { event: 'webhook_rejected', reason, correlationId },
      'inbound descartado (200, sem processar)',
    );
  }

  /**
   * Registra o voto de feedback (US-3.6): evento `ai_response_feedback` + persistência mínima
   * como linha SYSTEM em `conversations` (reusa a tabela; não cria estado de treino). Sob RLS.
   * ponytail: tabela dedicada de feedback se a análise de CSAT exigir agregação própria.
   */
  private async registerFeedback(
    userId: string,
    vote: 'UP' | 'DOWN',
    correlationId: string,
  ): Promise<void> {
    await this.db.runAsUser(userId, 'USER', async (tx) => {
      await tx.insert(conversations).values({
        userId,
        direction: 'INBOUND',
        messageType: 'SYSTEM',
        content: `feedback:${vote}`,
      });
    });
    this.logger.info(
      { event: 'ai_response_feedback', userId, vote, correlationId },
      'feedback (thumbs) registrado',
    );
  }

  /** Conta as mensagens reais do dia; ao chegar na 2ª, emite o evento de engajamento. */
  private async trackSecondMessageSameDay(userId: string, correlationId: string): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    const key = this.keys.forUser(userId, 'msg-count', day);
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 2 * 24 * 3600);
    if (count === 2) {
      this.logger.info(
        { event: 'whatsapp_user_second_message_same_day', userId, correlationId },
        'engajamento: 2ª mensagem do usuário no mesmo dia',
      );
    }
  }

  /** Telefone → `userId` num contexto SYSTEM (inbound não autenticado). `null` = desconhecido. */
  private async resolveUser(phone: string): Promise<string | null> {
    const [row] = await this.db.runAsSystem((tx) =>
      tx.select({ id: users.id }).from(users).where(eq(users.phoneNumber, phone)).limit(1),
    );
    return row?.id ?? null;
  }

  /** Hash do messageId → segmento de chave Redis válido, independente do formato AraraHQ. */
  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private isHealthConsentRevocation(text: string): boolean {
    const normalized = text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/[.!]+$/g, '')
      .replace(/\s+/g, ' ')
      .toUpperCase();
    return normalized === HEALTH_CONSENT_REVOCATION_PHRASE;
  }
}
