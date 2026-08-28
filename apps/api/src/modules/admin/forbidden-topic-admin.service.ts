import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  createForbiddenTopicSchema,
  forbiddenTopicActionSchema,
  forbiddenTopicCandidateSchema,
  MAX_ACTIVE_FORBIDDEN_TOPICS,
  MAX_FORBIDDEN_TOPIC_PHRASES_TOTAL,
  type ForbiddenTopicCandidate,
  type ForbiddenTopicsResponse,
} from '@movivo/shared';
import { desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

import { ForbiddenTopicsService } from '../../core/agent-config/forbidden-topics.service';
import { aiForbiddenTopics, users } from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { AuditService } from './audit.service';
import { simulateForbiddenTopicConfig } from './config-simulator';

const TIMEZONE = 'America/Sao_Paulo' as const;

type TopicStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'RETIRED';

@Injectable()
export class ForbiddenTopicAdminService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly runtime: ForbiddenTopicsService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<ForbiddenTopicsResponse> {
    const rows = await this.db.runAsSystem((tx) => {
      const maker = alias(users, 'forbidden_topic_maker');
      const checker = alias(users, 'forbidden_topic_checker');
      return tx
        .select({
          id: aiForbiddenTopics.id,
          topicKey: aiForbiddenTopics.topicKey,
          label: aiForbiddenTopics.label,
          phrases: aiForbiddenTopics.phrases,
          action: aiForbiddenTopics.action,
          version: aiForbiddenTopics.version,
          status: aiForbiddenTopics.status,
          changeNote: aiForbiddenTopics.changeNote,
          createdBy: maker.name,
          approvedBy: checker.name,
          createdAt: aiForbiddenTopics.createdAt,
        })
        .from(aiForbiddenTopics)
        .leftJoin(maker, eq(maker.id, aiForbiddenTopics.createdBy))
        .leftJoin(checker, eq(checker.id, aiForbiddenTopics.approvedBy))
        .orderBy(desc(aiForbiddenTopics.version), desc(aiForbiddenTopics.createdAt));
    });

    const currentKeys = new Set<string>();
    const versions = rows.map((row) => {
      const current = !currentKeys.has(row.topicKey);
      currentKeys.add(row.topicKey);
      return { ...row, createdAt: row.createdAt.toISOString(), current };
    });
    return this.envelope({
      versions,
      activeLabels: versions
        .filter((version) => version.current && version.status === 'APPROVED')
        .map((version) => version.label),
      limits: {
        maxActiveTopics: MAX_ACTIVE_FORBIDDEN_TOPICS,
        maxPhrasesPerTopic: 20,
        maxPhrasesTotal: MAX_FORBIDDEN_TOPIC_PHRASES_TOTAL,
      },
    });
  }

  async propose(actor: AuthenticatedUser, body: unknown): Promise<ForbiddenTopicsResponse> {
    const input = this.parse(createForbiddenTopicSchema, body);
    const simulation = simulateForbiddenTopicConfig(input);
    if (!simulation.passed) this.rejectSimulation(simulation.checks);

    await this.db.runAsSystem(async (tx) => {
      await this.lock(tx, input.topicKey);
      const current = await this.current(tx, input.topicKey);
      if (current && current.status !== 'RETIRED') {
        throw new ConflictException('Já existe uma proposta ativa para esta chave.');
      }
      await this.insert(tx, actor, input.topicKey, input, input.changeNote, 'DRAFT', null, {
        action: 'forbidden_topic.propose',
      });
    });
    await this.runtime.propagate();
    return this.list();
  }

  async submit(actor: AuthenticatedUser, body: unknown): Promise<ForbiddenTopicsResponse> {
    const input = this.parse(forbiddenTopicActionSchema, body);
    await this.transition(actor, input.topicKey, input.note, 'DRAFT', 'PENDING_APPROVAL', null, {
      action: 'forbidden_topic.submit',
    });
    return this.list();
  }

  async approve(actor: AuthenticatedUser, body: unknown): Promise<ForbiddenTopicsResponse> {
    const input = this.parse(forbiddenTopicActionSchema, body);
    await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      await this.lock(tx, input.topicKey);
      await this.assertRegulatedActionActor(tx, actor);
      const current = await this.requireCurrent(tx, input.topicKey, 'PENDING_APPROVAL');
      if (actor.role !== 'ADMIN' && current.createdBy === actor.userId) {
        throw new ConflictException('Maker-checker: o autor não pode aprovar o próprio tema.');
      }
      await this.assertCapacity(tx, input.topicKey, current.phrases.length);
      await this.insert(tx, actor, input.topicKey, current, input.note, 'APPROVED', actor.userId, {
        action: 'forbidden_topic.approve',
        makerId: current.createdBy,
      });
    });
    await this.runtime.propagate();
    return this.list();
  }

  async retire(actor: AuthenticatedUser, body: unknown): Promise<ForbiddenTopicsResponse> {
    const input = this.parse(forbiddenTopicActionSchema, body);
    await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      await this.lock(tx, input.topicKey);
      await this.assertRegulatedActionActor(tx, actor);
      const current = await this.requireCurrent(tx, input.topicKey, 'APPROVED');
      if (actor.role !== 'ADMIN' && current.createdBy === actor.userId) {
        throw new ConflictException('Maker-checker: o autor não pode retirar o próprio tema.');
      }
      await this.insert(tx, actor, input.topicKey, current, input.note, 'RETIRED', actor.userId, {
        action: 'forbidden_topic.retire',
        makerId: current.createdBy,
      });
    });
    await this.runtime.propagate();
    return this.list();
  }

  private async transition(
    actor: AuthenticatedUser,
    topicKey: string,
    note: string,
    expected: TopicStatus,
    target: TopicStatus,
    approvedBy: string | null,
    audit: { action: string },
  ): Promise<void> {
    await this.db.runAsSystem(async (tx) => {
      await this.lock(tx, topicKey);
      const current = await this.requireCurrent(tx, topicKey, expected);
      await this.insert(tx, actor, topicKey, current, note, target, approvedBy, {
        ...audit,
        makerId: current.createdBy,
      });
    });
    await this.runtime.propagate();
  }

  private async insert(
    tx: TenantTransaction,
    actor: AuthenticatedUser,
    topicKey: string,
    candidate: ForbiddenTopicCandidate,
    changeNote: string,
    status: TopicStatus,
    approvedBy: string | null,
    audit: { action: string; makerId?: string },
  ): Promise<void> {
    const parsed = forbiddenTopicCandidateSchema.parse(candidate);
    const version = await this.nextVersion(tx, topicKey);
    const makerId = audit.makerId ?? actor.userId;
    const [inserted] = await tx
      .insert(aiForbiddenTopics)
      .values({
        ...parsed,
        topicKey,
        version,
        status,
        changeNote,
        createdBy: makerId,
        approvedBy,
      })
      .returning({ id: aiForbiddenTopics.id });
    if (!inserted) throw new BadRequestException('Não foi possível gravar o tema proibido.');
    await this.audit.append(tx, {
      actorId: actor.userId,
      userId: actor.userId,
      action: audit.action,
      entityType: 'ai_forbidden_topic',
      entityId: inserted.id,
      changes: { topicKey, version, status, changeNote, configuredAction: 'BLOCK' },
    });
  }

  private async current(tx: TenantTransaction, topicKey: string) {
    const [row] = await tx
      .select({
        topicKey: aiForbiddenTopics.topicKey,
        label: aiForbiddenTopics.label,
        phrases: aiForbiddenTopics.phrases,
        status: aiForbiddenTopics.status,
        createdBy: aiForbiddenTopics.createdBy,
      })
      .from(aiForbiddenTopics)
      .where(eq(aiForbiddenTopics.topicKey, topicKey))
      .orderBy(desc(aiForbiddenTopics.version))
      .limit(1);
    return row ?? null;
  }

  private async requireCurrent(tx: TenantTransaction, topicKey: string, expected: TopicStatus) {
    const current = await this.current(tx, topicKey);
    if (!current) throw new NotFoundException('Tema proibido inexistente.');
    if (current.status !== expected) {
      throw new ConflictException(`A ação exige tema no estado ${expected}.`);
    }
    return current;
  }

  private async nextVersion(tx: TenantTransaction, topicKey: string): Promise<number> {
    const [row] = await tx
      .select({ max: sql<number>`coalesce(max(${aiForbiddenTopics.version}), 0)::int` })
      .from(aiForbiddenTopics)
      .where(eq(aiForbiddenTopics.topicKey, topicKey));
    return Number(row?.max ?? 0) + 1;
  }

  private lock(tx: TenantTransaction, topicKey: string) {
    return tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`forbidden-topic:${topicKey}`}, 0))`,
    );
  }

  private async assertRegulatedActionActor(
    tx: TenantTransaction,
    actor: AuthenticatedUser,
  ): Promise<void> {
    if (actor.role === 'ADMIN') return;
    const rows = (await tx.execute(sql`
      SELECT id FROM users
      WHERE id = ${actor.userId}::uuid AND role = 'PROFESSIONAL' AND cref_active = true
      LIMIT 1
    `)) as unknown as Array<{ id: string }>;
    if (!rows.length) throw new ConflictException('A ação exige Responsável Técnico CREF ativo.');
  }

  private async assertCapacity(
    tx: TenantTransaction,
    topicKey: string,
    candidatePhraseCount: number,
  ): Promise<void> {
    const rows = (await tx.execute(sql`
      WITH current_topics AS (
        SELECT DISTINCT ON (topic_key) topic_key, status, phrases
        FROM ai_forbidden_topics
        ORDER BY topic_key, version DESC
      )
      SELECT count(*)::int AS active_count,
        COALESCE(sum(jsonb_array_length(phrases)), 0)::int AS phrase_count
      FROM current_topics
      WHERE status = 'APPROVED' AND topic_key <> ${topicKey}
    `)) as unknown as Array<{ active_count: number; phrase_count: number }>;
    const usage = rows[0] ?? { active_count: 0, phrase_count: 0 };
    if (Number(usage.active_count) + 1 > MAX_ACTIVE_FORBIDDEN_TOPICS) {
      throw new ConflictException('Limite de temas proibidos ativos atingido.');
    }
    if (Number(usage.phrase_count) + candidatePhraseCount > MAX_FORBIDDEN_TOPIC_PHRASES_TOTAL) {
      throw new ConflictException('Limite total de termos proibidos ativos atingido.');
    }
  }

  private rejectSimulation(checks: Array<{ passed: boolean; failures: string[] }>): never {
    throw new BadRequestException({
      code: 'CONFIG_SIMULATION_FAILED',
      message: 'O tema proibido não passou no simulador e não pode ser proposto.',
      checks,
    });
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
