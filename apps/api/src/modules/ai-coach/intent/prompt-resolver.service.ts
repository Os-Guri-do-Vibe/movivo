/**
 * `PromptResolverService` (US-7.6 / TASK-7.6.3) — monta o system prompt final por
 * intenção a partir da persona vigente.
 *
 * A resolução da persona (cache, pub/sub, fail-safe) mora no CORE
 * (`AgentPersonaService`, DI global — §12.5): este serviço é a camada fina específica
 * de `ai-coach` que combina essa persona com os templates de `prompts.ts`
 * (`resolvePrompt`, `buildForaDeEscopoResponse`), que são lógica de domínio e não
 * pertencem ao CORE.
 *
 * O `methodologySummary` entra por parâmetro, e não por injeção: `MethodologyProvider` vive
 * em `ProtocolModule`, que já importa `AiCoachModule` — injetá-lo aqui fecharia um ciclo de
 * módulos (§12.5). Quem tem os dois na mão é o worker do Coach, e é ele quem passa o valor.
 */
import { Injectable } from '@nestjs/common';
import { buildHumanHandoffMessage, type AgentFormatting } from '@movivo/shared';

import { AgentPersonaService } from '../../../core/agent-config/agent-persona.service';
import { ForbiddenTopicsService } from '../../../core/agent-config/forbidden-topics.service';
import { buildForaDeEscopoResponse, resolvePrompt as resolvePromptWith } from './prompts';
import type { Intent } from './intent.types';

@Injectable()
export class PromptResolverService {
  constructor(
    private readonly agentPersona: AgentPersonaService,
    private readonly forbiddenTopics: ForbiddenTopicsService,
  ) {}

  /** System prompt final da intenção, com a persona vigente e os temas proibidos ativos. */
  async resolvePrompt(intent: Intent): Promise<string> {
    return (await this.resolveRuntime(intent)).system;
  }

  /** Prompt e formatação do mesmo snapshot de persona, evitando versões misturadas. */
  async resolveRuntime(intent: Intent): Promise<{
    system: string;
    formatting: AgentFormatting;
  }> {
    const [persona, forbiddenTopicLabels] = await Promise.all([
      this.agentPersona.persona(),
      this.forbiddenTopics.activeLabels(),
    ]);
    return {
      system: resolvePromptWith(intent, persona, { forbiddenTopicLabels }),
      formatting: persona.formatting,
    };
  }

  /** Nome da agente para as superfícies fora do prompt (WhatsApp, copy, transcrição). */
  async agentName(): Promise<string> {
    return this.agentPersona.agentName();
  }

  /** Recusa pré-aprovada de fora-de-escopo, com o nome vigente (TASK-7.6.4). */
  async foraDeEscopoResponse(): Promise<string> {
    return buildForaDeEscopoResponse(await this.agentName());
  }

  /**
   * Mensagem de handoff humano, determinística: campo publicado + sufixo CREF fixo em código.
   * Não passa por LLM — é copy, não prompt.
   */
  async humanHandoffMessage(): Promise<string> {
    return buildHumanHandoffMessage(await this.agentPersona.persona());
  }
}
