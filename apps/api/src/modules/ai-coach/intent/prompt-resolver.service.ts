/**
 * `PromptResolverService` (US-7.6 / TASK-7.6.3) — monta o system prompt final por
 * intenção a partir da persona vigente.
 *
 * A resolução da persona (cache, pub/sub, fail-safe, slot por sexo do titular) mora no CORE
 * (`AgentPersonaService`, DI global — §12.5): este serviço é a camada fina específica
 * de `ai-coach` que combina essa persona com os templates de `prompts.ts`
 * (`resolvePrompt`, `buildForaDeEscopoResponse`), que são lógica de domínio e não
 * pertencem ao CORE.
 *
 * ## Persona ENTRA por parâmetro; este serviço não a resolve por conta própria
 * Desde que existem duas personas publicadas (Sprint 11), quem resolve a persona é o
 * chamador — **uma vez por job** — e passa o OBJETO adiante. As variantes `…For(persona)`
 * existem exatamente para isso. Se cada call site resolvesse de novo a partir do
 * `targetSex`, uma publicação ocorrida no meio de um job faria a MESMA resposta usar duas
 * versões diferentes da mesma persona (system prompt de uma, nome na transcrição de outra) —
 * a mistura de versões que `resolveRuntime` já evitava internamente antes de existirem slots.
 *
 * O `methodologySummary` entra por parâmetro, e não por injeção: `MethodologyProvider` vive
 * em `ProtocolModule`, que já importa `AiCoachModule` — injetá-lo aqui fecharia um ciclo de
 * módulos (§12.5). Quem tem os dois na mão é o worker do Coach, e é ele quem passa o valor.
 */
import { Injectable } from '@nestjs/common';
import {
  buildHumanHandoffMessage,
  type AgentFormatting,
  type AgentPersona,
  type BiologicalSex,
} from '@movivo/shared';

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

  /**
   * Persona do titular. **Único ponto de resolução** — chamado uma vez por job; o resultado
   * é propagado como objeto para todas as variantes `…For(persona)` abaixo.
   */
  async persona(targetSex: BiologicalSex | null): Promise<AgentPersona> {
    return this.agentPersona.persona(targetSex);
  }

  /** System prompt final da intenção, com a persona recebida e os temas proibidos ativos. */
  async resolvePromptFor(intent: Intent, persona: AgentPersona): Promise<string> {
    return (await this.resolveRuntimeFor(intent, persona)).system;
  }

  /** Prompt e formatação do MESMO snapshot de persona, evitando versões misturadas. */
  async resolveRuntimeFor(
    intent: Intent,
    persona: AgentPersona,
  ): Promise<{
    system: string;
    formatting: AgentFormatting;
  }> {
    const forbiddenTopicLabels = await this.forbiddenTopics.activeLabels();
    return {
      system: resolvePromptWith(intent, persona, { forbiddenTopicLabels }),
      formatting: persona.formatting,
    };
  }

  /** Recusa pré-aprovada de fora-de-escopo, com o nome vigente (TASK-7.6.4). */
  foraDeEscopoResponseFor(persona: AgentPersona): string {
    return buildForaDeEscopoResponse(persona.agentName);
  }

  /**
   * Mensagem de handoff humano, determinística: campo publicado + sufixo CREF fixo em código.
   * Não passa por LLM — é copy, não prompt.
   */
  humanHandoffMessageFor(persona: AgentPersona): string {
    return buildHumanHandoffMessage(persona);
  }
}
