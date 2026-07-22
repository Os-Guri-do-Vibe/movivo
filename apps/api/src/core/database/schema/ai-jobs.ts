/**
 * Tabela `ai_jobs` — trilha de auditoria de toda invocação de LLM.
 *
 * Existe por três exigências distintas que convergem na mesma linha:
 *  1. **CREF/auditabilidade** (`ARQUITETURA.md` §8, RNF-07): toda decisão que
 *     chegou ao usuário precisa ser reconstituível — qual modelo, com que
 *     latência, se passou na validação de compliance.
 *  2. **FinOps** (Victor, `12-relatorio-victor.md`): o custo de LLM por usuário
 *     (~R$1,08/mês) só é gerenciável se os tokens forem contados por job.
 *  3. **SLO de fila** (§8): `<0,5%` de jobs em DLQ exige um predicado simples
 *     sobre `status`.
 *
 * ## O que NÃO está aqui, de propósito
 * O **prompt e a resposta em texto** não são persistidos nesta tabela. O
 * conteúdo da conversa vive em `conversations` (uma única fonte de verdade para
 * dado sensível), e duplicá-lo aqui multiplicaria a superfície de exposição de
 * dado de saúde sem ganho de auditoria — o `conversationId` já liga as duas
 * pontas.
 */
import { index, integer, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { aiJobStatusEnum, aiJobTypeEnum } from './enums';
import { users } from './users';

export const aiJobs = pgTable(
  'ai_jobs',
  {
    id: primaryKeyColumn(),

    /** `RESTRICT`: a trilha de auditoria não pode sumir com o titular (§8). */
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    jobType: aiJobTypeEnum('job_type').notNull(),
    status: aiJobStatusEnum('status').notNull().default('QUEUED'),

    /**
     * Mensagem que originou o job, quando houver.
     *
     * Sem FK de propósito, espelhando `conversations.ai_job_id`: as duas tabelas
     * são escritas por atores assíncronos distintos (worker BullMQ e handler do
     * webhook) e uma FK em qualquer direção imporia ordem de escrita entre eles.
     */
    conversationId: uuid('conversation_id'),

    /**
     * Modelo efetivamente usado — **o que respondeu**, não o que foi pedido.
     * Quando o circuit breaker cai do principal para o fallback (ADR-005-R:
     * GPT-4.1 → Claude Sonnet 4.5), é este campo que revela o failover.
     * Nunca `deepseek-*`: o DeepSeek foi removido do projeto (§12.11).
     */
    modelUsed: varchar('model_used', { length: 50 }),

    /** Contagem de tokens para rateio de custo (Victor / FinOps). */
    tokensInput: integer('tokens_input'),
    tokensOutput: integer('tokens_output'),

    /** Alimenta o SLO de latência p95 ≤ 30s do AI Coach (§8). */
    latencyMs: integer('latency_ms'),

    /**
     * Tentativas já consumidas. Cruzado com `status = 'DLQ'`, é o que distingue
     * "falhou e vai reprocessar" de "esgotou o retry e virou tarefa humana"
     * (política de DLQ do `ARQUITETURA.md` §6).
     */
    retryCount: integer('retry_count').notNull().default(0),

    /**
     * Causa do erro. Texto de diagnóstico técnico (timeout, 429, circuit
     * breaker aberto) — **nunca** o conteúdo da mensagem do usuário, que é dado
     * potencialmente sensível e já vive em `conversations`.
     */
    errorMessage: text('error_message'),

    startedAt: eventTimestamp('started_at'),
    completedAt: eventTimestamp('completed_at'),

    ...timestampColumns,
  },
  (table) => [
    // Timeline de jobs do usuário no dashboard do profissional CREF.
    // `user_id` líder por causa da RLS (Sato §4.5).
    index('idx_ai_jobs_user_created_at').on(table.userId, table.createdAt),
    // Predicado do SLO de DLQ e do painel de fila.
    index('idx_ai_jobs_status').on(table.status),
  ],
);

export type AiJobRow = typeof aiJobs.$inferSelect;
export type NewAiJobRow = typeof aiJobs.$inferInsert;
