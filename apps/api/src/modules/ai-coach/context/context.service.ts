/**
 * ContextService (US-3.2) — monta o contexto da conversa em 3 camadas, escopado ao titular.
 *
 * `build()` combina working memory (Redis, janela recente), episodic memory (Postgres sob
 * RLS via `ContextRepository` — protocolo/semana/fase/constraints como JSON estruturado) e,
 * só em `DUVIDA_TECNICA`, a camada semantic (RAG, US-3.3 via `SEMANTIC_MEMORY`). O **PII
 * Scrubber roda sobre tudo** antes de retornar. O objeto é construído por request — nunca
 * reusado entre jobs (isolamento multi-tenant, Sato §10.3). É o que o `AIResponseWorker`
 * (US-3.5) consome, com o prefixo estável no topo (maximiza cache hit).
 */
import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { PromptResolverService } from '../intent/prompt-resolver.service';
import { ContextRepository } from './context.repository';
import { type RagDoc, SEMANTIC_MEMORY, type SemanticMemoryPort } from './semantic-memory.port';
import { WorkingMemory } from './working-memory.service';
import type { ScrubUser } from '../llm/llm.types';
import { LlmRouter } from '../llm/llm-router.service';
import { scrubPII } from '../llm/pii-scrubber';

export interface CoachContext {
  /** Bloco estável (estado episodic + resumo) — no topo do prompt, cacheável. */
  cacheablePrefix: string;
  /** Bloco volátil (janela recente + mensagem atual) — muda a cada turno. */
  volatileSuffix: string;
  ragDocs: RagDoc[];
  sessionDate: string;
  /** PII do titular, para o LLMRouter re-scrubar o prompt final antes de sair. */
  scrubUser: ScrubUser;
}

/** Passar de ~15 turnos dispara o resumo de sessão longa. */
const SUMMARY_THRESHOLD = 15;

/** Dia da sessão em America/Sao_Paulo (yyyy-mm-dd) — mesma chave no Redis e no Postgres. */
export function currentSessionDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
}

@Injectable()
export class ContextService {
  constructor(
    private readonly repo: ContextRepository,
    private readonly working: WorkingMemory,
    @Inject(SEMANTIC_MEMORY) private readonly semantic: SemanticMemoryPort,
    private readonly llm: LlmRouter,
    // US-7.6: a transcrição rotula os turnos da agente com o nome publicado no painel —
    // um nome literal aqui apareceria dentro do próprio prompt e divergiria do resto.
    private readonly prompts: PromptResolverService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ContextService.name);
  }

  async build(userId: string, intent: string, message: string): Promise<CoachContext> {
    const sessionDate = currentSessionDate();

    const [episodic, recent, ragDocs, agentName] = await Promise.all([
      this.repo.loadEpisodic(userId, sessionDate),
      this.working.recent(userId, sessionDate),
      intent === 'DUVIDA_TECNICA' ? this.semantic.retrieve(message) : Promise.resolve([]),
      this.prompts.agentName(),
    ]);

    const { scrubUser } = episodic;
    const scrub = (t: string): string => scrubPII(t, scrubUser);

    const prefix = [
      'ESTADO ATUAL DO ALUNO (não repita ao usuário; use para personalizar):',
      JSON.stringify(episodic.state),
      episodic.summary ? `RESUMO DA CONVERSA ATÉ AQUI: ${episodic.summary}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const suffix = [
      ...recent.map((t) => `${t.role === 'user' ? 'Aluno' : agentName}: ${t.content}`),
      `Aluno: ${message}`,
    ].join('\n');

    return {
      cacheablePrefix: scrub(prefix),
      volatileSuffix: scrub(suffix),
      // O snippet do RAG também passa pelo scrubber (defesa em profundidade).
      ragDocs: ragDocs.map((d) => ({ ...d, snippet: scrub(d.snippet) })),
      sessionDate,
      scrubUser,
    };
  }

  /** Grava um turno na working memory (chamado pelo worker antes e depois de responder). */
  async recordTurn(userId: string, role: 'user' | 'assistant', content: string): Promise<void> {
    await this.working.append(userId, currentSessionDate(), { role, content, ts: Date.now() });
  }

  /**
   * Resumo de sessão longa (versão mínima, US-3.2.3): passou de ~15 turnos → condensa a
   * janela em 2-3 frases e persiste sob RLS. ponytail: roda inline (o worker pode chamar
   * sem await); vira job BullMQ dedicado se a latência incomodar.
   */
  async summarizeIfNeeded(userId: string): Promise<void> {
    const sessionDate = currentSessionDate();
    if ((await this.working.count(userId, sessionDate)) <= SUMMARY_THRESHOLD) return;

    const recent = await this.working.recent(userId, sessionDate);
    const scrubUser = await this.repo.loadScrubUser(userId);
    const agentName = await this.prompts.agentName();
    const transcript = recent
      .map((t) => `${t.role === 'user' ? 'Aluno' : agentName}: ${t.content}`)
      .join('\n');

    const result = await this.llm.complete({
      purpose: 'AI_RESPONSE',
      userId,
      user: scrubUser,
      dataClass: 'HEALTH',
      system:
        'Resuma a conversa a seguir em no máximo 3 frases objetivas, preservando o que importa ' +
        'para a continuidade do acompanhamento (dores, preferências, ajustes pedidos). Só o resumo.',
      messages: [{ role: 'user', content: transcript }],
      maxTokens: 160,
      intent: 'session_summary',
    });

    await this.repo.upsertSummary(userId, sessionDate, result.text.trim());
    this.logger.info({ userId }, 'resumo de sessão longa persistido');
  }
}
