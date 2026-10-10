import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import { conversations, users } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
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
 * Aba "Conversas" do Control Center: espelho somente-leitura do histórico de WhatsApp
 * (`conversations`). O corpo da mensagem é dado de saúde (LGPD Art. 11), então o corte é
 * no servidor — o controller exige `STUDENTS_READ` + `STUDENTS_HEALTH_READ`, a leitura roda
 * sob a RLS do ator (profissional só enxerga titular com consentimento de saúde ativo) e
 * cada abertura fica na trilha de auditoria.
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
  ) {}

  /** Alunos com ao menos uma mensagem, da conversa mais recente para a mais antiga. */
  async list(actor: AuthenticatedUser) {
    const lastMessageAt = sql<Date | string>`max(${conversations.createdAt})`;
    const rows = await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      const found = await tx
        .select({
          studentId: users.id,
          name: users.name,
          whatsappName: users.whatsappName,
          phoneNumber: users.phoneNumber,
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
      conversations: rows.map(({ whatsappName, lastMessageAt: last, name, ...row }) => ({
        ...row,
        name: name ?? whatsappName ?? null,
        lastMessageAt: new Date(last).toISOString(),
      })),
    });
  }

  /**
   * Uma página do histórico, em ordem cronológica. `before` (ISO) pagina para trás a partir
   * da mensagem mais antiga já carregada.
   */
  async messages(actor: AuthenticatedUser, studentId: string, before?: Date, limit?: number) {
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
          ),
        )
        .orderBy(desc(conversations.createdAt), desc(conversations.id))
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
          page: before ? 'older' : 'latest',
        },
      });
      return { student, rows };
    });

    const hasMore = loaded.rows.length > pageSize;
    const page = loaded.rows.slice(0, pageSize).reverse();
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
      olderCursor: hasMore && page[0] ? page[0].createdAt.toISOString() : null,
    });
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
