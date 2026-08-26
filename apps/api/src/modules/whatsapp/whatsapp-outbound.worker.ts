/**
 * WhatsappOutboundWorker (US-2.5) — processor da fila `whatsapp-outbound`.
 *
 * Consome os jobs que a US-2.4 enfileira (`protocol-delivery`) e os que o submit agenda
 * (`confirmation`/`confirmation-care` imediatos e `protocol-waiting` com 30min de atraso). Conc.10 / lock 30s / 5 retries / rate limit
 * 80 msg/s vêm do `WorkerFactory` (US-1.7) — não reconfigura.
 *
 * Regras: payload só com UUIDs (telefone e protocolo são lidos sob RLS aqui, nunca no job);
 * **idempotência** por chave de negócio (Redis marker `userId+type+version`) — retry de um
 * envio já concluído não reenvia; só entrega protocolo `AUTO_APPROVED`/`ACTIVE`.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { type Job } from 'bullmq';
import { and, desc, eq } from 'drizzle-orm';
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
import { FEEDBACK_BUTTONS } from './feedback';
import {
  analyzingMessage,
  BUBBLE_SEPARATOR,
  confirmationCareMessage,
  confirmationMessage,
  formatProtocolDelivery,
  PHONE_VERIFICATION_TEMPLATE,
  protocolDeliveryText,
} from './message-templates';
import {
  type QuickReplyButton,
  WHATSAPP_TRANSPORT,
  type WhatsappTransport,
} from './whatsapp-transport';

export type WhatsappJobType =
  | 'CONFIRMATION'
  | 'CONFIRMATION_CARE'
  | 'PROTOCOL_DELIVERY'
  | 'PROTOCOL_WAITING'
  // US-3.5 — conversa do Coach: texto dinâmico + indicador de digitação.
  | 'COACH_MESSAGE'
  | 'CHECKIN_MESSAGE'
  // US-8.1 — quick reply diario de treino ("Treinei"/"Hoje nao").
  | 'WORKOUT_QUICK_REPLY'
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

/**
 * Nome do anexo do PDF como o titular VÊ no WhatsApp (achado 2026-08-25 — "protocolo-movivo.pdf"
 * genérico demais). Nunca vai na URL pública do documento (essa continua anônima/IDOR-safe —
 * ver `protocol.controller.ts`); só no campo de nome de arquivo que o transporte manda junto
 * do envio, que só quem já resolveu o telefone sob RLS consegue montar.
 */
function protocolFileName(studentName: string | null): string {
  const slug = (studentName ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `protocolo-${slug}-movivo.pdf` : 'protocolo-movivo.pdf';
}

/** TTL do marcador de idempotência — só precisa cobrir a janela de retry; 7d é folgado. */
const SENT_MARKER_TTL_SECONDS = 7 * 24 * 3600;
const HEALTH_JOB_TYPES: ReadonlySet<WhatsappJobType> = new Set([
  'CONFIRMATION_CARE',
  'PROTOCOL_DELIVERY',
  'PROTOCOL_WAITING',
  'COACH_MESSAGE',
  'CHECKIN_MESSAGE',
  'WORKOUT_QUICK_REPLY',
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
      // Texto livre é rejeitado (fora da janela de 24h) — precisa ser Template aprovado.
      await this.transport.sendTemplate(phoneNumber, PHONE_VERIFICATION_TEMPLATE, [code]);
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

    // `|| 'na'` (e não `??`): um `dedupeId` vazio precisa cair no default igual a um
    // ausente. Com `??` a string vazia sobrevivia e virava segmento inválido de chave
    // Redis, derrubando o envio em todas as tentativas (achado de QA 2026-08-24 — a
    // origem era o correlationId vazio das entregas reais, corrigido no controller;
    // isto aqui é a rede de proteção para qualquer outra origem de dedupeId vazio).
    const markerKey = this.keys.forUser(
      userId,
      'wa-sent',
      type,
      String(protocolVersion ?? dedupeId ?? '') || 'na',
    );

    // Idempotência: envio já concluído não reenvia (retry/duplicata). check→envia→marca —
    // uma falha no meio deixa o marker ausente, então o retry reenvia (at-least-once).
    // ponytail: janela de duplicata se crashar entre bolhas; marker por-bolha se importar.
    if ((await this.redis.exists(markerKey)) === 1) {
      this.logger.info({ userId, type }, 'mensagem já enviada — job idempotente, nada a fazer');
      return { status: 'ALREADY_SENT' };
    }

    // PROTOCOL_DELIVERY é tratado à parte: quando há PDF gerado (assinatura CREF), o texto
    // explicativo vai em bolhas E o plano vai como documento; sem PDF, só o texto+link de
    // sempre. Os dois caminhos usam o MESMO marker de idempotência acima, então nunca
    // duplica entre um e outro.
    if (type === 'PROTOCOL_DELIVERY') {
      const delivery = await this.buildDelivery(job.data);
      if (!delivery) return { status: 'SKIPPED' };
      if (delivery.pdfUrl && this.transport.sendDocument) {
        // O texto explicativo vem ANTES do documento (contexto primeiro, anexo depois) e é
        // best-effort: se falhar, o PDF — que é a entrega em si — segue de qualquer forma.
        await this.sendBubbles(delivery.text, phone, job.data).catch((err: unknown) =>
          this.logger.warn(
            { err, userId },
            'texto explicativo da entrega falhou — PDF segue de qualquer forma',
          ),
        );
        await this.transport.sendDocument(
          phone,
          delivery.pdfUrl,
          // Só afirma revisão humana quando ela realmente aconteceu: auto-liberação é
          // assinatura em nível de metodologia, não leitura caso a caso do protocolo.
          delivery.humanSigned
            ? 'Seu plano de treino em PDF. 📄 Revisado e assinado pelo profissional de Educação Física registrado no CREF responsável pela MOVIVO.'
            : 'Seu plano de treino em PDF. 📄 Montado dentro da metodologia do profissional de Educação Física registrado no CREF responsável pela MOVIVO.',
          this.config.whatsapp.protocolPdfTemplateName,
          protocolFileName(delivery.studentName),
        );
      } else {
        await this.sendBubbles(delivery.text, phone, job.data);
      }
      await this.redis.set(markerKey, '1', 'EX', SENT_MARKER_TTL_SECONDS);
      // ponytail: SLA submit→entrega junta este evento com o `protocol_sent` de enfileiramento
      // da US-2.4 (o job de entrega não carrega submittedAt). Server SDK do PostHog: Sprint futura.
      this.logger.info(
        { event: 'protocol_sent', userId, protocolId: job.data.protocolId, deliveredAt: Date.now() },
        'protocol_sent (entrega concluída)',
      );
      return { status: 'SENT' };
    }

    const text = await this.buildText(job.data);
    if (!text) return { status: 'SKIPPED' };
    await this.sendBubbles(text, phone, job.data);
    await this.redis.set(markerKey, '1', 'EX', SENT_MARKER_TTL_SECONDS);
    return { status: 'SENT' };
  }

  /** `\n---\n` → uma mensagem por bolha (Sofia §11). Botões de feedback só na ÚLTIMA bolha. */
  private async sendBubbles(
    text: string,
    phone: string,
    data: Pick<WhatsappOutboundJob, 'buttons' | 'feedback'>,
  ): Promise<void> {
    const bubbles = text.split(BUBBLE_SEPARATOR).filter((b) => b.trim());
    for (const [i, bubble] of bubbles.entries()) {
      const isLast = i === bubbles.length - 1;
      const buttons = isLast ? (data.buttons ?? (data.feedback ? FEEDBACK_BUTTONS : undefined)) : undefined;
      await this.transport.send({ to: phone, text: bubble, buttons });
    }
  }

  /** Monta o texto por tipo de job. `null` = nada a enviar (ex.: protocolo não aprovado). */
  private async buildText(data: WhatsappOutboundJob): Promise<string | null> {
    switch (data.type) {
      case 'CONFIRMATION':
        return confirmationMessage();
      case 'CONFIRMATION_CARE':
        return confirmationCareMessage();
      case 'PROTOCOL_WAITING':
        return this.buildWaiting(data.userId);
      case 'PROTOCOL_DELIVERY':
        return null; // tratado antes em process() (pode virar documento, não só texto)
      case 'COACH_MESSAGE':
      case 'CHECKIN_MESSAGE':
      case 'WORKOUT_QUICK_REPLY':
      case 'REENGAGEMENT':
      case 'CONSENT_STATUS':
        return data.text ?? null;
      case 'PHONE_VERIFICATION':
      case 'TYPING':
        return null; // tratados antes (código de verificação e presença)
    }
  }

  /**
   * `pdfUrl` só vem preenchido quando o protocolo já tem PDF gerado (assinatura CREF,
   * `DashboardService.signProtocol` → `buildProtocolPdf`) — `AUTO_APPROVED` ainda não gera
   * PDF (Sprint futura), então cai no texto+link de sempre (`text`, sempre montado).
   */
  private async buildDelivery(data: WhatsappOutboundJob): Promise<{
    text: string;
    pdfUrl?: string;
    studentName: string | null;
    /** Assinado por um humano de verdade (não a auto-liberação) — decide a legenda do PDF. */
    humanSigned: boolean;
  } | null> {
    const userId = data.userId;
    if (!userId) return null;
    const { proto, studentName, biologicalSex } = await this.db.runAsUser(
      userId,
      'USER',
      async (tx) => {
      const [row] = await tx
        .select({
          id: protocols.id,
          content: protocols.content,
          status: protocols.status,
          approvalStatus: protocols.approvalStatus,
          signedAt: protocols.signedAt,
          signatureHash: protocols.signatureHash,
          professionalId: protocols.professionalId,
          pdfContent: protocols.pdfContent,
          totalWeeks: protocols.totalWeeks,
          mesocycleName: protocols.mesocycleName,
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
      // `biologicalSex` entra na projeção que já existia (Sprint 11): é ele que decide qual
      // das duas personas publicadas assina a entrega. Nulo é normal e cai no empréstimo
      // entre slots — nunca derruba a mensagem.
      const [self] = await tx
        .select({ name: users.name, biologicalSex: users.biologicalSex })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return {
        proto: row,
        studentName: self?.name ?? null,
        biologicalSex: self?.biologicalSex ?? null,
      };
      },
    );

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
    const content = proto.content as Parameters<typeof formatProtocolDelivery>[0];
    const persona = await this.agentPersona.persona(biologicalSex);
    const pdfUrl = proto.pdfContent ? `${link}/pdf` : undefined;
    // Com PDF, o anexo JÁ é o plano completo — o texto vira só o "porquê" curto (achado
    // 2026-08-25). Sem PDF (fallback raro), o texto é a entrega inteira: precisa do
    // primeiro treino e do link, senão o titular não vê o plano em lugar nenhum.
    const text = pdfUrl
      ? protocolDeliveryText(content, persona, proto.totalWeeks, proto.mesocycleName)
      : formatProtocolDelivery(content, link, persona, proto.totalWeeks, proto.mesocycleName);
    return {
      text,
      pdfUrl,
      studentName,
      humanSigned: proto.approvalStatus === 'HUMAN_APPROVED' && Boolean(proto.signedAt),
    };
  }

  /**
   * "Estou analisando" (PROTOCOL_WAITING), agendada no SUBMIT com 30min de atraso
   * (`AnamnesisService.submit`). Nesses 30min o protocolo pode ter sido gerado e entregue —
   * por auto-liberação ou por assinatura do CREF. Por isso o estado é reconfirmado aqui, na
   * hora do envio, e não só no enqueue: mandar "já estou analisando" depois que o plano de
   * verdade chegou seria ruído.
   *
   * O mesmo carregamento decide a variante do texto: `reviewUrgency = MANDATORY` (PAR-Q
   * bloqueado) é o único caso em que o protocolo só sai por assinatura humana — aí a copy
   * não promete prazo. Sem protocolo ainda (geração em curso/atrasada), trata como o caso
   * comum: `mandatory: false`.
   */
  private async buildWaiting(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const { proto, biologicalSex } = await this.db.runAsUser(userId, 'USER', async (tx) => {
      const [row] = await tx
        .select({
          status: protocols.status,
          approvalStatus: protocols.approvalStatus,
          reviewUrgency: protocols.reviewUrgency,
        })
        .from(protocols)
        .where(eq(protocols.userId, userId))
        .orderBy(desc(protocols.version))
        .limit(1);
      // Sprint 11: o slot da persona sai da mesma transação sob RLS que já resolvia o estado
      // do protocolo — sem ida extra ao banco por mensagem.
      const [self] = await tx
        .select({ biologicalSex: users.biologicalSex })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return { proto: row, biologicalSex: self?.biologicalSex ?? null };
    });

    const alreadyDelivered =
      proto?.status === 'ACTIVE' &&
      ['AUTO_APPROVED', 'HUMAN_APPROVED'].includes(proto.approvalStatus);
    if (alreadyDelivered) return null;

    return analyzingMessage(await this.agentPersona.persona(biologicalSex), {
      mandatory: proto?.reviewUrgency === 'MANDATORY',
    });
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
