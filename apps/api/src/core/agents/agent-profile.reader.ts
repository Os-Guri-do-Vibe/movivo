import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import {
  AGENT_PROFILE_STARTERS,
  agentOfTask,
  type AgentProfileKey,
  type PersonaKey,
} from '@movivo/shared';

import { agentProfiles } from '../database/schema';
import { TenantDatabase } from '../database/tenant-database.service';

/** API e workers rodam em processos separados: os outros enxergam a publicação em até 60 s. */
const CACHE_TTL_MS = 60_000;

export interface AgentProfileText {
  agent: AgentProfileKey;
  version: number;
  content: string;
}

/** Ficha PUBLICADA de cada agente, para o prompt das tarefas dele. */
@Injectable()
export class PublishedAgentProfiles {
  private cache: { at: number; byAgent: Map<string, AgentProfileText> } | null = null;

  constructor(private readonly db: TenantDatabase) {}

  async forTask(taskId: string): Promise<AgentProfileText | null> {
    const agent = agentOfTask(taskId);
    return agent ? ((await this.published()).get(agent) ?? null) : null;
  }

  /**
   * Persona publicada; enquanto só uma das duas existir, ela atende todos. Sem nenhuma publicada,
   * vale o texto inicial do código (versão 0): o aluno nunca fica sem nome nem sem a regra de
   * transparência.
   */
  async persona(key: PersonaKey): Promise<AgentProfileText> {
    const published = await this.published();
    const other: PersonaKey = key === 'PERSONA_FEMALE' ? 'PERSONA_MALE' : 'PERSONA_FEMALE';
    return (
      published.get(key) ??
      published.get(other) ?? { agent: key, version: 0, content: AGENT_PROFILE_STARTERS[key] }
    );
  }

  invalidate(): void {
    this.cache = null;
  }

  private async published(): Promise<Map<string, AgentProfileText>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.byAgent;
    const rows = await this.db.runAsSystem((tx) =>
      tx
        .select({
          agent: agentProfiles.agent,
          version: agentProfiles.version,
          content: agentProfiles.content,
        })
        .from(agentProfiles)
        .where(eq(agentProfiles.status, 'PUBLISHED')),
    );
    this.cache = {
      at: Date.now(),
      byAgent: new Map(rows.map((row) => [row.agent, row as AgentProfileText])),
    };
    return this.cache.byAgent;
  }
}

/** Versão do prompt que vai para `model_runs`/`eval_runs`: o código da tarefa + as fichas usadas. */
export function promptVersionWith(
  taskPromptVersion: string,
  profile: AgentProfileText | null,
  persona: AgentProfileText | null = null,
) {
  return [
    taskPromptVersion,
    ...[profile, persona].flatMap((p) => (p ? [`${p.agent}.v${p.version}`] : [])),
  ].join('.');
}
