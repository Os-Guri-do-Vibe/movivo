/**
 * Ingestão do webhook de ENTRADA do WhatsApp (US-3.1 / US-3.1-EVO — Leonardo).
 *
 * Primeira superfície inbound do sistema (T-01 do threat model de Sato: spoofing de
 * webhook). O fluxo NUNCA processa IA de forma síncrona — valida, coalesce a rajada e
 * enfileira em `ai-response` para o `AIResponseWorker` (US-3.5). Camadas, em ordem:
 *
 *   1. **Borda do provedor** (`WhatsappInboundEdge`): autentica (HMAC da AraraHQ ou token
 *      compartilhado da EvolutionAPI) e normaliza o envelope. É a ÚNICA parte específica
 *      de provedor de todo o pipeline.
 *   2. Nonce de uso único (`SET NX`), com namespace por provedor — o `messageId` da
 *      AraraHQ e o `key.id` do Baileys vêm de espaços distintos e não podem colidir.
 *   3. Resolve o titular pelo telefone (contexto SYSTEM — inbound é não autenticado).
 *      Casamento **exato** (`eq(users.phoneNumber, phone)`, UNIQUE), nunca difuso.
 *   4. Orçamento por titular (30 msg / 5 min): protege o custo de inferência do LLM.
 *   5. Debounce (3-5s): concatena as mensagens picadas do mesmo `user_id` num batch
 *      (buffer LIST Redis) e enfileira **um** job por janela (coalesce via `SET NX`).
 *
 * Qualquer falha (assinatura/token inválido, replay, remetente desconhecido, payload
 * inválido) → **descarta em silêncio** (o controller responde 200 para não vazar
 * informação ao atacante) + log de segurança. Nunca loga telefone/texto em claro (só
 * `userId` UUID e o hash do `messageId`).
 *
 * A partir de `resolveUser()` nada aqui sabe qual provedor entregou a mensagem — é essa
 * indivisibilidade que garante que os dois canais tenham o MESMO gate de consentimento,
 * o mesmo isolamento por titular e a mesma auditoria.
 */
import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import {
  AUDIO_TRANSCRIPTION_PORT,
  isAudioTranscriptionConfigured,
  type AudioTranscriptionPort,
} from '../../core/audio/audio-transcription.port';
import { AppConfigService } from '../../core/config';
import { HealthConsentService } from '../../core/database/health-consent.service';
import { conversations, users } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { WORKOUT_INBOUND_EVENT, type CheckinInboundEvent } from '../../core/event-bus/events';
import { DomainEventBus } from '../../core/event-bus/event-bus.service';
import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import { REDIS_KEY_BUILDER, RedisKeyBuilder } from '../../core/redis/redis-key.util';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { EVOLUTION_TRANSPORT, type EvolutionTransport } from './evolution-transport';
import { parseFeedback } from './feedback';
import { type NormalizedInbound, type RawDelivery } from './inbound/inbound-message';
import {
  type InboundProvider,
  WHATSAPP_INBOUND_EDGES,
  type WhatsappInboundEdges,
} from './inbound/whatsapp-inbound-edge';

/**
 * Janela de debounce. Concatena a rajada do usuário num só job — ex.: "oi" / "tudo bem?" /
 * "bom dia" mandados em bolhas separadas viram um único turno do AI Coach. Rafael §6
 * recomendava 3-5s; aumentado para 7s por decisão do fundador (achado 2026-09-12) para dar
 * mais folga a rajadas mais longas antes da IA responder.
 */
const DEBOUNCE_MS = 7_000;
/** TTL do buffer de batch: cobre a janela de debounce + o processamento de US-3.5. */
const BATCH_TTL_SECONDS = 120;
/**
 * TTL do nonce anti-replay (Sato §6), por provedor.
 *
 * A AraraHQ mantém os 600s de sempre (a janela de timestamp assinado já é ±5min, então o
 * nonce só precisa cobrir essa janela). O Baileys/EvolutionAPI não tem janela assinada e
 * **reemite mensagens depois de uma reconexão lenta** — com 600s, um reenvio 20 minutos
 * depois passaria pelo nonce e a MOVIVO responderia duas vezes à mesma mensagem. 24h cobre
 * qualquer reconexão plausível.
 */
const NONCE_TTL_SECONDS: Readonly<Record<InboundProvider, number>> = {
  ARARA: 600,
  EVOLUTION: 86_400,
};
const INBOUND_ROUTE_TTL_SECONDS = 60;

/**
 * Orçamento de mensagens por titular (Sato: "o controle que realmente importa"). Vale para
 * os DOIS provedores e é aplicado depois de `resolveUser()`, porque o recurso protegido é
 * o custo de inferência de LLM do usuário — não a borda HTTP (essa tem throttle de rota).
 */
const USER_RATE_LIMIT = 30;
const USER_RATE_WINDOW_SECONDS = 300;

export const HEALTH_CONSENT_REVOCATION_PHRASE = 'REVOGAR CONSENTIMENTO DE SAUDE';

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

/**
 * Uma entrega crua + de QUAL provedor ela veio. O `provider` não é lido do corpo (seria
 * controlável por quem entrega): vem da ROTA que recebeu a requisição.
 */
export interface IngestInput extends RawDelivery {
  readonly provider: InboundProvider;
}

@Injectable()
export class WhatsappInboundService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    @Inject(WHATSAPP_INBOUND_EDGES) private readonly edges: WhatsappInboundEdges,
    @Inject(AUDIO_TRANSCRIPTION_PORT) private readonly audioTranscription: AudioTranscriptionPort,
    @Inject(EVOLUTION_TRANSPORT) private readonly evolutionTransport: EvolutionTransport,
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
    this.logger.info(
      { event: 'webhook_received', provider: input.provider, correlationId: input.correlationId },
      'webhook recebido',
    );

    const edge = this.edges[input.provider];
    if (!edge) {
      this.reject('unknown_provider', input.correlationId, input.provider);
      return;
    }

    const verdict = edge.verify(input);
    if (!verdict.ok) {
      // bad_signature/bad_token são o P2 de Sato §6.1 (tentativa de forjar) — alertáveis.
      this.reject(verdict.reason, input.correlationId, input.provider);
      return;
    }

    const messages = edge.normalize(input.body);
    if (messages === null) {
      // Corpo autenticado mas fora do contrato do provedor: é rejeição, não descarte.
      this.reject('invalid_payload', input.correlationId, input.provider);
      return;
    }
    if (messages.length === 0) {
      // Descarte LEGÍTIMO (eco `fromMe`, grupo, tipo não suportado, backlog antigo…). A
      // razão específica já foi logada pela borda; aqui não é evento de segurança.
      this.logger.info(
        {
          event: 'webhook_no_message',
          provider: input.provider,
          correlationId: input.correlationId,
        },
        'entrega sem mensagem processável',
      );
      return;
    }

    for (const message of messages) {
      await this.process(message, input.provider, input.correlationId);
    }
  }

  /**
   * Pipeline agnóstico de provedor — daqui para baixo nada sabe se a mensagem veio da
   * AraraHQ ou da EvolutionAPI (o `provider` só entra em namespace de chave e em log).
   */
  private async process(
    message: NormalizedInbound,
    provider: InboundProvider,
    correlationId: string,
  ): Promise<void> {
    const startedAt = Date.now();
    const { messageId, from } = message;

    // Nonce de uso único: `SET NX` — se já existe, é replay dentro da janela. O messageId
    // é hasheado para virar um segmento de chave válido (independe do formato do provedor)
    // e o provedor entra no namespace: `messageId` da AraraHQ e `key.id` do Baileys vêm de
    // espaços de identificador distintos e não podem se anular por colisão acidental.
    const nonceKey = this.keys.global('wa-nonce', provider.toLowerCase(), this.hash(messageId));
    const fresh = await this.redis.set(nonceKey, '1', 'EX', NONCE_TTL_SECONDS[provider], 'NX');
    if (fresh !== 'OK') {
      this.reject('replay', correlationId, provider);
      return;
    }

    const userId = await this.resolveUser(from);
    if (!userId) {
      this.reject('unknown_sender', correlationId, provider);
      return;
    }

    // Frase de revogação só é checável em mensagem de TEXTO — uma mensagem de voz ainda
    // não foi transcrita aqui (transcrição custa dinheiro de verdade e só roda DEPOIS do
    // orçamento abaixo passar). Áudio nunca ganha a isenção de orçamento da revogação por
    // causa disso — trade-off aceito: o direito de revogar (LGPD Art. 18) continua 100%
    // exercível por texto, e a frase dita por voz ainda é honrada mais abaixo, depois de
    // transcrita, só não fura o orçamento pra chegar lá.
    const isTextRevocation =
      message.text !== undefined && this.isHealthConsentRevocation(message.text);
    const withinBudget = await this.consumeUserBudget(userId);
    // O orçamento nunca pode bloquear o exercício de um direito do titular (LGPD Art. 18):
    // a frase de revogação de consentimento passa mesmo com o orçamento estourado — ela
    // não gera inferência de LLM, que é justamente o recurso protegido aqui.
    if (!withinBudget && !isTextRevocation) {
      // Não é ataque externo (o remetente é um titular autenticado pelo próprio canal):
      // log próprio, sem `reject()`, e nenhum job de IA enfileirado.
      this.logger.warn(
        { event: 'inbound_user_rate_limited', provider, userId, correlationId },
        'orçamento de mensagens do titular estourado — inbound descartado sem chamar IA',
      );
      return;
    }

    // Mensagem de voz (US audio, 2026-09-14): resolve `text` transcrevendo AGORA — só
    // depois do nonce/titular/orçamento acima, porque transcrição é custo real de
    // terceiro (nunca pago por uma entrega ainda não autenticada ou fora de orçamento).
    // Qualquer falha já avisou o aluno e descartou dentro de `resolveAudioText`.
    const text =
      message.text ?? (await this.resolveAudioText(message, provider, userId, correlationId));
    if (text === null) return;

    const isRevocation =
      message.text !== undefined ? isTextRevocation : this.isHealthConsentRevocation(text);

    const consentCommandId = this.hash(messageId);

    if (isRevocation) {
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
        { event: 'health_consent_revoked_whatsapp', userId, correlationId },
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
          correlationId,
        },
        'inbound recusado por ausencia de consentimento vigente',
      );
      return;
    }

    // US-3.6 — toque num botão de feedback (👍/👎): registra o voto e NÃO enfileira resposta
    // (não é pergunta). Escopado ao titular; não altera treino.
    const feedback = parseFeedback(message.buttonId);
    if (feedback) {
      await this.registerFeedback(userId, feedback, correlationId);
      return;
    }

    const routeKey = this.keys.forUser(userId, 'inbound-route', this.hash(messageId));
    await this.redis.set(
      routeKey,
      JSON.stringify({ text, buttonId: message.buttonId }),
      'EX',
      INBOUND_ROUTE_TTL_SECONDS,
    );
    // Cadeia determinística (US-8.1): só o treino intercepta botão determinístico hoje — o
    // check-in semanal virou formulário web (achado 2026-09-13), sem botão pra rotear aqui.
    const handled =
      (await this.events.request<CheckinInboundEvent, boolean>(WORKOUT_INBOUND_EVENT, {
        userId,
        routeKey,
      })) ?? false;
    if (handled) {
      this.logger.info(
        { event: 'workout_inbound_handled', userId, correlationId },
        'resposta determinística tratada sem LLM',
      );
      return;
    }
    await this.redis.del(routeKey);

    // US-3.6 — engajamento: 2ª mensagem (real) do usuário no mesmo dia (meta ≥40%, Épico 4).
    await this.trackSecondMessageSameDay(userId, correlationId);

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
        correlationId,
        enqueuedAt: startedAt,
      };
      await this.queues.enqueue(QUEUE.aiResponse, 'coach-response', job, { delay: DEBOUNCE_MS });
      this.logger.info(
        {
          event: 'webhook_enqueued',
          userId,
          correlationId,
          latencyMs: Date.now() - startedAt,
        },
        'inbound enfileirado em ai-response',
      );
    } else {
      // Mensagem chegou com a janela já aberta: coalesce (sem novo job).
      this.logger.info(
        { event: 'webhook_debounced', userId, correlationId },
        'inbound agregado à janela de debounce em curso',
      );
    }
  }

  /**
   * Resolve `text` de uma mensagem de voz (US audio — ADR-009, revisão 2026-09-14):
   * teto de duração → download do áudio → transcrição via `AudioTranscriptionCascade`
   * (OpenAI perna primária de produção, Groq fallback automático em produção E local),
   * atrás de um gate de HEALTH PRÓPRIO por fornecedor, sempre separado de
   * `LLM_OPENAI_HEALTH_DATA_APPROVED`.
   *
   * `null` = descartado. Toda saída `null` já avisou o aluno por `notifyAudioFallback`
   * antes de retornar — ninguém fica esperando uma resposta que nunca vai chegar.
   *
   * Escopo inicial (decisão do fundador): só a EvolutionAPI emite `audio` hoje — a AraraHQ
   * segue descartando áudio na borda (`arara-inbound.edge.ts`) até o webhook de voz de
   * produção ser confirmado. `provider !== 'EVOLUTION'` abaixo é defensivo, não deveria
   * disparar na prática.
   */
  private async resolveAudioText(
    message: NormalizedInbound,
    provider: InboundProvider,
    userId: string,
    correlationId: string,
  ): Promise<string | null> {
    const audio = message.audio;
    /* v8 ignore next 3 -- defensivo: `normalizedInboundSchema` garante text XOR audio. */
    if (!audio) return null;

    const maxDuration = this.config.audioTranscription.maxDurationSeconds;
    if (audio.durationSeconds !== undefined && audio.durationSeconds > maxDuration) {
      await this.notifyAudioFallback(
        userId,
        message.messageId,
        'Esse áudio é mais longo do que eu consigo ouvir por aqui — pode escrever ou mandar um áudio mais curto?',
      );
      this.logger.info(
        {
          event: 'audio_too_long',
          provider,
          userId,
          correlationId,
          durationSeconds: audio.durationSeconds,
        },
        'áudio descartado: acima do teto de duração',
      );
      return null;
    }

    if (!isAudioTranscriptionConfigured(this.config.audioTranscription)) {
      await this.notifyAudioFallback(
        userId,
        message.messageId,
        'Ainda não consigo ouvir áudio por aqui — pode escrever, por favor?',
      );
      this.logger.info(
        { event: 'audio_transcription_not_configured', provider, userId, correlationId },
        'áudio descartado: transcrição sem credencial ou sem aprovação de dado de saúde',
      );
      return null;
    }

    if (provider !== 'EVOLUTION') {
      await this.notifyAudioFallback(
        userId,
        message.messageId,
        'Ainda não consigo ouvir áudio por aqui — pode escrever, por favor?',
      );
      this.logger.warn(
        { event: 'audio_unsupported_provider', provider, userId, correlationId },
        'áudio recebido de provedor sem download de mídia implementado',
      );
      return null;
    }

    const instanceName = this.evolutionTransport.lastKnownInstanceName();
    if (!instanceName) {
      await this.notifyAudioFallback(
        userId,
        message.messageId,
        'Não consegui ouvir esse áudio agora — pode escrever, por favor?',
      );
      this.logger.warn(
        { event: 'audio_download_failed', reason: 'no_instance', provider, userId, correlationId },
        'download de áudio falhou: instância da EvolutionAPI desconhecida',
      );
      return null;
    }

    try {
      const { base64, mimetype } = await this.evolutionTransport.downloadAudio(
        instanceName,
        audio.mediaKey,
      );
      const transcript = await this.audioTranscription.transcribe({
        audio: Buffer.from(base64, 'base64'),
        mimeType: mimetype,
      });
      this.logger.info(
        {
          event: 'audio_transcribed',
          provider,
          userId,
          correlationId,
          durationSeconds: audio.durationSeconds,
        },
        'áudio transcrito',
      );
      return transcript;
    } catch (error) {
      await this.notifyAudioFallback(
        userId,
        message.messageId,
        'Não consegui entender esse áudio — pode tentar de novo ou escrever?',
      );
      this.logger.warn(
        {
          event: 'audio_transcription_failed',
          provider,
          userId,
          correlationId,
          err: error instanceof Error ? error.message : 'erro desconhecido',
        },
        'download ou transcrição de áudio falhou',
      );
      return null;
    }
  }

  /**
   * Avisa o aluno quando um áudio não pôde virar resposta — reusa `COACH_MESSAGE` (texto
   * livre, sem cabeçalho especial, ver `whatsapp-outbound.worker.ts::buildText`).
   * `dedupeId` a partir do `messageId` evita duplicar o aviso se o BullMQ reentregar o job.
   */
  private async notifyAudioFallback(
    userId: string,
    messageId: string,
    text: string,
  ): Promise<void> {
    const dedupeId = `audio-fallback-${this.hash(messageId)}`;
    await this.queues.enqueue(
      QUEUE.whatsappOutbound,
      'audio-transcription-fallback',
      { userId, type: 'COACH_MESSAGE', dedupeId, text },
      { jobId: dedupeId },
    );
  }

  /**
   * Loga a rejeição sem vazar detalhe. `bad_signature`/`bad_token` sobem a warn (sinal de
   * tentativa de forja, um por provedor).
   */
  private reject(reason: string, correlationId: string, provider: InboundProvider): void {
    const level = reason === 'bad_signature' || reason === 'bad_token' ? 'warn' : 'info';
    this.logger[level](
      { event: 'webhook_rejected', reason, provider, correlationId },
      'inbound descartado (200, sem processar)',
    );
  }

  /**
   * Consome uma unidade do orçamento do titular. `INCR` + `EXPIRE` só no primeiro
   * incremento da janela (janela deslizante por blocos de 5 min — barato e suficiente:
   * o objetivo é cortar abuso sustentado, não policiar rajada, que o debounce já coalesce).
   */
  private async consumeUserBudget(userId: string): Promise<boolean> {
    const key = this.keys.forUser(userId, 'inbound-rate');
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, USER_RATE_WINDOW_SECONDS);
    return count <= USER_RATE_LIMIT;
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
