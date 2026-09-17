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
import { type AgentPersona } from '@movivo/shared';

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
  PHONE_VERIFICATION_TEMPLATE,
  protocolDeliveryPdfText,
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
  // Renovação de protocolo por fim de mesociclo — convite ao formulário de transição.
  | 'MESOCYCLE_RENEWAL_INVITE'
  // US-3.5 — conversa do Coach: texto dinâmico + indicador de digitação.
  | 'COACH_MESSAGE'
  | 'CHECKIN_MESSAGE'
  | 'WORKOUT_DAILY_LINK'
  | 'WORKOUT_INSIGHT'
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
  /**
   * COACH_MESSAGE: texto já pronto (pode ter `\n---\n` para bolhas).
   * PROTOCOL_DELIVERY (achado 2026-09-04): resumo do treino gerado pela IA no módulo de
   * protocolo (`WorkoutPresentationService`) ANTES de enfileirar — vira a 2ª bolha da
   * entrega com PDF, junto da 1ª bolha estática (ver `buildDelivery`). O `whatsapp` nunca
   * fala com o LLM diretamente (§12.5) — o texto sempre chega pronto no payload.
   */
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
  /**
   * `PROTOCOL_DELIVERY` apenas (achado 2026-09-08): distingue a 1ª entrega do treino de uma
   * reentrega após substituição de exercício aprovada, ou (achado 2026-09-13) após ajuste de
   * volume pelo check-in semanal — a saudação estática muda (ver `protocolDeliveryPdfText`).
   * Ausente/`'INITIAL'` mantém o texto de sempre.
   */
  deliveryReason?: 'INITIAL' | 'SUBSTITUTION' | 'CHECKIN_ADJUSTMENT';
  /** Só com `deliveryReason: 'SUBSTITUTION'` — nomes do exercício trocado, pra saudação. */
  substitutionFromExercise?: string;
  substitutionToExercise?: string;
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
  'WORKOUT_DAILY_LINK',
  'WORKOUT_INSIGHT',
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

    // PROTOCOL_DELIVERY exige documento: saudação + resumo da IA vão na LEGENDA do PDF, uma
    // mensagem só. Não existe mais entrega por texto+link (decisão do fundador, 2026-09-12
    // — ver `buildDelivery`): sem PDF ou sem suporte a documento no transporte, o job FALHA
    // e usa o retry/DLQ genéricos (`whatsappOutbound.attempts=5` em `jobs.config.ts` +
    // `LoggingDeadLetterHandler` via `WorkerFactory`), nunca degrada a entrega.
    if (type === 'PROTOCOL_DELIVERY') {
      const delivery = await this.buildDelivery(job.data);
      if (!delivery) return { status: 'SKIPPED' };
      if (!this.transport.sendDocument) {
        throw new Error('Transporte WhatsApp configurado não suporta envio de documento.');
      }
      // Achado 2026-09-04, a pedido do fundador: se o profissional aprovar/assinar ANTES
      // dos 30min do `PROTOCOL_WAITING` agendado no submit, o aluno não pode pular direto
      // da confirmação pro treino pronto sem nunca conhecer a agente. Garante a ordem
      // apresentação → entrega DENTRO deste mesmo job (duas mensagens separadas enfileiradas
      // não garantiriam ordem entre si) e marca o `PROTOCOL_WAITING` como enviado, para o job
      // de 30min (que ainda dispara — não há como cancelar um delay do BullMQ) virar no-op.
      await this.sendPresentationIfNeeded(userId, phone, job.data, delivery.persona);
      // Achado 2026-09-04 (reproduzido ao vivo, print real do WhatsApp): mandar
      // `delivery.text` como bolha ANTES do documento E de novo como legenda do documento
      // duplicava a saudação ("seu treino está pronto!") nas duas mensagens seguidas — e
      // quando havia resumo de IA, ele saía como uma 3ª bolha à parte, se reapresentando
      // como "Leonardo" de novo (redundante com a apresentação de `sendPresentationIfNeeded`
      // acima) e chegando a afirmar "o PDF já foi enviado" ANTES do documento de fato sair.
      // Uma mensagem só: a legenda do documento carrega saudação + resumo da IA juntos
      // (troca só o separador de bolhas por quebra de parágrafo — a legenda não divide em
      // mensagens, então `BUBBLE_SEPARATOR` apareceria como "---" literal nela).
      const caption = delivery.text.split(BUBBLE_SEPARATOR).join('\n\n');
      await this.transport.sendDocument(
        phone,
        delivery.pdfUrl,
        caption,
        this.config.whatsapp.protocolPdfTemplateName,
        protocolFileName(delivery.studentName),
      );
      await this.redis.set(markerKey, '1', 'EX', SENT_MARKER_TTL_SECONDS);
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
      const buttons = isLast
        ? (data.buttons ?? (data.feedback ? FEEDBACK_BUTTONS : undefined))
        : undefined;
      await this.transport.send({ to: phone, text: bubble, buttons });
    }
  }

  /** Monta o texto por tipo de job. `null` = nada a enviar (ex.: protocolo não aprovado). */
  private async buildText(data: WhatsappOutboundJob): Promise<string | null> {
    switch (data.type) {
      case 'CONFIRMATION':
        return confirmationMessage(await this.resolveFirstName(data.userId));
      case 'CONFIRMATION_CARE':
        return confirmationCareMessage();
      case 'PROTOCOL_WAITING':
        return this.buildWaiting(data.userId);
      case 'PROTOCOL_DELIVERY':
        return null; // tratado antes em process() (pode virar documento, não só texto)
      case 'COACH_MESSAGE':
      case 'CHECKIN_MESSAGE':
      case 'WORKOUT_DAILY_LINK':
      case 'WORKOUT_INSIGHT':
      case 'REENGAGEMENT':
      case 'CONSENT_STATUS':
      case 'MESOCYCLE_RENEWAL_INVITE':
        return data.text ?? null;
      case 'PHONE_VERIFICATION':
      case 'TYPING':
        return null; // tratados antes (código de verificação e presença)
    }
  }

  /**
   * `pdfUrl` só existe quando o protocolo já tem PDF gerado (assinatura CREF,
   * `DashboardService.signProtocol` → `buildProtocolPdf`). `text` é a saudação estática +
   * o resumo gerado pela IA (`data.text`, já pronto — quem enfileirou o job chamou
   * `WorkoutPresentationService` antes; achado 2026-09-04).
   *
   * Decisão do fundador (2026-09-12): entrega por texto+link (sem PDF) foi REMOVIDA —
   * um protocolo `ACTIVE`/aprovado/assinado sem `pdfContent` é falha de geração de PDF,
   * não um caminho normal de produto. Em vez de degradar silenciosamente para uma
   * descrição em texto do plano, o método lança e deixa o job retry/DLQ (ver `process`).
   */
  private async buildDelivery(data: WhatsappOutboundJob): Promise<{
    text: string;
    pdfUrl: string;
    studentName: string | null;
    /** Persona do slot do titular — usada aqui e pela apresentação enviada antes (ver `process`). */
    persona: AgentPersona;
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
            status: protocols.status,
            approvalStatus: protocols.approvalStatus,
            signedAt: protocols.signedAt,
            signatureHash: protocols.signatureHash,
            professionalId: protocols.professionalId,
            pdfContent: protocols.pdfContent,
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
    if (!proto.pdfContent) {
      // Removido 2026-09-12: nunca mais degrada para texto+link. Protocolo aprovado/
      // assinado sem PDF é falha de geração — falha aqui, o job retenta (`whatsappOutbound`,
      // 5 tentativas) e, esgotado, cai na DLQ (`LoggingDeadLetterHandler`), visível em log
      // hoje; alerta dedicado no dashboard fica para uma sprint futura.
      throw new Error(
        `Protocolo ${proto.id} aprovado/assinado mas sem PDF gerado — entrega bloqueada até o PDF existir.`,
      );
    }
    const link = `${this.config.whatsapp.publicSiteUrl}/protocolo/${proto.id}`;
    const persona = await this.agentPersona.persona(biologicalSex);
    const pdfUrl = `${link}/pdf`;
    const firstName = studentName?.trim().split(/\s+/)[0] ?? null;
    const substitution =
      data.deliveryReason === 'SUBSTITUTION' &&
      data.substitutionFromExercise &&
      data.substitutionToExercise
        ? { from: data.substitutionFromExercise, to: data.substitutionToExercise }
        : undefined;
    const volumeAdjusted = data.deliveryReason === 'CHECKIN_ADJUSTMENT';
    const text = protocolDeliveryPdfText(
      firstName,
      data.text?.trim() || undefined,
      substitution,
      volumeAdjusted,
    );
    return {
      text,
      pdfUrl,
      studentName,
      persona,
    };
  }

  /**
   * "Estou analisando" (PROTOCOL_WAITING), agendada no SUBMIT com 30min de atraso
   * (`AnamnesisService.submit`). Nesses 30min o protocolo pode ter sido gerado e entregue —
   * por auto-liberação ou por assinatura do CREF — e nesse caso quem manda a apresentação
   * primeiro é `sendPresentationIfNeeded` (achado 2026-09-04, chamado pelo próprio job de
   * entrega, ANTES da entrega), com o mesmo marker desta mensagem — então este job chega
   * aqui e vira `ALREADY_SENT` no topo de `process()`, antes mesmo de entrar nesta função.
   * `alreadyDelivered` abaixo é só o cinto-e-suspensório caso aquele envio antecipado tenha
   * falhado parcialmente (mandou mas não marcou): nesse caso raro, melhor engolir a
   * apresentação atrasada do que duplicá-la depois que o plano de verdade já chegou.
   *
   * Achado 2026-09-04 (a pedido do fundador): o texto não varia mais por `reviewUrgency` —
   * é sempre a apresentação do agente (`agentSelfIntro`), mandatory ou optional (ver
   * `analyzingMessage`).
   */
  private async buildWaiting(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const { proto, biologicalSex } = await this.db.runAsUser(userId, 'USER', async (tx) => {
      const [row] = await tx
        .select({
          status: protocols.status,
          approvalStatus: protocols.approvalStatus,
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

    return analyzingMessage(await this.agentPersona.persona(biologicalSex));
  }

  /** Mesma chave que um job `PROTOCOL_WAITING` real produziria (sem `protocolVersion`/`dedupeId`). */
  private waitingMarkerKey(userId: string): string {
    return this.keys.forUser(userId, 'wa-sent', 'PROTOCOL_WAITING', 'na');
  }

  /**
   * Garante que a apresentação de 30min saia ANTES da entrega quando o profissional
   * aprova/assina mais rápido que isso (achado 2026-09-04, a pedido do fundador): sem essa
   * garantia, o aluno pularia direto de "recebemos seus dados" pro treino pronto sem nunca
   * conhecer a agente. As duas mensagens saem NO MESMO job (não em dois jobs separados)
   * porque BullMQ não garante ordem entre jobs distintos — só dentro de um.
   *
   * Idempotente pelo MESMO marker que o job `PROTOCOL_WAITING` real usaria: ao marcar aqui,
   * aquele job (ainda agendado — não há como cancelar um delay do BullMQ) chega depois e
   * vira `ALREADY_SENT` no topo de `process()`, sem duplicar.
   */
  private async sendPresentationIfNeeded(
    userId: string,
    phone: string,
    data: Pick<WhatsappOutboundJob, 'buttons' | 'feedback'>,
    persona: AgentPersona,
  ): Promise<void> {
    const key = this.waitingMarkerKey(userId);
    if ((await this.redis.exists(key)) === 1) return;
    await this.sendBubbles(analyzingMessage(persona), phone, data).catch((err: unknown) =>
      this.logger.warn(
        { err, userId },
        'apresentação antecipada falhou — entrega segue de qualquer forma',
      ),
    );
    await this.redis.set(key, '1', 'EX', SENT_MARKER_TTL_SECONDS);
  }

  /** Primeiro nome pra saudar na confirmação (US-2.5) — `null` se o titular não tiver nome salvo. */
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
