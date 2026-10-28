/**
 * WhatsappOutboundWorker — processador da fila `whatsapp-outbound`.
 *
 * Envia o que os outros módulos enfileiram (conversa, links do dia, check-in, confirmações,
 * código de verificação, alerta à equipe). Concorrência, lock, retries e rate limit vêm do
 * `WorkerFactory`.
 *
 * Regras: payload só com UUIDs (o telefone é lido sob RLS aqui, nunca no job); **idempotência**
 * por chave de negócio (marcador no Redis `userId+type+chave`): retry de um envio concluído
 * não reenvia; mensagens de saúde são descartadas depois da revogação do consentimento.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { AppConfigService } from '../../core/config';
import { HealthCipherService } from '../../core/database/health-cipher.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import { conversations, users } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { ConversationEventsService } from '../../core/event-bus/conversation-events.service';
import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import { REDIS_KEY_BUILDER, RedisKeyBuilder } from '../../core/redis/redis-key.util';
import { QUEUE } from '../jobs/jobs.config';
import type { WhatsappJobType, WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { WorkerFactory } from '../jobs/worker.factory';
import { FEEDBACK_BUTTONS } from './feedback';
import {
  BUBBLE_SEPARATOR,
  confirmationCareMessage,
  confirmationMessage,
  PHONE_VERIFICATION_TEMPLATE,
} from './message-templates';
import { WHATSAPP_TRANSPORT, type WhatsappTransport } from './whatsapp-transport';

export type { WhatsappJobType, WhatsappOutboundJob };

/** TTL do marcador de idempotência — só precisa cobrir a janela de retry; 7d é folgado. */
const SENT_MARKER_TTL_SECONDS = 7 * 24 * 3600;
const HEALTH_JOB_TYPES: ReadonlySet<WhatsappJobType> = new Set([
  'CONFIRMATION_CARE',
  'COACH_MESSAGE',
  'CHECKIN_MESSAGE',
  'WORKOUT_DAILY_LINK',
  'MANUAL_MESSAGE',
]);

@Injectable()
export class WhatsappOutboundWorker implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly db: TenantDatabase,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    @Inject(WHATSAPP_TRANSPORT) private readonly transport: WhatsappTransport,
    private readonly healthConsent: HealthConsentService,
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
    private readonly cipher: HealthCipherService,
    private readonly conversationEvents: ConversationEventsService,
  ) {
    this.logger.setContext(WhatsappOutboundWorker.name);
  }

  onModuleInit(): void {
    this.workers.create<WhatsappOutboundJob>(QUEUE.whatsappOutbound, (job) => this.process(job));
  }

  async process(job: Job<WhatsappOutboundJob>): Promise<{ status: string }> {
    const { userId, type, dedupeId } = job.data;

    // O código de verificação é o único envio que acontece ANTES de existir titular: não há
    // `users` para checar consentimento nem montar chave por usuário. A idempotência dele é o
    // `jobId` de negócio (sessão + nº do envio), aplicado por quem enfileira.
    if (type === 'PHONE_VERIFICATION') {
      const { phoneNumber, code } = job.data;
      if (!phoneNumber || !code) {
        this.logger.warn({ type }, 'PHONE_VERIFICATION sem destino ou código — descartado');
        return { status: 'INVALID' };
      }
      await this.transport.sendTemplate(phoneNumber, PHONE_VERIFICATION_TEMPLATE, [code]);
      return { status: 'SENT' };
    }

    // Alerta à equipe: o destino é o número configurado, nunca o do aluno.
    if (type === 'STAFF_QUEUE_ALERT') return this.sendStaffQueueAlert(job.data);

    if (!userId) {
      this.logger.warn({ type }, 'job de outbound sem titular — descartado');
      return { status: 'INVALID' };
    }

    if (HEALTH_JOB_TYPES.has(type) && !(await this.healthConsent.hasActiveForUser(userId))) {
      this.logger.info(
        { event: 'whatsapp_outbound_discarded_no_consent', userId, type },
        'outbound de saúde descartado após revogação',
      );
      return { status: 'CONSENT_REVOKED' };
    }

    const phone = await this.resolvePhone(userId);
    if (!phone) {
      this.logger.warn({ userId }, 'usuário sem telefone — nada a enviar');
      return { status: 'NO_PHONE' };
    }

    // "digitando…" é best-effort e sem idempotência (presença, não mensagem).
    if (type === 'TYPING') {
      await this.transport.sendTyping?.(phone);
      return { status: 'TYPING' };
    }

    // `|| 'na'` (e não `??`): um `dedupeId` vazio precisa cair no default igual a um ausente;
    // a string vazia viraria segmento inválido de chave Redis e derrubaria todas as tentativas.
    const markerKey = this.keys.forUser(userId, 'wa-sent', type, String(dedupeId ?? '') || 'na');

    // Idempotência: envio já concluído não reenvia (retry/duplicata). check→envia→marca —
    // uma falha no meio deixa o marcador ausente, então o retry reenvia (ao menos uma vez).
    if ((await this.redis.exists(markerKey)) === 1) {
      this.logger.info({ userId, type }, 'mensagem já enviada — job idempotente, nada a fazer');
      return { status: 'ALREADY_SENT' };
    }

    const text = await this.buildText(job.data);
    if (!text) return { status: 'SKIPPED' };
    // `COACH_MESSAGE` e `MANUAL_MESSAGE` já são gravados em `conversations` por quem os cria
    // (o worker da conversa e a API do painel); gravar de novo duplicaria.
    const alreadyRecorded = type === 'COACH_MESSAGE' || type === 'MANUAL_MESSAGE';
    await this.sendBubbles(text, phone, job.data, alreadyRecorded ? undefined : userId);
    await this.redis.set(markerKey, '1', 'EX', SENT_MARKER_TTL_SECONDS);
    return { status: 'SENT' };
  }

  /**
   * `\n---\n` → uma mensagem por bolha. Botões de feedback só na ÚLTIMA bolha. Com
   * `recordForUserId`, cada bolha enviada também entra no histórico da aba "Conversas".
   */
  private async sendBubbles(
    text: string,
    phone: string,
    data: Pick<WhatsappOutboundJob, 'buttons' | 'feedback' | 'type'>,
    recordForUserId?: string,
  ): Promise<void> {
    const bubbles = text.split(BUBBLE_SEPARATOR).filter((b) => b.trim());
    for (const [i, bubble] of bubbles.entries()) {
      const isLast = i === bubbles.length - 1;
      const buttons = isLast
        ? (data.buttons ?? (data.feedback ? FEEDBACK_BUTTONS : undefined))
        : undefined;
      await this.transport.send({ to: phone, text: bubble, buttons });
      if (recordForUserId) await this.recordOutbound(recordForUserId, bubble, data.type);
    }
  }

  /**
   * Espelha no histórico de conversas uma mensagem que JÁ saiu pelo WhatsApp — é o que
   * alimenta a aba "Conversas" do painel. Melhor esforço: o envio é a fonte de verdade e já
   * aconteceu; lançar aqui faria o BullMQ repetir o job e reenviar a mensagem ao aluno.
   */
  private async recordOutbound(
    userId: string,
    text: string,
    sourceType?: WhatsappJobType,
  ): Promise<void> {
    try {
      const content = await this.cipher.encryptText(text);
      await this.db.runAsUser(userId, 'USER', async (tx) => {
        await tx.insert(conversations).values({
          userId,
          direction: 'OUTBOUND',
          origin: 'SYSTEM',
          sourceType: sourceType ?? null,
          content,
        });
      });
      this.conversationEvents.emitMessage(userId, 'OUTBOUND');
    } catch (err: unknown) {
      this.logger.warn(
        { err, userId, event: 'whatsapp_outbound_history_failed' },
        'mensagem enviada, mas não foi gravada no histórico de conversas',
      );
    }
  }

  private async sendStaffQueueAlert(data: WhatsappOutboundJob): Promise<{ status: string }> {
    const to = this.config.whatsapp.staffQueueAlertPhone;
    if (!to) return { status: 'DISABLED' };
    if (!data.text || !data.dedupeId) {
      this.logger.warn({ type: data.type }, 'STAFF_QUEUE_ALERT sem texto ou chave — descartado');
      return { status: 'INVALID' };
    }
    const markerKey = this.keys.global('wa-sent', data.type, data.dedupeId);
    if ((await this.redis.exists(markerKey)) === 1) return { status: 'ALREADY_SENT' };
    await this.transport.send({ to, text: data.text });
    await this.redis.set(markerKey, '1', 'EX', SENT_MARKER_TTL_SECONDS);
    return { status: 'SENT' };
  }

  /** Monta o texto por tipo de job. `null` = nada a enviar. */
  private async buildText(data: WhatsappOutboundJob): Promise<string | null> {
    switch (data.type) {
      case 'CONFIRMATION':
        return confirmationMessage(await this.resolveFirstName(data.userId));
      case 'CONFIRMATION_CARE':
        return confirmationCareMessage();
      case 'COACH_MESSAGE':
      case 'CHECKIN_MESSAGE':
      case 'WORKOUT_DAILY_LINK':
      case 'CONSENT_STATUS':
      case 'MANUAL_MESSAGE':
        return data.text ?? null;
      case 'PHONE_VERIFICATION':
      case 'STAFF_QUEUE_ALERT':
      case 'TYPING':
        return null; // tratados antes (código de verificação, alerta e presença)
    }
  }

  /** Primeiro nome para saudar na confirmação — `null` se o titular não tiver nome salvo. */
  private async resolveFirstName(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const [row] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1),
    );
    return row?.name?.trim().split(/\s+/)[0] ?? null;
  }

  private async resolvePhone(userId: string): Promise<string | null> {
    const [row] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ phoneNumber: users.phoneNumber })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
    );
    return row?.phoneNumber ?? null;
  }
}
