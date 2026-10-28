/**
 * Tabela `conversations` — histórico de mensagens trocadas no WhatsApp.
 *
 * É a tabela de maior volume do sistema (Rafael §7.3: ~1,8M de linhas em 12
 * meses com 5.000 usuários ativos).
 *
 * ## O que NÃO está aqui, de propósito (fora do escopo da US-0.4)
 *  - **Particionamento mensal por `created_at`** (Rafael §7.3). O `drizzle-kit`
 *    não gera `PARTITION BY` a partir do schema; a partição entra por migração
 *    SQL manual na sprint da IA, junto com o job que cria a partição do
 *    mês seguinte. Por isso `created_at` já nasce `NOT NULL` e é coluna de
 *    índice — quando a partição chegar, ela é a chave, e nada aqui precisa mudar.
 *  - **Índice HNSW / coluna de embedding**: pertence à tabela `knowledge_base`
 *    (corpus do RAG), que é da sprint de RAG.
 */
import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';

import { primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { messageDirectionEnum, messageTypeEnum } from './enums';
import { users } from './users';

export type ConversationOrigin = 'STUDENT' | 'AGENT' | 'SYSTEM' | 'PROFESSIONAL';
export type ConversationMediaStatus = 'PENDING' | 'READY' | 'FAILED';

export const conversations = pgTable(
  'conversations',
  {
    id: primaryKeyColumn(),

    /** `RESTRICT`: a conversa é parte da trilha de supervisão do profissional. */
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    direction: messageDirectionEnum('direction').notNull(),
    messageType: messageTypeEnum('message_type').notNull().default('TEXT'),

    /**
     * -- LGPD Art. 11 — DADO SENSÍVEL DE SAÚDE (potencial).
     * O corpo da mensagem. O usuário relata dor, lesão, medicação e condição
     * clínica em texto livre — não há como classificar previamente o que é ou
     * não sensível, então a coluna inteira recebe o tratamento mais restritivo.
     * Envelope de texto do HealthCipherService (Vault Transit em produção).
     * Linhas antigas em claro são migradas por rotate-health-cipher. Nunca logar conteúdo.
     */
    content: text('content').notNull(),

    /**
     * ID da mensagem no provedor WhatsApp. `UNIQUE` é o que garante **idempotência do
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

    /** Modelo usado, após o gate neutro da ADR-005-R2. */
    modelUsed: varchar('model_used', { length: 50 }),

    /** Latência de geração; alimenta o SLO de p95 ≤ 30s da IA (§8). */
    latencyMs: integer('latency_ms'),

    /**
     * Resultado da validação de compliance CREF pós-geração (§12.5). `false`
     * significa resposta bloqueada — o registro fica para auditoria do SLO de
     * "respostas bloqueadas por compliance < 5%".
     */
    validationPassed: boolean('validation_passed'),

    /**
     * Quem escreveu a mensagem (achado 2026-10-13): a IA precisa reler a conversa inteira
     * (inclusive a pergunta automática que ele próprio mandou e a mensagem do profissional)
     * quando o aluno responde horas ou dias depois, e `direction` sozinha não distingue o
     * Coach de um aviso automático nem de uma mensagem manual do CREF. `NULL` nas linhas
     * anteriores à coluna — a leitura deriva a origem de `direction`/`model_used`.
     */
    origin: varchar('origin', { length: 16 }).$type<ConversationOrigin>(),

    /** Tipo do job de WhatsApp que gerou a mensagem automática (`origin = 'SYSTEM'`). */
    sourceType: varchar('source_type', { length: 40 }),

    /** Snapshot das fontes RAG usadas na resposta, rastreavel ate chunk/documento. */
    ragSources: jsonb('rag_sources').$type<
      Array<{
        chunkId: string;
        documentId: string | null;
        title: string;
        sourceUrl?: string;
        documentVersion?: number;
        documentSha256?: string;
        publicationEventId?: string;
        evidenceId?: string;
        claimIds?: string[];
        verifierModel?: string;
      }>
    >(),

    /**
     * Linha gravada pelo ESPELHO do webhook (uma por mensagem do WhatsApp, antes de qualquer
     * filtro da IA). Fica fora da transcrição da IA — a IA continua lendo o turno que ela
     * mesma persistiu — exceto o que o profissional digitou no celular.
     */
    mirror: boolean('mirror').notNull().default(false),

    /**
     * Fora do painel "Conversas". Duas situações: o turno agregado que a IA persiste (o painel
     * já mostra cada mensagem do aluno pela linha-espelho) e a mensagem digitada no celular
     * enquanto ainda não se sabe se não foi o próprio envio da API.
     */
    hiddenInPanel: boolean('hidden_in_panel').notNull().default(false),

    /** Mídia (áudio/imagem) guardada cifrada em disco. `null` em mensagem de texto. */
    mediaPath: varchar('media_path', { length: 80 }),
    mediaMime: varchar('media_mime', { length: 100 }),
    mediaBytes: integer('media_bytes'),
    /** Duração do áudio informada pelo WhatsApp. */
    mediaSeconds: integer('media_seconds'),
    /** `PENDING` (baixando) → `READY` | `FAILED`. */
    mediaStatus: varchar('media_status', { length: 8 }).$type<ConversationMediaStatus>(),

    ...timestampColumns,
  },
  (table) => [
    // Query mais frequente do produto (janela de contexto da IA) e futura
    // chave de particionamento. `user_id` líder por causa da RLS (Sato §4.5).
    index('idx_conversations_user_created_at').on(table.userId, table.createdAt),
    // Painel de operações/SLA: janelas globais `created_at >= :since` (volume, latência do
    // WhatsApp, qualidade da IA) varriam a tabela inteira — a maior do produto — porque o
    // índice acima tem `user_id` líder e não serve a consulta sem titular.
    index('idx_conversations_created_at').on(table.createdAt),
    // Respostas bloqueadas pelo validador, por titular (detalhe do aluno no Control Center):
    // parcial porque são a exceção — o índice fica minúsculo e a leitura não percorre o histórico.
    index('idx_conversations_user_blocked')
      .on(table.userId, table.createdAt)
      .where(sql`${table.validationPassed} = false`),
  ],
);

export type ConversationRow = typeof conversations.$inferSelect;
export type NewConversationRow = typeof conversations.$inferInsert;
