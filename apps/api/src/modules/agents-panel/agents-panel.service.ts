/**
 * Painel de agentes: o que cada tarefa é (nível, versão do prompt), como foi o último teste,
 * qual modelo atende cada nível e quanto a IA custa por aluno e por tarefa.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { desc, eq, gte, sql } from 'drizzle-orm';

import type { SaveTierRoutesRequest } from '@movivo/shared';

import { AgentTaskRegistry } from '../../core/agents/agent-task-registry';
import { ModelTierConfig } from '../../core/ai/model-tier-config';
import { MODEL_TIERS, type ModelTier } from '../../core/ai/ai.types';
import { evalRuns, modelRuns, modelTiers, users } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { AuditService } from '../admin/audit.service';

const DAY_MS = 86_400_000;

@Injectable()
export class AgentsPanelService {
  constructor(
    private readonly registry: AgentTaskRegistry,
    private readonly tiers: ModelTierConfig,
    private readonly db: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  /** Tarefas com o resultado da avaliação mais recente e se ela vale para o prompt atual. */
  async tasks() {
    const runs = await this.db.runAsSystem((tx) =>
      tx.select().from(evalRuns).orderBy(desc(evalRuns.finishedAt)).limit(500),
    );
    const latest = new Map<string, (typeof runs)[number]>();
    for (const run of runs) if (!latest.has(run.taskId)) latest.set(run.taskId, run);
    return this.registry.list().map((task) => {
      const run = latest.get(task.id);
      return {
        ...task,
        lastEval: run
          ? {
              passed: run.passed,
              casesPassed: run.casesPassed,
              casesTotal: run.casesTotal,
              finishedAt: run.finishedAt,
              costBrl: run.costBrl,
              // Prompt mudou depois do último teste: o resultado não vale mais.
              current: run.promptVersion === task.promptVersion,
            }
          : null,
      };
    });
  }

  /** Rotas efetivas de cada nível e se vêm do banco (painel) ou do padrão do código. */
  async tierRoutes() {
    const configured = await this.db.runAsSystem((tx) =>
      tx.select({ tier: modelTiers.tier }).from(modelTiers).where(eq(modelTiers.enabled, true)),
    );
    const fromDb = new Set(configured.map((row) => row.tier));
    const out = [];
    for (const tier of MODEL_TIERS) {
      out.push({
        tier,
        source: fromDb.has(tier) ? 'PAINEL' : 'PADRÃO',
        routes: await this.tiers.routesFor(tier),
      });
    }
    return out;
  }

  async saveTier(actorId: string, tier: ModelTier, request: SaveTierRoutesRequest) {
    if (tier === 'VISION' && request.routes.some((r) => !r.vision)) {
      throw new BadRequestException('O nível VISION só aceita rotas com visão.');
    }
    await this.db.runAsSystem(async (tx) => {
      await tx.delete(modelTiers).where(eq(modelTiers.tier, tier));
      await tx.insert(modelTiers).values(
        request.routes.map((route, index) => ({
          tier,
          position: index + 1,
          vendor: route.vendor,
          model: route.model,
          maxOutputTokens: route.maxOutputTokens,
          timeoutMs: route.timeoutMs,
          temperature: route.temperature,
          vision: route.vision,
          updatedBy: actorId,
        })),
      );
      await this.audit.append(tx, {
        actorId,
        userId: actorId,
        action: 'ai.tier.save',
        entityType: 'model_tier',
        entityId: randomUUID(),
        changes: { tier, routes: request.routes.map((r) => `${r.vendor}:${r.model}`) },
      });
    });
    this.tiers.invalidate();
    return this.tierRoutes();
  }

  /** Custo de IA nos últimos `days` dias: por tarefa e por aluno (os 50 que mais custam). */
  async costs(days: number, now: Date = new Date()) {
    const since = new Date(now.getTime() - days * DAY_MS);
    return this.db.runAsSystem(async (tx) => {
      const byTask = await tx
        .select({
          taskId: modelRuns.taskId,
          calls: sql<number>`count(*)`.mapWith(Number),
          failed: sql<number>`count(*) filter (where ${modelRuns.status} <> 'OK')`.mapWith(Number),
          costBrl: sql<number>`coalesce(sum(${modelRuns.costBrl}), 0)`.mapWith(Number),
          avgLatencyMs: sql<number>`coalesce(avg(${modelRuns.latencyMs}), 0)`.mapWith(Number),
        })
        .from(modelRuns)
        .where(gte(modelRuns.createdAt, since))
        .groupBy(modelRuns.taskId)
        .orderBy(desc(sql`sum(${modelRuns.costBrl})`));
      const byStudent = await tx
        .select({
          userId: modelRuns.userId,
          name: users.name,
          calls: sql<number>`count(*)`.mapWith(Number),
          costBrl: sql<number>`coalesce(sum(${modelRuns.costBrl}), 0)`.mapWith(Number),
        })
        .from(modelRuns)
        .innerJoin(users, eq(users.id, modelRuns.userId))
        .where(gte(modelRuns.createdAt, since))
        .groupBy(modelRuns.userId, users.name)
        .orderBy(desc(sql`sum(${modelRuns.costBrl})`))
        .limit(50);
      const [totals] = await tx
        .select({
          costBrl: sql<number>`coalesce(sum(${modelRuns.costBrl}), 0)`.mapWith(Number),
          students: sql<number>`count(distinct ${modelRuns.userId})`.mapWith(Number),
        })
        .from(modelRuns)
        .where(gte(modelRuns.createdAt, since));
      const students = totals?.students ?? 0;
      return {
        days,
        totalBrl: totals?.costBrl ?? 0,
        students,
        avgPerStudentBrl: students > 0 ? (totals?.costBrl ?? 0) / students : 0,
        byTask,
        byStudent,
      };
    });
  }
}
