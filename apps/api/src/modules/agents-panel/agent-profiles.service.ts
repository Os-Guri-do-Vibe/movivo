/**
 * Fichas dos agentes: rascunho → teste → publicação, por agente, no mesmo molde do estúdio de
 * metodologia. Publicar exige que todas as tarefas do agente passem nos casos de avaliação com o
 * rascunho no prompt. Só ADMIN chega aqui (capability exclusiva).
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import {
  AGENT_PROFILE_STARTERS,
  AGENT_PROFILE_TASKS,
  agentProfileKeySchema,
  type AgentProfileKey,
  type AgentProfileUpdate,
} from '@movivo/shared';

import { PublishedAgentProfiles } from '../../core/agents/agent-profile.reader';
import { AgentTaskRegistry } from '../../core/agents/agent-task-registry';
import { agentProfiles } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { AuditService } from '../admin/audit.service';
import { EvaluationService, type EvalRunSummary } from '../evaluation/evaluation.service';
import { languageViolations } from '../planning/tasks/common';

type AgentProfileRow = typeof agentProfiles.$inferSelect;

const OPEN_STATUSES: readonly string[] = ['DRAFT', 'TESTING'];

export function parseAgent(value: string): AgentProfileKey {
  const parsed = agentProfileKeySchema.safeParse(value);
  if (!parsed.success) throw new NotFoundException('Agente desconhecido.');
  return parsed.data;
}

@Injectable()
export class AgentProfilesService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly registry: AgentTaskRegistry,
    private readonly evaluation: EvaluationService,
    private readonly published: PublishedAgentProfiles,
    private readonly audit: AuditService,
  ) {}

  async overview() {
    const rows = await this.db.runAsSystem((tx) =>
      tx.select().from(agentProfiles).orderBy(desc(agentProfiles.version)),
    );
    return agentProfileKeySchema.options.map((agent) => {
      const own = rows.filter((r) => r.agent === agent);
      return {
        agent,
        tasks: [...AGENT_PROFILE_TASKS[agent]],
        published: view(own.find((r) => r.status === 'PUBLISHED')),
        openDraft: view(own.find((r) => OPEN_STATUSES.includes(r.status))),
      };
    });
  }

  async get(id: string): Promise<AgentProfileRow> {
    const [row] = await this.db.runAsSystem((tx) =>
      tx.select().from(agentProfiles).where(eq(agentProfiles.id, id)),
    );
    if (!row) throw new NotFoundException('Versão da ficha não encontrada.');
    return row;
  }

  /** Abre (ou devolve) o rascunho do agente, a partir da ficha publicada ou do ponto de partida. */
  async openDraft(agent: AgentProfileKey, staffId: string) {
    return this.db.runAsSystem(async (tx) => {
      const rows = await tx
        .select()
        .from(agentProfiles)
        .where(eq(agentProfiles.agent, agent))
        .orderBy(desc(agentProfiles.version));
      const open = rows.find((r) => OPEN_STATUSES.includes(r.status));
      if (open) return open;
      const [created] = await tx
        .insert(agentProfiles)
        .values({
          agent,
          version: (rows[0]?.version ?? 0) + 1,
          content:
            rows.find((r) => r.status === 'PUBLISHED')?.content ?? AGENT_PROFILE_STARTERS[agent],
          changeNote: 'Rascunho',
          createdBy: staffId,
        })
        .returning();
      if (!created) throw new Error('falha ao abrir o rascunho da ficha');
      return created;
    });
  }

  async updateDraft(id: string, update: AgentProfileUpdate) {
    const row = await this.get(id);
    if (!OPEN_STATUSES.includes(row.status)) {
      throw new ConflictException('Só um rascunho aberto pode ser editado.');
    }
    const issues = languageViolations(update.content, 'content');
    if (issues.length > 0) {
      throw new BadRequestException({
        code: 'PROFILE_LANGUAGE',
        message: 'A ficha usa linguagem fora dos guardrails da MOVIVO.',
        issues: issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }
    const [saved] = await this.db.runAsSystem((tx) =>
      tx
        .update(agentProfiles)
        // Qualquer edição invalida um teste anterior.
        .set({
          content: update.content,
          changeNote: update.changeNote,
          status: 'DRAFT',
          evalRunIds: [],
        })
        .where(eq(agentProfiles.id, id))
        .returning(),
    );
    if (!saved) throw new NotFoundException('Versão da ficha não encontrada.');
    return saved;
  }

  async discardDraft(id: string): Promise<void> {
    const row = await this.get(id);
    if (!OPEN_STATUSES.includes(row.status)) {
      throw new ConflictException('Só um rascunho aberto pode ser descartado.');
    }
    await this.db.runAsSystem((tx) =>
      tx.update(agentProfiles).set({ status: 'DISCARDED' }).where(eq(agentProfiles.id, id)),
    );
  }

  /** Roda os casos de avaliação de todas as tarefas do agente com o rascunho no prompt. */
  async test(id: string, staffId: string) {
    const row = await this.get(id);
    if (!OPEN_STATUSES.includes(row.status)) {
      throw new ConflictException('Só um rascunho aberto pode ser testado.');
    }
    const agent = parseAgent(row.agent);
    // Tarefa sem casos de avaliação não tem o que provar (e a avaliação recusaria rodar).
    const evaluable = new Set(
      this.registry
        .list()
        .filter((t) => t.cases > 0)
        .map((t) => t.id),
    );
    const profileOverride = { agent, version: row.version, content: row.content };
    const evaluations: EvalRunSummary[] = [];
    for (const taskId of AGENT_PROFILE_TASKS[agent].filter((t) => evaluable.has(t))) {
      evaluations.push(
        await this.evaluation.evaluate(taskId, { profileOverride, requestedBy: staffId }),
      );
    }
    const passed = evaluations.length > 0 && evaluations.every((e) => e.passed);
    await this.db.runAsSystem((tx) =>
      tx
        .update(agentProfiles)
        .set({
          status: passed ? 'TESTING' : 'DRAFT',
          evalRunIds: evaluations.map((e) => e.evalRunId),
        })
        .where(eq(agentProfiles.id, id)),
    );
    return {
      passed,
      evaluations: evaluations.map((e) => ({
        taskId: e.taskId,
        passed: e.passed,
        casesPassed: e.casesPassed,
        casesTotal: e.casesTotal,
        costBrl: e.costBrl,
      })),
    };
  }

  /** Publica a versão aprovada nos testes, substituindo a anterior. */
  async publish(id: string, staffId: string) {
    const saved = await this.db.runAsSystem(async (tx) => {
      const [row] = await tx
        .select()
        .from(agentProfiles)
        .where(eq(agentProfiles.id, id))
        .for('update');
      if (!row) throw new NotFoundException('Versão da ficha não encontrada.');
      if (row.status !== 'TESTING') {
        throw new ConflictException('A ficha precisa passar nos testes antes de ser publicada.');
      }
      await tx
        .update(agentProfiles)
        .set({ status: 'SUPERSEDED' })
        .where(and(eq(agentProfiles.agent, row.agent), eq(agentProfiles.status, 'PUBLISHED')));
      const [published] = await tx
        .update(agentProfiles)
        .set({ status: 'PUBLISHED', publishedBy: staffId, publishedAt: new Date() })
        .where(eq(agentProfiles.id, id))
        .returning();
      if (!published) throw new Error('falha ao publicar a ficha');
      await this.audit.append(tx, {
        actorId: staffId,
        userId: staffId,
        action: 'agent_profile.publish',
        entityType: 'agent_profile',
        entityId: id,
        changes: { agent: row.agent, version: row.version, evalRunIds: row.evalRunIds },
      });
      return published;
    });
    this.published.invalidate();
    return saved;
  }
}

export function view(row: AgentProfileRow | undefined) {
  return row
    ? {
        id: row.id,
        agent: parseAgent(row.agent),
        version: row.version,
        status: row.status as 'DRAFT' | 'TESTING' | 'PUBLISHED' | 'SUPERSEDED' | 'DISCARDED',
        content: row.content,
        changeNote: row.changeNote,
        evalRunIds: row.evalRunIds,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      }
    : null;
}
