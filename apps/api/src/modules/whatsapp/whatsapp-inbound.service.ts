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
import { conversations, users } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
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

    // US-3.6 — toque num botão de feedback (👍/👎): registra o voto e NÃO enfileira resposta
    // (não é pergunta). Escopado ao titular; não altera treino.
    const feedback = parseFeedback(parsed.data.buttonId);
    if (feedback) {
      await this.registerFeedback(userId, feedback, input.correlationId);
      return;
    }

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
}
