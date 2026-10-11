import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  controlCenterConversationAiAttendanceInputSchema,
  controlCenterConversationReadInputSchema,
  controlCenterConversationSendInputSchema,
} from '@movivo/shared';
import { and, asc, desc, eq, gt, gte, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { z } from 'zod';

import { CoachAttendanceService } from '../../core/database/coach-attendance.service';
import { HealthCipherService } from '../../core/database/health-cipher.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import { conversations, users } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { ConversationEventsService } from '../../core/event-bus/conversation-events.service';
import { strictSafeParse } from '../../core/validation/strict-input';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { EVOLUTION_TRANSPORT, type EvolutionTransport } from '../whatsapp/evolution-transport';
import { AuditService } from './audit.service';

const TIMEZONE = 'America/Sao_Paulo' as const;

export const CONVERSATIONS_LIST_LIMIT = 500;
export const MESSAGES_PAGE_DEFAULT = 50;
export const MESSAGES_PAGE_MAX = 100;

/** Foto de perfil muda pouco; "sem foto" expira antes para o aluno que a coloca depois. */
const PHOTO_TTL_SECONDS = 6 * 60 * 60;
const NO_PHOTO_TTL_SECONDS = 60 * 60;
const NO_PHOTO = '';

/** O painel só encaminha foto hospedada pelo WhatsApp/Meta — nunca uma URL arbitrária. */
const PHOTO_HOST_SUFFIXES = ['.whatsapp.net', '.whatsapp.com', '.fbcdn.net'] as const;

export function isWhatsappPhotoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      PHOTO_HOST_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix))
    );
  } catch {
    return false;
  }
}

/**
 * Aba "Conversas" do Control Center: histórico de WhatsApp (`conversations`) e, quando o
 * profissional pausa o atendimento automático do AI Coach, a conversa manual com o aluno.
 * O corpo da mensagem é dado de saúde (LGPD Art. 11), então o corte é no servidor — o
 * controller exige `STUDENTS_READ` + `STUDENTS_HEALTH_READ` (e `CONVERSATIONS_WRITE` para
 * pausar/escrever), a leitura roda sob a RLS do ator (profissional só enxerga titular com
 * consentimento de saúde ativo) e cada abertura, pausa e envio fica na trilha de auditoria.
 */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly audit: AuditService,
    private readonly cipher: HealthCipherService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly redisKeys: RedisKeyBuilder,
    @Inject(EVOLUTION_TRANSPORT) private readonly evolution: EvolutionTransport,
    private readonly coachAttendance: CoachAttendanceService,
    private readonly healthConsent: HealthConsentService,
    private readonly queues: QueueManager,
    private readonly conversationEvents: ConversationEventsService,
  ) {}

  /** Alunos com ao menos uma mensagem, da conversa mais recente para a mais antiga. */
  async list(actor: AuthenticatedUser) {
    const lastMessageAt = sql<Date | string>`max(${conversations.createdAt})`;
    // Mensagem do aluno (a de feedback 👍/👎 é SYSTEM e não conta) recebida depois do ponteiro de leitura.
    const unreadCount = sql<number>`count(*) filter (where ${conversations.direction} = 'INBOUND' and ${conversations.messageType} <> 'SYSTEM' and (${users.conversationReadAt} is null or ${conversations.createdAt} > ${users.conversationReadAt}))::int`;
    const rows = await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      const found = await tx
        .select({
          studentId: users.id,
          name: users.name,
          whatsappName: users.whatsappName,
          phoneNumber: users.phoneNumber,
          coachPausedAt: users.coachPausedAt,
          unreadCount,
          lastMessageAt,
        })
        .from(conversations)
        .innerJoin(users, eq(users.id, conversations.userId))
        .where(and(eq(users.role, 'USER'), isNull(users.anonymizedAt)))
        .groupBy(users.id)
        .orderBy(desc(lastMessageAt))
        .limit(CONVERSATIONS_LIST_LIMIT);
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action: 'CONVERSATIONS_LIST_VIEWED',
        entityType: 'conversation_list',
        entityId: actor.userId,
        changes: { purpose: 'control_center_list', role: actor.role, recordCount: found.length },
      });
      return found;
    });
    return this.envelope({
      conversations: rows.map(
        ({ whatsappName, lastMessageAt: last, name, coachPausedAt, ...row }) => ({
          ...row,
          name: name ?? whatsappName ?? null,
          lastMessageAt: new Date(last).toISOString(),
          aiPaused: coachPausedAt !== null,
        }),
      ),
    });
  }

  /**
   * Uma página do histórico, em ordem cronológica. `before` (ISO) pagina para trás a partir
   * da mensagem mais antiga já carregada. `after` (ISO) devolve só o que chegou desde então
   * (inclusive o próprio instante, o cliente deduplica por id) — é o que o tempo real usa
   * para trazer mensagem nova sem recarregar a conversa inteira.
   */
  async messages(
    actor: AuthenticatedUser,
    studentId: string,
    before?: Date,
    limit?: number,
    after?: Date,
  ) {
    const pageSize = Math.min(Math.max(limit ?? MESSAGES_PAGE_DEFAULT, 1), MESSAGES_PAGE_MAX);
    const loaded = await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      const [student] = await tx
        .select({
          id: users.id,
          name: users.name,
          whatsappName: users.whatsappName,
          phoneNumber: users.phoneNumber,
        })
        .from(users)
        .where(and(eq(users.id, studentId), eq(users.role, 'USER')))
        .limit(1);
      if (!student) throw new NotFoundException('Aluno não encontrado.');
      const rows = await tx
        .select({
          id: conversations.id,
          direction: conversations.direction,
          messageType: conversations.messageType,
          content: conversations.content,
          createdAt: conversations.createdAt,
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.userId, studentId),
            before ? lt(conversations.createdAt, before) : undefined,
            after ? gte(conversations.createdAt, after) : undefined,
          ),
        )
        .orderBy(
          ...(after
            ? [asc(conversations.createdAt), asc(conversations.id)]
            : [desc(conversations.createdAt), desc(conversations.id)]),
        )
        .limit(pageSize + 1);
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: studentId,
        action: 'HEALTH_DATA_VIEWED',
        entityType: 'student_conversation',
        entityId: studentId,
        changes: {
          purpose: 'conversation_review',
          role: actor.role,
          page: after ? 'newer' : before ? 'older' : 'latest',
        },
      });
      return { student, rows };
    });

    const hasMore = loaded.rows.length > pageSize;
    // `after` já vem em ordem cronológica; as demais chegam da mais nova para a mais antiga.
    const slice = loaded.rows.slice(0, pageSize);
    const page = after ? slice : slice.reverse();
    // Decifra fora da transação (o `HealthCipherService` usa o cliente do core). Uma
    // mensagem ilegível não derruba a conversa inteira.
    const messages = await Promise.all(
      page.map(async (row) => ({
        id: row.id,
        direction: row.direction,
        messageType: row.messageType,
        content: await this.cipher.decryptText(row.content).catch(() => '[mensagem indisponível]'),
        createdAt: row.createdAt.toISOString(),
      })),
    );
    return this.envelope({
      student: {
        id: loaded.student.id,
        name: loaded.student.name ?? loaded.student.whatsappName ?? null,
        phoneNumber: loaded.student.phoneNumber,
      },
      messages,
      olderCursor: !after && hasMore && page[0] ? page[0].createdAt.toISOString() : null,
    });
  }

  /**
   * Pausa (`paused: true`) ou reativa o atendimento automático do AI Coach de um aluno.
   * Idempotente. Pausado, a mensagem do aluno só é registrada e o profissional responde.
   */
  async setAiAttendance(actor: AuthenticatedUser, studentId: string, input: unknown) {
    const { paused } = this.parse(controlCenterConversationAiAttendanceInputSchema, input);
    await this.requireStudent(actor, studentId);
    const changed = await this.coachAttendance.setPaused(studentId, paused);
    // Avisa as outras telas abertas (e outros profissionais) para refletirem o estado novo.
    if (changed) this.conversationEvents.emitAttendance(studentId, paused);
    await this.db.runAsUser(actor.userId, actor.role, (tx) =>
      this.audit.append(tx, {
        actorId: actor.userId,
        userId: studentId,
        action: paused ? 'COACH_ATTENDANCE_PAUSED' : 'COACH_ATTENDANCE_RESUMED',
        entityType: 'student_conversation',
        entityId: studentId,
        changes: { purpose: 'manual_attendance', role: actor.role, changed },
      }),
    );
    return this.envelope({ studentId, aiPaused: paused });
  }

  /**
   * Envia ao WhatsApp do aluno uma mensagem escrita à mão. Só com o atendimento automático
   * pausado (impede a IA e o profissional de responderem ao mesmo tempo) e com o
   * consentimento de saúde vigente. A linha entra no histórico já, para o painel não esperar
   * a entrega; o conteúdo vai cifrado e a auditoria guarda só o tamanho, nunca o texto.
   */
  async sendMessage(actor: AuthenticatedUser, studentId: string, input: unknown) {
    const { text } = this.parse(controlCenterConversationSendInputSchema, input);
    await this.requireStudent(actor, studentId);
    if (!(await this.coachAttendance.isPaused(studentId))) {
      throw new ConflictException(
        'Pause o atendimento automático do AI Coach antes de escrever para o aluno.',
      );
    }
    if (!(await this.healthConsent.hasActiveForUser(studentId))) {
      throw new ConflictException(
        'O aluno não tem consentimento de dados de saúde vigente — não é possível enviar mensagem.',
      );
    }

    const content = await this.cipher.encryptText(text);
    const [row] = await this.db.runAsUser(studentId, 'USER', (tx) =>
      tx
        .insert(conversations)
        .values({ userId: studentId, direction: 'OUTBOUND', content })
        .returning({ id: conversations.id, createdAt: conversations.createdAt }),
    );
    if (!row) throw new ConflictException('Não foi possível registrar a mensagem.');

    const job: WhatsappOutboundJob = {
      userId: studentId,
      type: 'MANUAL_MESSAGE',
      text,
      dedupeId: row.id,
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'manual-message', job, {
      jobId: `manual-message_${row.id}`,
    });
    await this.db.runAsUser(actor.userId, actor.role, (tx) =>
      this.audit.append(tx, {
        actorId: actor.userId,
        userId: studentId,
        action: 'CONVERSATION_MESSAGE_SENT',
        entityType: 'student_conversation',
        entityId: row.id,
        changes: { purpose: 'manual_attendance', role: actor.role, length: text.length },
      }),
    );
    this.conversationEvents.emitMessage(studentId, 'OUTBOUND', row.id);
    return this.envelope({
      message: {
        id: row.id,
        direction: 'OUTBOUND' as const,
        messageType: 'TEXT' as const,
        content: text,
        createdAt: row.createdAt.toISOString(),
      },
    });
  }

  /**
   * Marca a conversa como lida até `upTo` (a última mensagem que o profissional viu; sem ele,
   * agora). O ponteiro é único e só avança. Devolve a contagem DEPOIS de marcar — maior que
   * zero se chegou mensagem nova entre a leitura e a marca. Não é auditado: não expõe dado,
   * só move um ponteiro de leitura.
   */
  async markRead(actor: AuthenticatedUser, studentId: string, input: unknown) {
    const { upTo } = this.parse(controlCenterConversationReadInputSchema, input);
    await this.requireStudent(actor, studentId);
    const now = new Date();
    const readUpTo = upTo && new Date(upTo) < now ? upTo : now.toISOString();
    await this.db.runAsSystem((tx) =>
      tx
        .update(users)
        .set({
          conversationReadAt: sql`GREATEST(COALESCE(${users.conversationReadAt}, '-infinity'::timestamptz), ${readUpTo}::timestamptz)`,
        })
        .where(and(eq(users.id, studentId), eq(users.role, 'USER'))),
    );
    const [row] = await this.db.runAsUser(actor.userId, actor.role, (tx) =>
      tx
        .select({ unread: sql<number>`count(*)::int` })
        .from(conversations)
        .innerJoin(users, eq(users.id, conversations.userId))
        .where(
          and(
            eq(conversations.userId, studentId),
            eq(conversations.direction, 'INBOUND'),
            ne(conversations.messageType, 'SYSTEM'),
            or(
              isNull(users.conversationReadAt),
              gt(conversations.createdAt, users.conversationReadAt),
            ),
          ),
        ),
    );
    const unreadCount = row?.unread ?? 0;
    // Zera o selo nas outras telas abertas (o ponteiro é compartilhado).
    this.conversationEvents.emitRead(studentId, unreadCount);
    return this.envelope({ studentId, unreadCount });
  }

  /** 404 quando o aluno não existe ou está fora do escopo (RLS) do ator. */
  private async requireStudent(actor: AuthenticatedUser, studentId: string): Promise<void> {
    const [student] = await this.db.runAsUser(actor.userId, actor.role, (tx) =>
      tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, studentId), eq(users.role, 'USER'), isNull(users.anonymizedAt)))
        .limit(1),
    );
    if (!student) throw new NotFoundException('Aluno não encontrado.');
  }

  private parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = strictSafeParse(schema, input);
    if (!result.success) {
      throw new BadRequestException(result.error.issues[0]?.message ?? 'Corpo inválido.');
    }
    return result.data;
  }

  /** Foto de perfil do WhatsApp do aluno, ou `null`. Cacheada: a lista pede uma por linha. */
  async photoUrl(actor: AuthenticatedUser, studentId: string): Promise<{ url: string | null }> {
    const phone = await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      const [row] = await tx
        .select({ phoneNumber: users.phoneNumber })
        .from(users)
        .where(and(eq(users.id, studentId), eq(users.role, 'USER')))
        .limit(1);
      return row?.phoneNumber ?? null;
    });
    if (!phone) throw new NotFoundException('Aluno não encontrado.');

    const key = this.redisKeys.forUser(studentId, 'wa-photo');
    const cached = await this.redis.get(key).catch(() => null);
    if (cached !== null) return { url: cached === NO_PHOTO ? null : cached };

    const fetched = (await this.evolution.fetchProfilePictureUrl?.(phone)) ?? null;
    const url = fetched && isWhatsappPhotoUrl(fetched) ? fetched : null;
    await this.redis
      .set(key, url ?? NO_PHOTO, 'EX', url ? PHOTO_TTL_SECONDS : NO_PHOTO_TTL_SECONDS)
      .catch(() => undefined);
    return { url };
  }

  private envelope<T>(data: T) {
    return {
      data,
      meta: { generatedAt: new Date().toISOString(), timezone: TIMEZONE, dataQuality: [] },
    };
  }
}
