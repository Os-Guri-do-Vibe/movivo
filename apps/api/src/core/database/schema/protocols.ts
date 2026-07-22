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
import {
  boolean,
  index,
  jsonb,
  pgTable,
  smallint,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { protocolStatusEnum } from './enums';
import { users } from './users';

export const protocols = pgTable(
  'protocols',
  {
    id: primaryKeyColumn(),

    /** `RESTRICT`: protocolo assinado é documento com prazo de guarda defensiva. */
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    /** Versão vigente. O histórico completo vive em `protocol_versions`. */
    version: smallint('version').notNull().default(1),

    status: protocolStatusEnum('status').notNull().default('DRAFT'),

    /**
     * Profissional CREF responsável. **Sem FK nesta sprint**: a tabela
     * `professionals` (e `professional_assignments`, exigida pela policy de RLS
     * do profissional — Sato §4.3) nasce na sprint do dashboard CREF. A FK entra
     * junto com ela; deixar a coluna agora evita reescrever queries depois.
     */
    professionalId: uuid('professional_id'),

    signedAt: eventTimestamp('signed_at'),

    /**
     * SHA-256 do `content` no instante da assinatura. É o que permite provar,
     * meses depois, que o protocolo entregue é exatamente o que o profissional
     * assinou — e detectar adulteração posterior.
     */
    signatureHash: varchar('signature_hash', { length: 64 }),

    currentWeek: smallint('current_week').notNull().default(1),
    totalWeeks: smallint('total_weeks').notNull().default(12),

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
     * Modelo que redigiu a versão (`gpt-4.1`, `claude-sonnet-4-5`). Exigido para
     * auditoria e versionamento das respostas de IA. **Nunca `deepseek-*`**:
     * DeepSeek foi removido do projeto por decisão jurídica e de segurança
     * (ADR-005-R / regra §12.11).
     */
    generatedBy: varchar('generated_by', { length: 50 }),

    ...timestampColumns,
  },
  (table) => [
    unique('uq_protocols_user_version').on(table.userId, table.version),
    index('idx_protocols_user').on(table.userId, table.createdAt),
    index('idx_protocols_status').on(table.status),
    // Fila de trabalho do dashboard CREF.
    index('idx_protocols_review').on(table.humanReviewRequired, table.createdAt),
  ],
);

export type ProtocolRow = typeof protocols.$inferSelect;
export type NewProtocolRow = typeof protocols.$inferInsert;
