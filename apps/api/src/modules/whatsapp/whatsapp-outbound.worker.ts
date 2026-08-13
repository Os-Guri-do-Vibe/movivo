/**
 * WhatsappOutboundWorker (US-2.5) — processor da fila `whatsapp-outbound`.
 *
 * Consome os jobs que a US-2.4 enfileira (`protocol-delivery`, `protocol-waiting`) e a
 * confirmação imediata do submit (US-2.5.2). Conc.10 / lock 30s / 5 retries / rate limit
 * 80 msg/s vêm do `WorkerFactory` (US-1.7) — não reconfigura.
 *
 * Regras: payload só com UUIDs (telefone e protocolo são lidos sob RLS aqui, nunca no job);
 * **idempotência** por chave de negócio (Redis marker `userId+type+version`) — retry de um
 * envio já concluído não reenvia; só entrega protocolo `AUTO_APPROVED`/`ACTIVE`.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { type Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { AgentPersonaService } from '../../core/agent-config/agent-persona.service';
import { AppConfigService } from '../../core/config';
import { HealthConsentService } from '../../core/database/health-consent.service';
import { protocols, users } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import { REDIS_KEY_BUILDER, RedisKeyBuilder } from '../../core/redis/redis-key.util';
import { QUEUE } from '../jobs/jobs.config';
import { WorkerFactory } from '../jobs/worker.factory';
import {
  type QuickReplyButton,
  WHATSAPP_TRANSPORT,
  type WhatsappTransport,
} from './arara-transport';
import { FEEDBACK_BUTTONS } from './feedback';
import {
  BUBBLE_SEPARATOR,
  confirmationCareMessage,
  confirmationMessage,
  formatProtocolDelivery,
  phoneVerificationMessage,
  waitingMessage,
} from './message-templates';

export type WhatsappJobType =
  | 'CONFIRMATION'
  | 'CONFIRMATION_CARE'
  | 'PROTOCOL_DELIVERY'
  | 'PROTOCOL_WAITING'
  // US-3.5 — conversa do Coach: texto dinâmico + indicador de digitação.
  | 'COACH_MESSAGE'
  | 'CHECKIN_MESSAGE'
  | 'REENGAGEMENT'
  | 'CONSENT_STATUS'
  // US-6.5 — código de verificação de posse do número, ANTES de existir `users`.
  | 'PHONE_VERIFICATION'
  | 'TYPING';

export interface WhatsappOutboundJob {
  /** `null` só em `PHONE_VERIFICATION`: nessa fase o titular ainda não existe. */
  userId: string | null;
  type: WhatsappJobType;
  protocolId?: string;
  protocolVersion?: number;
  /** COACH_MESSAGE: texto já pronto (pode ter `\n---\n` para bolhas). */
  text?: string;
  /** COACH_MESSAGE: chave de idempotência única por resposta (evita colidir no marcador). */
  dedupeId?: string;
  /** COACH_MESSAGE: anexar botões de feedback 👍/👎 à última bolha (US-3.6). */
  feedback?: boolean;
  /** Mensagens de fluxo deterministico (check-in/nudge), sem chamada a LLM. */
  buttons?: readonly QuickReplyButton[];
  /** `PHONE_VERIFICATION`: destino e código de 6 dígitos. */
  phoneNumber?: string;
  code?: string;
}

/** TTL do marcador de idempotência — só precisa cobrir a janela de retry; 7d é folgado. */
const SENT_MARKER_TTL_SECONDS = 7 * 24 * 3600;
const HEALTH_JOB_TYPES: ReadonlySet<WhatsappJobType> = new Set([
  'CONFIRMATION_CARE',
  'PROTOCOL_DELIVERY',
  'PROTOCOL_WAITING',
  'COACH_MESSAGE',
  'CHECKIN_MESSAGE',
  'REENGAGEMENT',
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
    private readonly agentPersona: AgentPersonaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WhatsappOutboundWorker.name);
  }

  onModuleInit(): void {
    this.workers.create<WhatsappOutboundJob>(QUEUE.whatsappOutbound, (job) => this.process(job));
  }

  async process(job: Job<WhatsappOutboundJob>): Promise<{ status: string }> {
    const { userId, type, protocolVersion, dedupeId } = job.data;

    // US-6.5 — o código de verificação é o único envio que acontece ANTES de existir
    // titular: não há `users` para checar consentimento, resolver telefone sob RLS nem
    // montar chave de idempotência por usuário. A idempotência dele é o `jobId` de
    // negócio (sessão + nº do envio), aplicado por quem enfileira.
    if (type === 'PHONE_VERIFICATION') {
      const { phoneNumber, code } = job.data;
      if (!phoneNumber || !code) {
        this.logger.warn({ type }, 'PHONE_VERIFICATION sem destino ou código — descartado');
        return { status: 'INVALID' };
      }
      await this.transport.send({ to: phoneNumber, text: phoneVerificationMessage(code) });
      return { status: 'SENT' };
    }

    if (!userId) {
      this.logger.warn({ type }, 'job de outbound sem titular — descartado');
      return { status: 'INVALID' };
    }

    if (HEALTH_JOB_TYPES.has(type) && !(await this.healthConsent.hasActiveForUser(userId))) {
      this.logger.info(
        { event: 'whatsapp_outbound_discarded_no_consent', userId, type },
        'outbound de saude descartado apos revogacao',
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

    const markerKey = this.keys.forUser(
      userId,
      'wa-sent',
      type,
      String(protocolVersion ?? dedupeId ?? 'na'),
    );

    // Idempotência: envio já concluído não reenvia (retry/duplicata). check→envia→marca —
    // uma falha no meio deixa o marker ausente, então o retry reenvia (at-least-once).
    // ponytail: janela de duplicata se crashar entre bolhas; marker por-bolha se importar.
    if ((await this.redis.exists(markerKey)) === 1) {
      this.logger.info({ userId, type }, 'mensagem já enviada — job idempotente, nada a fazer');
      return { status: 'ALREADY_SENT' };
    }

    const text = await this.buildText(job.data);
    if (!text) return { status: 'SKIPPED' };

    // `\n---\n` → uma mensagem por bolha (Sofia §11). Os botões de feedback (US-3.6) vão
    // só na ÚLTIMA bolha, quando o job pede (resposta real do Coach — não limite/segurança).
    const bubbles = text.split(BUBBLE_SEPARATOR).filter((b) => b.trim());
    for (const [i, bubble] of bubbles.entries()) {
      const isLast = i === bubbles.length - 1;
      const buttons = isLast
        ? (job.data.buttons ?? (job.data.feedback ? FEEDBACK_BUTTONS : undefined))
        : undefined;
      await this.transport.send({ to: phone, text: bubble, buttons });
    }

    await this.redis.set(markerKey, '1', 'EX', SENT_MARKER_TTL_SECONDS);

    if (type === 'PROTOCOL_DELIVERY') {
      // ponytail: SLA submit→entrega junta este evento com o `protocol_sent` de enfileiramento
      // da US-2.4 (o job de entrega não carrega submittedAt). Server SDK do PostHog: Sprint futura.
      this.logger.info(
        {
          event: 'protocol_sent',
          userId,
          protocolId: job.data.protocolId,
          deliveredAt: Date.now(),
        },
        'protocol_sent (entrega concluída)',
      );
    }
    return { status: 'SENT' };
  }

  /** Monta o texto por tipo de job. `null` = nada a enviar (ex.: protocolo não aprovado). */
  private async buildText(data: WhatsappOutboundJob): Promise<string | null> {
    switch (data.type) {
      case 'CONFIRMATION':
        return confirmationMessage();
      case 'CONFIRMATION_CARE':
        return confirmationCareMessage();
      case 'PROTOCOL_WAITING':
        return waitingMessage();
      case 'PROTOCOL_DELIVERY':
        return this.buildDelivery(data);
      case 'COACH_MESSAGE':
      case 'CHECKIN_MESSAGE':
      case 'REENGAGEMENT':
      case 'CONSENT_STATUS':
        return data.text ?? null;
      case 'PHONE_VERIFICATION':
      case 'TYPING':
        return null; // tratados antes (código de verificação e presença)
    }
  }

  private async buildDelivery(data: WhatsappOutboundJob): Promise<string | null> {
    const userId = data.userId;
    if (!userId) return null;
    const proto = await this.db.runAsUser(userId, 'USER', async (tx) => {
      const [row] = await tx
        .select({
          id: protocols.id,
          content: protocols.content,
          status: protocols.status,
          approvalStatus: protocols.approvalStatus,
          signedAt: protocols.signedAt,
          signatureHash: protocols.signatureHash,
          professionalId: protocols.professionalId,
        })
        .from(protocols)
        .where(
          and(
            eq(protocols.userId, userId),
            data.protocolId ? eq(protocols.id, data.protocolId) : undefined,
            data.protocolVersion ? eq(protocols.version, data.protocolVersion) : undefined,
          ),
        )
        .limit(1);
      return row;
    });

    // Só entrega o protocolo auto-aprovado e ativo (guardrail: nada não-validado sai).
    if (
      !proto ||
      proto.status !== 'ACTIVE' ||
      !['AUTO_APPROVED', 'HUMAN_APPROVED'].includes(proto.approvalStatus) ||
      !proto.signedAt ||
      !proto.signatureHash ||
      !proto.professionalId
    ) {
      this.logger.warn(
        { userId: data.userId, status: proto?.status },
        'entrega ignorada — protocolo não está AUTO_APPROVED/ACTIVE',
      );
      return null;
    }
    const link = `${this.config.whatsapp.publicSiteUrl}/protocolo/${proto.id}`;
    return formatProtocolDelivery(
      proto.content as Parameters<typeof formatProtocolDelivery>[0],
      link,
      await this.agentPersona.agentName(),
    );
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
