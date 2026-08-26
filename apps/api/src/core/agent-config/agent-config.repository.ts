/**
 * Leitura de `agent_config` (US-7.6). Tabela global sem RLS por titular (é configuração de
 * produto, não dado de aluno), lida pela role de runtime que só tem SELECT/INSERT nela.
 *
 * "Vigente" é a **maior `version` com `status = 'PUBLISHED'` dentro do slot** (`target_sex`)
 * — a tabela é append-only, então não existe linha "ativa" marcada por UPDATE: a versão mais
 * nova publicada daquele público é a que vale, e toda anterior do mesmo público está
 * arquivada por definição.
 *
 * ## Dois slots (Sprint 11)
 * Desde que a persona passou a ter uma versão por sexo do titular, `version` **não é único
 * globalmente**: existe `version = 1` no slot masculino e no feminino ao mesmo tempo. Toda
 * consulta desta classe filtra por `target_sex` — uma leitura sem esse filtro devolveria a
 * persona do público errado, silenciosamente.
 *
 * Mora no CORE (não em `ai-coach/`) porque é consumida por DI global de qualquer domínio
 * (`whatsapp`, `subscription`, `coach`) que precise do nome/tom da agente — §12.5, sem
 * imports cross-domain.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { BiologicalSex } from '@movivo/shared';

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

  /** Persona publicada vigente **daquele slot**. `null` = slot ainda sem publicação. */
  async activePayload(targetSex: BiologicalSex): Promise<ActiveAgentConfig | null> {
    const [row] = await this.db
      .select({ version: agentConfig.version, payload: agentConfig.payload })
      .from(agentConfig)
      .where(and(eq(agentConfig.status, 'PUBLISHED'), eq(agentConfig.targetSex, targetSex)))
      .orderBy(desc(agentConfig.version))
      .limit(1);
    return row ?? null;
  }
}
