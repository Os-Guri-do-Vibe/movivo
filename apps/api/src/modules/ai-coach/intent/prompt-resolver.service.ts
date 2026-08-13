/**
 * `PromptResolverService` (US-7.6 / TASK-7.6.3) — monta o system prompt final por
 * intenção a partir da persona vigente.
 *
 * A resolução da persona (cache, pub/sub, fail-safe) mora no CORE
 * (`AgentPersonaService`, DI global — §12.5): este serviço é a camada fina específica
 * de `ai-coach` que combina essa persona com os templates de `prompts.ts`
 * (`resolvePrompt`, `buildForaDeEscopoResponse`), que são lógica de domínio e não
 * pertencem ao CORE.
 */
import { Injectable } from '@nestjs/common';

import { AgentPersonaService } from '../../../core/agent-config/agent-persona.service';
import { buildForaDeEscopoResponse, resolvePrompt as resolvePromptWith } from './prompts';
import type { Intent } from './intent.types';

@Injectable()
export class PromptResolverService {
  constructor(private readonly agentPersona: AgentPersonaService) {}

  /** System prompt final da intenção, com a persona vigente. */
  async resolvePrompt(intent: Intent): Promise<string> {
    return resolvePromptWith(intent, await this.agentPersona.persona());
  }

  /** Nome da agente para as superfícies fora do prompt (WhatsApp, copy, transcrição). */
  async agentName(): Promise<string> {
    return this.agentPersona.agentName();
  }

  /** Recusa pré-aprovada de fora-de-escopo, com o nome vigente (TASK-7.6.4). */
  async foraDeEscopoResponse(): Promise<string> {
    return buildForaDeEscopoResponse(await this.agentName());
  }
}
