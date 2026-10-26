/**
 * Worker da fila `whatsapp-mirror` — completa a linha-espelho gravada por
 * `WhatsappMirrorService`: baixa a mídia (áudio/imagem) da EvolutionAPI, guarda cifrada em
 * disco e, para o que foi digitado no celular, confirma que não é o eco de um envio da API.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import {
  baseMime,
  ConversationMediaStorage,
  CONVERSATION_MEDIA_MAX_BYTES,
  isAllowedConversationMime,
} from '../../core/database/conversation-media-storage.service';
import { conversations } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { ConversationEventsService } from '../../core/event-bus/conversation-events.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { isFinalFailure } from '../jobs/dlq.handler';
import { QUEUE } from '../jobs/jobs.config';
import { WorkerFactory } from '../jobs/worker.factory';
import { EVOLUTION_TRANSPORT, type EvolutionTransport } from './evolution-transport';
import { apiSentKey, type WhatsappMirrorJob } from './whatsapp-mirror.service';

const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
/** Assinaturas mínimas — o tipo é conferido nos bytes, não só no que a EvolutionAPI declarou. */
function matchesSignature(mime: string, bytes: Buffer): boolean {
  if (mime === 'image/jpeg') return bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (mime === 'image/png')
    return bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (mime === 'image/webp') {
    return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  }
  if (mime === 'audio/ogg') return bytes.toString('ascii', 0, 4) === 'OggS';
  // mpeg/mp4/aac/amr/webm: o contêiner varia demais para uma assinatura curta. O navegador só
  // toca como `<audio>` (nunca executa) e a resposta sai com `nosniff`.
  return true;
}

@Injectable()
export class WhatsappMirrorWorker implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly db: TenantDatabase,
    private readonly storage: ConversationMediaStorage,
    private readonly conversationEvents: ConversationEventsService,
    @Inject(EVOLUTION_TRANSPORT) private readonly evolution: EvolutionTransport,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WhatsappMirrorWorker.name);
  }

  onModuleInit(): void {
    this.workers.create<WhatsappMirrorJob>(QUEUE.whatsappMirror, (job) => this.process(job));
  }

  async process(job: Job<WhatsappMirrorJob>): Promise<{ status: string }> {
    const { conversationId, userId, messageId, fromMe, mediaKey } = job.data;

    // Eco do que ESTA API enviou: o histórico já tem a linha do envio (Coach, aviso, manual).
    if (fromMe && (await this.redis.exists(apiSentKey(this.keys, messageId))) === 1) {
      await this.db.runAsSystem((tx) =>
        tx.delete(conversations).where(eq(conversations.id, conversationId)),
      );
      return { status: 'API_ECHO' };
    }

    if (mediaKey) {
      try {
        await this.storeMedia(conversationId, mediaKey);
      } catch (err: unknown) {
        this.logger.warn(
          { event: 'whatsapp_mirror_media_failed', userId, attempt: job.attemptsMade + 1 },
          `mídia não baixada: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
        );
        // Retenta; na última tentativa a mensagem aparece como "indisponível".
        if (!isFinalFailure({ attemptsMade: job.attemptsMade + 1, opts: job.opts })) throw err;
        await this.finish(conversationId, { mediaStatus: 'FAILED' }, fromMe);
        this.conversationEvents.emitMessage(
          userId,
          fromMe ? 'OUTBOUND' : 'INBOUND',
          conversationId,
        );
        return { status: 'MEDIA_FAILED' };
      }
    }
    await this.finish(conversationId, {}, fromMe);
    this.conversationEvents.emitMessage(userId, fromMe ? 'OUTBOUND' : 'INBOUND', conversationId);
    return { status: 'OK' };
  }

  private async storeMedia(conversationId: string, mediaKey: string): Promise<void> {
    const instanceName = this.evolution.lastKnownInstanceName();
    if (!instanceName) throw new Error('instância da EvolutionAPI desconhecida');
    const { base64, mimetype } = await this.evolution.downloadMedia(instanceName, mediaKey);
    const mime = baseMime(mimetype);
    if (
      !isAllowedConversationMime(mime) ||
      !BASE64_RE.test(base64) ||
      base64.length > Math.ceil(CONVERSATION_MEDIA_MAX_BYTES / 3) * 4
    ) {
      throw new Error('formato ou tamanho de mídia não suportado');
    }
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length === 0 || bytes.length > CONVERSATION_MEDIA_MAX_BYTES) {
      throw new Error('mídia vazia ou acima do limite');
    }
    if (!matchesSignature(mime, bytes)) throw new Error('conteúdo não corresponde ao formato');
    const mediaPath = await this.storage.save(bytes);
    await this.db.runAsSystem((tx) =>
      tx
        .update(conversations)
        .set({ mediaPath, mediaMime: mime, mediaBytes: bytes.length, mediaStatus: 'READY' })
        .where(eq(conversations.id, conversationId)),
    );
  }

  /**
   * Fecha o ciclo da linha. A digitada no celular entra no painel agora (com o horário de
   * confirmação, para o painel — que busca "depois da última" — não a perder).
   */
  private finish(
    conversationId: string,
    change: { mediaStatus?: 'FAILED' },
    fromMe: boolean,
  ): Promise<unknown> {
    const set = {
      ...change,
      ...(fromMe ? { hiddenInPanel: false, createdAt: new Date() } : {}),
    };
    if (Object.keys(set).length === 0) return Promise.resolve();
    return this.db.runAsSystem((tx) =>
      tx.update(conversations).set(set).where(eq(conversations.id, conversationId)),
    );
  }
}
