/**
 * Tabela `protocols` — o protocolo de treino **vigente** de cada usuário.
 *
 * Um protocolo nunca é produto de LLM puro: ele nasce do Motor Determinístico e
 * só chega ao usuário depois de assinado/supervisionado por profissional CREF
 * (`ARQUITETURA.md` §12.4/§12.5). O schema materializa essa regra em colunas —
 * `professional_id`, `signed_at`, `signature_hash`, `human_review_required` —
 * para que a supervisão seja um fato consultável no banco, e não uma promessa
 * de camada de aplicação.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { bytea, eventTimestamp, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { protocolApprovalStatusEnum, protocolStatusEnum, reviewUrgencyEnum } from './enums';
import { anamnesisSessions } from './anamnesis-sessions';
import { users } from './users';
import { methodologyVersions } from './methodology-versions';

export const protocols = pgTable(
  'protocols',
  {
    id: primaryKeyColumn(),

    /** `RESTRICT`: protocolo assinado é documento com prazo de guarda defensiva. */
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    /**
     * Sessão de anamnese que originou o protocolo (2026-08-24). É o vínculo que permite à
     * assinatura CREF liberar o PAR-Q da sessão CERTA — antes da mudança, a liberação era
     * uma tela própria que recebia o id da sessão direto do cliente.
     *
     * **Nullable de propósito**: linhas criadas antes da migração 0035 não têm como ser
     * ligadas retroativamente sem inferência (o titular pode ter mais de uma sessão), e
     * inferir vínculo de saúde é exatamente o tipo de chute que não se faz aqui. Quem
     * consome trata `NULL` como "nada a liberar", nunca como erro.
     *
     * `RESTRICT`: a sessão é a prova documental do PAR-Q que justificou o protocolo.
     */
    anamnesisSessionId: uuid('anamnesis_session_id').references(() => anamnesisSessions.id, {
      onDelete: 'restrict',
    }),

    /** Versão vigente. O histórico completo vive em `protocol_versions`. */
    version: smallint('version').notNull().default(1),

    status: protocolStatusEnum('status').notNull().default('DRAFT'),

    /**
     * Eixo de supervisão (US-2.4). Todo protocolo nasce roteado ao painel do RT CREF:
     * sem risco mapeado (validador limpo) → `AUTO_APPROVED` + assinado; validador
     * bloqueou/flagou → `PENDING_REVIEW` (não entrega, aguarda o painel — Sprint 5).
     */
    approvalStatus: protocolApprovalStatusEnum('approval_status')
      .notNull()
      .default('PENDING_REVIEW'),

    /**
     * Profissional CREF responsável. A FK impede assinaturas órfãs; a atribuição
     * ativa e o `cref_active` são validados transacionalmente antes da persistência.
     */
    professionalId: uuid('professional_id').references(() => users.id, {
      onDelete: 'restrict',
    }),

    signedAt: eventTimestamp('signed_at'),

    /**
     * SHA-256 do `content` no instante da assinatura. É o que permite provar,
     * meses depois, que o protocolo entregue é exatamente o que o profissional
     * assinou — e detectar adulteração posterior.
     */
    signatureHash: varchar('signature_hash', { length: 64 }),

    currentWeek: smallint('current_week').notNull().default(1),
    totalWeeks: smallint('total_weeks').notNull().default(12),

    /** Nome do bloco de periodização vigente (ex.: "Mesociclo 1 — Hipertrofia"). Computado no `persist()` a partir de `content.phase`. */
    mesocycleName: varchar('mesocycle_name', { length: 120 }).notNull(),

    /** Início do mesociclo vigente. `end_date` = `start_date` + `total_weeks` semanas, ambos gravados no `persist()`. */
    startDate: eventTimestamp('start_date').notNull(),
    endDate: eventTimestamp('end_date').notNull(),

    /**
     * PDF do protocolo assinado (`buildProtocolPdf`, `protocol-pdf.service.ts`), gerado em
     * `DashboardService.signProtocol` e enviado como documento pelo WhatsApp. `NULL` até a
     * assinatura CREF — protocolo `AUTO_APPROVED` ainda não gera PDF (Sprint futura).
     */
    pdfContent: bytea('pdf_content'),

    /**
     * -- LGPD Art. 11 — DADO SENSÍVEL DE SAÚDE (derivado).
     * Estrutura completa do protocolo. Ainda que sejam "só exercícios", o
     * conteúdo é personalizado a partir de condição de saúde e limitação física
     * do titular — logo revela dado de saúde por inferência. Entra no mesmo
     * escopo de cifra em repouso (`pgcrypto`) da sprint de anamnese; não cifrado
     * nesta sprint.
     */
    content: jsonb('content').notNull(),

    /**
     * `ProtocolConstraints` imutável produzido pelo Motor Determinístico
     * (Rafael §5.2): tetos de volume/intensidade e exercícios vetados. O LLM
     * redige dentro destes limites e **nunca** pode alterá-los.
     */
    constraints: jsonb('constraints').notNull(),

    /**
     * -- LGPD Art. 11 — DADO SENSÍVEL DE SAÚDE.
     * Flags de contraindicação derivadas do PAR-Q. Mesmo destino de cifra do
     * `anamnesis_sessions.data_block_2`.
     */
    parQFlags: jsonb('par_q_flags'),

    /**
     * `true` trava a entrega automática e enfileira revisão humana. É a
     * materialização do guardrail "a IA nunca decide sozinha" — nenhuma
     * resposta de LLM pode zerar esta flag.
     */
    humanReviewRequired: boolean('human_review_required').notNull().default(false),

    /**
     * Só relevante enquanto `approval_status = PENDING_REVIEW` (fila do profissional).
     * `MANDATORY` (origem `BLOCK_FALLBACK`) nunca libera sozinho. `OPTIONAL` (origem
     * `FLAG_HUMAN_REVIEW`) libera sozinho após 1h se o CREF não agir
     * (`ProtocolAutoReleaseWorker`). `NULL` para protocolos que nunca passaram por
     * `PENDING_REVIEW` (`AUTO_APPROVED` de origem).
     */
    reviewUrgency: reviewUrgencyEnum('review_urgency'),

    /**
     * Provedor que redigiu a versão. Exigido para auditoria e sujeito ao gate neutro
     * de classe de dado da ADR-005-R2.
     */
    generatedBy: varchar('generated_by', { length: 50 }),

    /**
     * Versão do modelo que redigiu (`gpt-4.1`, `claude-sonnet-4-5`) — o modelo efetivo,
     * distinto de `generated_by` (o provedor/origem). Rastreabilidade da geração (US-2.4).
     */
    modelVersion: varchar('model_version', { length: 50 }),

    /**
     * Versão do pipeline de geração (metodologia + base de referência), ex.:
     * `methodology-2026-07+catalog-2026-07`. Permite reconstituir sob qual metodologia/base
     * o treino foi planejado — insumo da supervisão CREF (US-2.4).
     */
    promptVersion: varchar('prompt_version', { length: 80 }),

    /** Snapshot mínimo das fontes publicadas recuperadas para esta geração. */
    knowledgeSources: jsonb('knowledge_sources'),

    methodologyVersionId: uuid('methodology_version_id').references(() => methodologyVersions.id, {
      onDelete: 'restrict',
    }),
    methodologySha256: varchar('methodology_sha256', { length: 64 }),

    ...timestampColumns,
  },
  (table) => [
    unique('uq_protocols_user_version').on(table.userId, table.version),
    index('idx_protocols_user').on(table.userId, table.createdAt),
    index('idx_protocols_status').on(table.status),
    // Fila de trabalho do dashboard CREF.
    index('idx_protocols_review').on(table.humanReviewRequired, table.createdAt),
    // Join da fila com `anamnesis_sessions` (severidade do item) e lookup da liberação
    // de PAR-Q na assinatura.
    index('idx_protocols_anamnesis_session').on(table.anamnesisSessionId),
    /**
     * Defesa em profundidade exigida pela revisão de segurança (2026-08-24): protocolo
     * `MANDATORY` NUNCA pode terminar `AUTO_APPROVED`. Hoje três camadas já impedem isso
     * (o worker não agenda auto-liberação para `MANDATORY`, `autoRelease()` reconfere o
     * estado sob `FOR UPDATE`, e `editProtocol` força `MANDATORY`), mas todas são de
     * aplicação. Esta é a única que sobrevive a um bug de aplicação, a um script
     * administrativo e a um `UPDATE` manual em produção.
     */
    check(
      'protocols_mandatory_never_auto_approved',
      sql`NOT (${table.reviewUrgency} = 'MANDATORY' AND ${table.approvalStatus} = 'AUTO_APPROVED')`,
    ),
  ],
);

export type ProtocolRow = typeof protocols.$inferSelect;
export type NewProtocolRow = typeof protocols.$inferInsert;
