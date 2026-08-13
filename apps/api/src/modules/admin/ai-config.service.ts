/**
 * Pilar IA do Control Center (US-7.7) — leitura da persona vigente, histórico de versões,
 * publicação, rollback e exposição somente-leitura dos blocos travados do prompt.
 *
 * ## Por que a escrita é tão estreita
 * O único caminho que alcança o system prompt é `agentPersonaSchema` — campo curto validado
 * por regex, ENUMs de lista fechada e uma faixa numérica. `agentSelfIntro` é o único texto
 * livre do payload e passa por `detectInjection` **antes** de gravar. Não existe textarea
 * livre no contrato: é isso que impede que alguém com login no painel escreva instrução
 * para a IA (Sato — superfície de injeção pelo painel).
 *
 * ## Append-only
 * Publicar e reverter fazem a mesma coisa: `INSERT` de uma versão nova. Rollback nunca
 * reabre linha antiga — copia o payload da versão alvo para uma versão nova, com
 * `change_note` próprio e auditoria própria.
 */
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  agentPersonaSchema,
  buildPersonaBlock,
  publishAgentConfigSchema,
  rollbackAgentConfigSchema,
  type AgentConfigHistoryResponse,
  type AgentPersona,
  type AgentPersonaResponse,
  type InviolableRulesResponse,
} from '@movivo/shared';
import { desc, eq, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import type { z } from 'zod';

import { AgentConfigRepository } from '../../core/agent-config/agent-config.repository';
import { AgentPersonaService } from '../../core/agent-config/agent-persona.service';
import { agentConfig, users } from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import {
  INVIOLABLE_RULES_BLOCK,
  PROMPT_BLOCKS,
  SCOPE_PERIMETER_BLOCK,
} from '../ai-coach/intent/prompts';
import { detectInjection } from '../protocol/validation/prompt-injection';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { AuditService } from './audit.service';

const TIMEZONE = 'America/Sao_Paulo' as const;
/** Teto do painel de histórico. Mais antigo que isso é caso de auditoria, não de UI. */
const HISTORY_LIMIT = 50;

/** Conteúdo real de cada bloco, para o painel exibir o que a IA de fato recebe. */
const BLOCK_CONTENT: Record<string, (persona: AgentPersona) => string> = {
  PERSONA: buildPersonaBlock,
  SCOPE_PERIMETER: () => SCOPE_PERIMETER_BLOCK,
  INVIOLABLE_RULES: () => INVIOLABLE_RULES_BLOCK,
};

@Injectable()
export class AiConfigService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repo: AgentConfigRepository,
    private readonly personaService: AgentPersonaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly audit: AuditService,
  ) {}

  async persona(): Promise<AgentPersonaResponse> {
    const [persona, active] = await Promise.all([
      this.personaService.persona(),
      this.repo.activePayload(),
    ]);
    return this.envelope(
      { persona, version: active?.version ?? null },
      active
        ? []
        : ['Nenhuma configuração publicada ainda — a IA responde com a persona padrão do código.'],
    );
  }

  async history(): Promise<AgentConfigHistoryResponse> {
    const rows = await this.db.runAsSystem((tx) =>
      tx
        .select({
          version: agentConfig.version,
          status: agentConfig.status,
          payload: agentConfig.payload,
          changeNote: agentConfig.changeNote,
          createdAt: agentConfig.createdAt,
          createdBy: users.name,
        })
        .from(agentConfig)
        .leftJoin(users, eq(users.id, agentConfig.createdBy))
        .orderBy(desc(agentConfig.version))
        .limit(HISTORY_LIMIT),
    );
    // Vigente é a maior versão PUBLISHED — a lista já vem ordenada por versão desc.
    const currentVersion = rows.find((row) => row.status === 'PUBLISHED')?.version ?? null;
    const versions = rows.flatMap((row) => {
      const parsed = agentPersonaSchema.safeParse(row.payload);
      // Linha com payload fora do contrato não é exibida como opção de rollback:
      // reverter para um payload que não valida cairia direto no default de código.
      if (!parsed.success) return [];
      return [
        {
          version: row.version,
          status: row.status,
          changeNote: row.changeNote,
          createdAt: row.createdAt.toISOString(),
          createdBy: row.createdBy,
          current: row.version === currentVersion,
          payload: parsed.data,
        },
      ];
    });
    return this.envelope({ versions });
  }

  /** Blocos do system prompt com camada, justificativa e conteúdo. L0 é somente-leitura. */
  async inviolableRules(): Promise<InviolableRulesResponse> {
    const persona = await this.personaService.persona();
    return this.envelope({
      blocks: PROMPT_BLOCKS.map((block) => ({
        id: block.id,
        layer: block.layer,
        title: block.title,
        editable: block.editable,
        rationale: block.rationale,
        content: BLOCK_CONTENT[block.id]?.(persona) ?? '',
      })),
    });
  }

  async publish(actor: AuthenticatedUser, body: unknown): Promise<AgentPersonaResponse> {
    const input = this.parse(publishAgentConfigSchema, body);
    return this.insertVersion(actor, input.payload, input.changeNote, 'ai_config.publish');
  }

  async rollback(actor: AuthenticatedUser, body: unknown): Promise<AgentPersonaResponse> {
    const input = this.parse(rollbackAgentConfigSchema, body);
    const [row] = await this.db.runAsSystem((tx) =>
      tx
        .select({ payload: agentConfig.payload })
        .from(agentConfig)
        .where(eq(agentConfig.version, input.targetVersion))
        .limit(1),
    );
    if (!row) throw new NotFoundException('Versão inexistente.');
    const payload = agentPersonaSchema.safeParse(row.payload);
    if (!payload.success) {
      throw new BadRequestException('A versão alvo tem payload fora do contrato atual.');
    }
    return this.insertVersion(actor, payload.data, input.changeNote, 'ai_config.rollback');
  }

  /**
   * Caminho único de escrita: valida injeção, insere versão nova, audita na mesma
   * transação e só então invalida o cache. Se a transação falhar, nada é invalidado.
   */
  private async insertVersion(
    actor: AuthenticatedUser,
    payload: AgentPersona,
    changeNote: string,
    action: string,
  ): Promise<AgentPersonaResponse> {
    if (detectInjection(payload.agentSelfIntro) || detectInjection(payload.agentName)) {
      throw new BadRequestException({
        code: 'INJECTION_DETECTED',
        message: 'A apresentação contém um padrão de instrução para a IA e não pode ser salva.',
      });
    }

    const version = await this.db.runAsSystem(async (tx) => {
      const previous = await this.nextVersion(tx);
      const [inserted] = await tx
        .insert(agentConfig)
        .values({
          version: previous.next,
          status: 'PUBLISHED',
          payload,
          changeNote,
          createdBy: actor.userId,
        })
        .returning({ id: agentConfig.id, version: agentConfig.version });
      if (!inserted) throw new BadRequestException('Não foi possível publicar a configuração.');
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action,
        entityType: 'agent_config',
        entityId: inserted.id,
        changes: { fromVersion: previous.current, toVersion: inserted.version, changeNote },
      });
      return inserted.version;
    });

    await this.propagate(payload);
    return this.envelope({ persona: payload, version }, [
      'A nova persona vale em até 60 segundos, sem deploy.',
    ]);
  }

  /**
   * ponytail: `max(version) + 1` sem lock. Duas publicações simultâneas colidem na
   * constraint UNIQUE de `version` e a segunda falha com erro — comportamento correto
   * (nada grava errado), só não é bonito. Um `SELECT ... FOR UPDATE` ou uma sequence
   * resolvem se o painel algum dia tiver concorrência real.
   */
  private async nextVersion(tx: TenantTransaction): Promise<{ current: number; next: number }> {
    const [row] = await tx
      .select({ max: sql<number>`coalesce(max(${agentConfig.version}), 0)::int` })
      .from(agentConfig);
    const current = Number(row?.max ?? 0);
    return { current, next: current + 1 };
  }

  /**
   * Snapshot no Redis + `PUBLISH` para as demais instâncias, e invalidação local (a
   * instância que publica não recebe a própria mensagem em todos os cenários). Redis
   * fora do ar não derruba a publicação: o TTL de 60s do cache propaga assim mesmo.
   */
  private async propagate(payload: AgentPersona): Promise<void> {
    try {
      await this.redis.set(this.personaService.cacheKey, JSON.stringify(payload));
      await this.redis.publish(this.personaService.channel, '1');
    } catch {
      // silêncio proposital: `AgentPersonaService` já loga a queda quando lê do banco.
    }
    this.personaService.invalidate();
  }

  private parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) {
      throw new BadRequestException({ code: 'INVALID_INPUT', issues: result.error.issues });
    }
    return result.data;
  }

  private envelope<T>(data: T, dataQuality: string[] = []) {
    return {
      data,
      meta: { generatedAt: new Date().toISOString(), timezone: TIMEZONE, dataQuality },
    };
  }
}
