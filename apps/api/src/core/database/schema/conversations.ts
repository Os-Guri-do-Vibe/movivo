/**
 * Tabela `conversations` — histórico de mensagens trocadas no WhatsApp.
 *
 * É a tabela de maior volume do sistema (Rafael §7.3: ~1,8M de linhas em 12
 * meses com 5.000 usuários ativos).
 *
 * ## O que NÃO está aqui, de propósito (fora do escopo da US-0.4)
 *  - **Particionamento mensal por `created_at`** (Rafael §7.3). O `drizzle-kit`
 *    não gera `PARTITION BY` a partir do schema; a partição entra por migração
 *    SQL manual na sprint do AI Coach, junto com o job que cria a partição do
 *    mês seguinte. Por isso `created_at` já nasce `NOT NULL` e é coluna de
 *    índice — quando a partição chegar, ela é a chave, e nada aqui precisa mudar.
 *  - **Índice HNSW / coluna de embedding**: pertence à tabela `knowledge_base`
 *    (corpus do RAG), que é da sprint de RAG.
 */
import { boolean, index, integer, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';

import { primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { messageDirectionEnum, messageTypeEnum } from './enums';
import { protocols } from './protocols';
import { users } from './users';

export const conversations = pgTable(
  'conversations',
  {
    id: primaryKeyColumn(),

    /** `RESTRICT`: a conversa é parte da trilha de supervisão do profissional. */
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    /** Protocolo vigente no momento da mensagem. Nulo antes do primeiro protocolo. */
    protocolId: uuid('protocol_id').references(() => protocols.id, { onDelete: 'set null' }),

    direction: messageDirectionEnum('direction').notNull(),
    messageType: messageTypeEnum('message_type').notNull().default('TEXT'),

    /**
     * -- LGPD Art. 11 — DADO SENSÍVEL DE SAÚDE (potencial).
     * O corpo da mensagem. O usuário relata dor, lesão, medicação e condição
     * clínica em texto livre — não há como classificar previamente o que é ou
     * não sensível, então a coluna inteira recebe o tratamento mais restritivo.
     * Entra no escopo de cifra em repouso (`pgcrypto`) junto com a anamnese;
     * não cifrada nesta sprint. Nunca é logada em texto claro.
     */
    content: text('content').notNull(),

    /**
     * ID da mensagem na API AraraHQ. `UNIQUE` é o que garante **idempotência do
     * webhook** (`ARQUITETURA.md` §12.15): reentrega do mesmo evento colide na
     * constraint em vez de duplicar a conversa.
     */
    whatsappMsgId: varchar('whatsapp_msg_id', { length: 255 }).unique(),

    /**
     * Job de IA que produziu a mensagem (quando `OUTBOUND` gerada por IA).
     * Sem FK de propósito: `ai_jobs` é escrita de forma assíncrona pelo worker e
     * uma FK criaria acoplamento de ordem de escrita entre fila e persistência.
     */
    aiJobId: uuid('ai_job_id'),

    /** Modelo usado. Nunca `deepseek-*` (ADR-005-R / §12.11). */
    modelUsed: varchar('model_used', { length: 50 }),

    /** Latência de geração; alimenta o SLO de p95 ≤ 30s do AI Coach (§8). */
    latencyMs: integer('latency_ms'),

    /**
     * Resultado da validação de compliance CREF pós-geração (§12.5). `false`
     * significa resposta bloqueada — o registro fica para auditoria do SLO de
     * "respostas bloqueadas por compliance < 5%".
     */
    validationPassed: boolean('validation_passed'),

    ...timestampColumns,
  },
  (table) => [
    // Query mais frequente do produto (janela de contexto do AI Coach) e futura
    // chave de particionamento. `user_id` líder por causa da RLS (Sato §4.5).
    index('idx_conversations_user_created_at').on(table.userId, table.createdAt),
    index('idx_conversations_protocol').on(table.protocolId),
  ],
);

export type ConversationRow = typeof conversations.$inferSelect;
export type NewConversationRow = typeof conversations.$inferInsert;
