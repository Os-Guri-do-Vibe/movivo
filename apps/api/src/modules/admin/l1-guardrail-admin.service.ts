import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  l1GuardrailCandidateSchema,
  publishL1GuardrailSchema,
  retireL1GuardrailSchema,
  rollbackL1GuardrailSchema,
  type L1GuardrailCandidate,
  type L1GuardrailsResponse,
} from '@movivo/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { L1GuardrailService } from '../../core/agent-config/l1-guardrail.service';
import { aiGuardrailRules, users } from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { AuditService } from './audit.service';
import { simulateL1GuardrailConfig } from './config-simulator';

const TIMEZONE = 'America/Sao_Paulo' as const;

@Injectable()
export class L1GuardrailAdminService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly runtime: L1GuardrailService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<L1GuardrailsResponse> {
    const rows = await this.db.runAsSystem((tx) =>
      tx
        .select({
          id: aiGuardrailRules.id,
          ruleKey: aiGuardrailRules.ruleKey,
          label: aiGuardrailRules.label,
          scope: aiGuardrailRules.scope,
          phrases: aiGuardrailRules.phrases,
          action: aiGuardrailRules.action,
          version: aiGuardrailRules.version,
          status: aiGuardrailRules.status,
          changeNote: aiGuardrailRules.changeNote,
          createdAt: aiGuardrailRules.createdAt,
          createdBy: users.name,
        })
        .from(aiGuardrailRules)
        .leftJoin(users, eq(users.id, aiGuardrailRules.createdBy))
        .orderBy(desc(aiGuardrailRules.createdAt), desc(aiGuardrailRules.version)),
    );
    const currentKeys = new Set<string>();
    return this.envelope({
      versions: rows.map((row) => {
        const current = !currentKeys.has(row.ruleKey);
        currentKeys.add(row.ruleKey);
        return { ...row, createdAt: row.createdAt.toISOString(), current };
      }),
    });
  }

  async publish(actor: AuthenticatedUser, body: unknown): Promise<L1GuardrailsResponse> {
    const input = this.parse(publishL1GuardrailSchema, body);
    return this.insertVersion(
      actor,
      input.ruleKey ?? randomUUID(),
      input,
      input.changeNote,
      'PUBLISHED',
      input.ruleKey ? 'ai_guardrail.update' : 'ai_guardrail.publish',
    );
  }

  async rollback(actor: AuthenticatedUser, body: unknown): Promise<L1GuardrailsResponse> {
    const input = this.parse(rollbackL1GuardrailSchema, body);
    const [target] = await this.db.runAsSystem((tx) =>
      tx
        .select({
          label: aiGuardrailRules.label,
          scope: aiGuardrailRules.scope,
          phrases: aiGuardrailRules.phrases,
          action: aiGuardrailRules.action,
        })
        .from(aiGuardrailRules)
        .where(
          and(
            eq(aiGuardrailRules.ruleKey, input.ruleKey),
            eq(aiGuardrailRules.version, input.targetVersion),
          ),
        )
        .limit(1),
    );
    if (!target) throw new NotFoundException('Versão do guardrail inexistente.');
    return this.insertVersion(
      actor,
      input.ruleKey,
      target,
      input.changeNote,
      'PUBLISHED',
      'ai_guardrail.rollback',
    );
  }

  async retire(actor: AuthenticatedUser, body: unknown): Promise<L1GuardrailsResponse> {
    const input = this.parse(retireL1GuardrailSchema, body);
    const [current] = await this.db.runAsSystem((tx) =>
      tx
        .select({
          label: aiGuardrailRules.label,
          scope: aiGuardrailRules.scope,
          phrases: aiGuardrailRules.phrases,
          action: aiGuardrailRules.action,
          status: aiGuardrailRules.status,
        })
        .from(aiGuardrailRules)
        .where(eq(aiGuardrailRules.ruleKey, input.ruleKey))
        .orderBy(desc(aiGuardrailRules.version))
        .limit(1),
    );
    if (!current) throw new NotFoundException('Guardrail inexistente.');
    if (current.status === 'RETIRED') throw new BadRequestException('O guardrail já foi retirado.');
    return this.insertVersion(
      actor,
      input.ruleKey,
      current,
      input.changeNote,
      'RETIRED',
      'ai_guardrail.retire',
    );
  }

  private async insertVersion(
    actor: AuthenticatedUser,
    ruleKey: string,
    candidate: L1GuardrailCandidate,
    changeNote: string,
    status: 'PUBLISHED' | 'RETIRED',
    action: string,
  ): Promise<L1GuardrailsResponse> {
    const parsed = l1GuardrailCandidateSchema.parse(candidate);
    const simulation = simulateL1GuardrailConfig(parsed);
    if (!simulation.passed) {
      throw new BadRequestException({
        code: 'CONFIG_SIMULATION_FAILED',
        message: 'O guardrail L1 não passou no simulador e não pode ser publicado.',
        checks: simulation.checks,
      });
    }

    await this.db.runAsSystem(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-guardrail:${ruleKey}`}, 0))`,
      );
      const version = await this.nextVersion(tx, ruleKey);
      const [inserted] = await tx
        .insert(aiGuardrailRules)
        .values({ ...parsed, ruleKey, version, status, changeNote, createdBy: actor.userId })
        .returning({ id: aiGuardrailRules.id });
      if (!inserted) throw new BadRequestException('Não foi possível publicar o guardrail.');
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action,
        entityType: 'ai_guardrail_rule',
        entityId: inserted.id,
        changes: { ruleKey, version, status, changeNote, configuredAction: 'FLAG' },
      });
    });
    this.runtime.invalidate();
    return this.list();
  }

  private async nextVersion(tx: TenantTransaction, ruleKey: string): Promise<number> {
    const [row] = await tx
      .select({ max: sql<number>`coalesce(max(${aiGuardrailRules.version}), 0)::int` })
      .from(aiGuardrailRules)
      .where(eq(aiGuardrailRules.ruleKey, ruleKey));
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
