/**
 * Espelho da aba "Conversas" — grava CADA mensagem 1:1 do WhatsApp, antes e fora do pipeline
 * da IA.
 *
 * Por que existe: o histórico nasceu como subproduto da IA (ele persiste o turno que
 * respondeu). Tudo que o pipeline não responde — consentimento ausente, assinatura, botão do
 * treino, orçamento estourado, áudio que falhou, imagem — nunca chegava ao painel, e o que o
 * profissional digitava direto no celular era descartado como "eco". Aqui toda mensagem vira
 * uma linha (`mirror = true`), idempotente pelo id do WhatsApp (`whatsapp_msg_id` UNIQUE).
 *
 * O que NÃO muda: a IA continua lendo o turno que ela mesma persiste. As linhas-espelho ficam
 * fora da transcrição da IA (menos a mensagem do profissional) e o turno agregado da IA
 * sai do painel (`hidden_in_panel`) para a mesma fala não aparecer duas vezes.
 */
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import { conversations, users } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { ConversationEventsService } from '../../core/event-bus/conversation-events.service';
import type { RedisKeyBuilder } from '../../core/redis';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { MirrorCapture } from './inbound/inbound-message';

/**
 * A mensagem digitada no celular só é confirmada depois deste atraso: o eco de um envio da
 * própria API chega pelo webhook junto com a resposta do envio, e o id só é registrado quando
 * essa resposta volta. O atraso cobre a corrida com folga.
 */
export const PHONE_CONFIRM_DELAY_MS = 15_000;

export interface WhatsappMirrorJob {
  readonly conversationId: string;
  readonly userId: string;
  readonly messageId: string;
  readonly fromMe: boolean;
  /** Ausente em mensagem de texto digitada no celular (só precisa ser confirmada). */
  readonly mediaKey?: string;
}

/** Chave Redis do "esta API enviou esta mensagem" — `messageId` hasheado vira segmento válido. */
export function apiSentKey(keys: RedisKeyBuilder, messageId: string): string {
  return keys.global('wa-api-sent', createHash('sha256').update(messageId).digest('hex'));
}

@Injectable()
export class WhatsappMirrorService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
    private readonly queues: QueueManager,
    private readonly conversationEvents: ConversationEventsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WhatsappMirrorService.name);
  }

  /**
   * Registra a mensagem. Nunca lança: o espelho é observabilidade e não pode derrubar o
   * atendimento (o pipeline da IA roda a seguir, com ou sem ele).
   */
  async capture(event: MirrorCapture): Promise<void> {
    try {
      const [owner] = await this.db.runAsSystem((tx) =>
        tx.select({ id: users.id }).from(users).where(eq(users.phoneNumber, event.phone)).limit(1),
      );
      // Remetente desconhecido: sem titular não há onde gravar (`conversations.user_id` é NOT NULL).
      if (!owner) return;
      const userId = owner.id;

      const isMedia = event.kind !== 'TEXT';
      const content = await this.cipher.encryptText(event.text);
      const [row] = await this.db.runAsUser(userId, 'USER', (tx) =>
        tx
          .insert(conversations)
          .values({
            userId,
            direction: event.fromMe ? 'OUTBOUND' : 'INBOUND',
            origin: event.fromMe ? 'PROFESSIONAL' : 'STUDENT',
            sourceType: event.fromMe ? 'PHONE_MESSAGE' : null,
            messageType: event.kind,
            content,
            whatsappMsgId: event.messageId,
            mirror: true,
            // Do celular: só aparece depois de confirmada como não sendo eco da API.
            hiddenInPanel: event.fromMe,
            mediaStatus: isMedia ? 'PENDING' : null,
            mediaSeconds: event.seconds ?? null,
          })
          .onConflictDoNothing({ target: conversations.whatsappMsgId })
          .returning({ id: conversations.id }),
      );
      // Reentrega do mesmo evento (reconexão do Baileys): já registrada.
      if (!row) return;

      if (event.fromMe || isMedia) {
        const job: WhatsappMirrorJob = {
          conversationId: row.id,
          userId,
          messageId: event.messageId,
          fromMe: event.fromMe,
          ...(isMedia && event.mediaKey ? { mediaKey: event.mediaKey } : {}),
        };
        await this.queues.enqueue(QUEUE.whatsappMirror, 'mirror', job, {
          jobId: `mirror_${row.id}`,
          ...(event.fromMe ? { delay: PHONE_CONFIRM_DELAY_MS } : {}),
        });
      } else {
        this.conversationEvents.emitMessage(userId, 'INBOUND', row.id);
      }
    } catch (err: unknown) {
      this.logger.warn(
        { err, event: 'whatsapp_mirror_capture_failed' },
        'mensagem não foi espelhada no histórico de conversas',
      );
    }
  }

  /** Guarda a transcrição do áudio na linha-espelho (o painel mostra junto do player). */
  async attachTranscript(userId: string, messageId: string, transcript: string): Promise<void> {
    try {
      const content = await this.cipher.encryptText(transcript);
      await this.db.runAsUser(userId, 'USER', (tx) =>
        tx
          .update(conversations)
          .set({ content })
          .where(and(eq(conversations.userId, userId), eq(conversations.whatsappMsgId, messageId))),
      );
    } catch (err: unknown) {
      this.logger.warn(
        { err, userId, event: 'whatsapp_mirror_transcript_failed' },
        'transcrição não foi anexada ao áudio espelhado',
      );
    }
  }
}
