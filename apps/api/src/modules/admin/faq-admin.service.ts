import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  faqCandidateSchema,
  publishFaqEntrySchema,
  retireFaqEntrySchema,
  rollbackFaqEntrySchema,
  type FaqCandidate,
  type FaqEntriesResponse,
} from '@movivo/shared';
import { desc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { FaqService, normalizeFaqQuestion } from '../../core/agent-config/faq.service';
import { faqEntries, users } from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { AuditService } from './audit.service';
import { simulateFaqConfig } from './config-simulator';

const TIMEZONE = 'America/Sao_Paulo' as const;

@Injectable()
export class FaqAdminService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly faq: FaqService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<FaqEntriesResponse> {
    const rows = await this.db.runAsSystem((tx) =>
      tx
        .select({
          id: faqEntries.id,
          faqKey: faqEntries.faqKey,
          canonicalQuestion: faqEntries.canonicalQuestion,
          answer: faqEntries.answer,
          version: faqEntries.version,
          status: faqEntries.status,
          changeNote: faqEntries.changeNote,
          createdAt: faqEntries.createdAt,
          createdBy: users.name,
        })
        .from(faqEntries)
        .leftJoin(users, eq(users.id, faqEntries.createdBy))
        .orderBy(desc(faqEntries.createdAt), desc(faqEntries.version)),
    );
    const currentKeys = new Set<string>();
    return this.envelope({
      versions: rows.map((row) => {
        const current = !currentKeys.has(row.faqKey);
        currentKeys.add(row.faqKey);
        return { ...row, createdAt: row.createdAt.toISOString(), current };
      }),
    });
  }

  async publish(actor: AuthenticatedUser, body: unknown): Promise<FaqEntriesResponse> {
    const input = this.parse(publishFaqEntrySchema, body);
    return this.insertVersion(
      actor,
      input.faqKey ?? randomUUID(),
      input,
      input.changeNote,
      'PUBLISHED',
      input.faqKey ? 'faq.update' : 'faq.publish',
    );
  }

  async rollback(actor: AuthenticatedUser, body: unknown): Promise<FaqEntriesResponse> {
    const input = this.parse(rollbackFaqEntrySchema, body);
    const [target] = await this.db.runAsSystem((tx) =>
      tx
        .select({
          canonicalQuestion: faqEntries.canonicalQuestion,
          answer: faqEntries.answer,
        })
        .from(faqEntries)
        .where(
          sql`${faqEntries.faqKey} = ${input.faqKey} AND ${faqEntries.version} = ${input.targetVersion}`,
        )
        .limit(1),
    );
    if (!target) throw new NotFoundException('Versão do FAQ inexistente.');
    return this.insertVersion(
      actor,
      input.faqKey,
      target,
      input.changeNote,
      'PUBLISHED',
      'faq.rollback',
    );
  }

  async retire(actor: AuthenticatedUser, body: unknown): Promise<FaqEntriesResponse> {
    const input = this.parse(retireFaqEntrySchema, body);
    const [current] = await this.db.runAsSystem((tx) =>
      tx
        .select({
          canonicalQuestion: faqEntries.canonicalQuestion,
          answer: faqEntries.answer,
          status: faqEntries.status,
        })
        .from(faqEntries)
        .where(eq(faqEntries.faqKey, input.faqKey))
        .orderBy(desc(faqEntries.version))
        .limit(1),
    );
    if (!current) throw new NotFoundException('FAQ inexistente.');
    if (current.status === 'RETIRED') throw new BadRequestException('O FAQ já está retirado.');
    return this.insertVersion(
      actor,
      input.faqKey,
      current,
      input.changeNote,
      'RETIRED',
      'faq.retire',
    );
  }

  private async insertVersion(
    actor: AuthenticatedUser,
    faqKey: string,
    candidate: FaqCandidate,
    changeNote: string,
    status: 'PUBLISHED' | 'RETIRED',
    action: string,
  ): Promise<FaqEntriesResponse> {
    const parsed = faqCandidateSchema.parse(candidate);
    const simulation = simulateFaqConfig(parsed);
    if (!simulation.passed) {
      throw new BadRequestException({
        code: 'CONFIG_SIMULATION_FAILED',
        message: 'A resposta de FAQ não passou no simulador e não pode ser publicada.',
        checks: simulation.checks,
      });
    }
    const normalizedQuestion = normalizeFaqQuestion(parsed.canonicalQuestion);

    await this.db.runAsSystem(async (tx) => {
      // Serializa publicações concorrentes da mesma entrada e da mesma pergunta normalizada.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`faq:${faqKey}`}, 0))`);
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`faq-question:${normalizedQuestion}`}, 0))`,
      );
      if (status === 'PUBLISHED') {
        const collisions = (await tx.execute(sql`
          SELECT faq_key
          FROM (
            SELECT DISTINCT ON (faq_key) faq_key, normalized_question, status
            FROM faq_entries
            ORDER BY faq_key, version DESC
          ) current_faq
          WHERE status = 'PUBLISHED'
            AND normalized_question = ${normalizedQuestion}
            AND faq_key <> ${faqKey}::uuid
          LIMIT 1
        `)) as unknown as Array<{ faq_key: string }>;
        if (collisions.length > 0) {
          throw new BadRequestException('Já existe um FAQ publicado para esta pergunta canônica.');
        }
      }
      const version = await this.nextVersion(tx, faqKey);
      const [inserted] = await tx
        .insert(faqEntries)
        .values({
          faqKey,
          canonicalQuestion: parsed.canonicalQuestion,
          normalizedQuestion,
          answer: parsed.answer,
          version,
          status,
          changeNote,
          createdBy: actor.userId,
        })
        .returning({ id: faqEntries.id });
      if (!inserted) throw new BadRequestException('Não foi possível publicar o FAQ.');
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action,
        entityType: 'faq_entry',
        entityId: inserted.id,
        changes: { faqKey, version, status, changeNote },
      });
    });
    this.faq.invalidate();
    return this.list();
  }

  private async nextVersion(tx: TenantTransaction, faqKey: string): Promise<number> {
    const [row] = await tx
      .select({ max: sql<number>`coalesce(max(${faqEntries.version}), 0)::int` })
      .from(faqEntries)
      .where(eq(faqEntries.faqKey, faqKey));
    return Number(row?.max ?? 0) + 1;
  }

  private parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) {
      throw new BadRequestException({ code: 'INVALID_INPUT', issues: result.error.issues });
    }
    return result.data;
  }

  private envelope<T>(data: T) {
    return {
      data,
      meta: { generatedAt: new Date().toISOString(), timezone: TIMEZONE, dataQuality: [] },
    };
  }
}
