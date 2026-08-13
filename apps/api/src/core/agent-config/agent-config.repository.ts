/**
 * Leitura de `agent_config` (US-7.6). Tabela global sem RLS por titular (é configuração de
 * produto, não dado de aluno), lida pela role de runtime que só tem SELECT/INSERT nela.
 *
 * "Vigente" é a **maior `version` com `status = 'PUBLISHED'`** — a tabela é append-only, então
 * não existe linha "ativa" marcada por UPDATE: a versão mais nova publicada é a que vale, e
 * toda anterior está arquivada por definição.
 *
 * Mora no CORE (não em `ai-coach/`) porque é consumida por DI global de qualquer domínio
 * (`whatsapp`, `subscription`, `coach`) que precise do nome/tom da agente — §12.5, sem
 * imports cross-domain.
 */
import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';

import { DRIZZLE } from '../database/database.constants';
import type { DrizzleClient } from '../database/database.module';
import { agentConfig } from '../database/schema';

export interface ActiveAgentConfig {
  version: number;
  payload: unknown;
}

@Injectable()
export class AgentConfigRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleClient) {}

  async activePayload(): Promise<ActiveAgentConfig | null> {
    const [row] = await this.db
      .select({ version: agentConfig.version, payload: agentConfig.payload })
      .from(agentConfig)
      .where(eq(agentConfig.status, 'PUBLISHED'))
      .orderBy(desc(agentConfig.version))
      .limit(1);
    return row ?? null;
  }
}
