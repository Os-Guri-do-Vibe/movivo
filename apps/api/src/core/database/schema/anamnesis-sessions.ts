/**
 * Tabela `anamnesis_sessions` — progresso do formulário de anamnese + PAR-Q.
 *
 * É a tabela mais sensível do produto: o bloco 2 concentra histórico de saúde,
 * lesões, medicação em uso e as respostas do PAR-Q. Tudo ali é **dado pessoal
 * sensível** na acepção do Art. 11 da LGPD.
 */
import { index, integer, jsonb, pgTable, smallint, varchar } from 'drizzle-orm/pg-core';

import { bytea, eventTimestamp, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { anamnesisStatusEnum, parqStateEnum } from './enums';
import { users } from './users';

export const anamnesisSessions = pgTable(
  'anamnesis_sessions',
  {
    id: primaryKeyColumn(),

    /**
     * Nulo enquanto a sessão é anônima: o usuário começa o formulário na landing
     * antes de existir conta (Sofia). O vínculo acontece na confirmação do
     * WhatsApp. `ON DELETE CASCADE` porque uma sessão de anamnese abandonada não
     * tem significado sem o titular — e é o que torna a limpeza barata.
     */
    userId: userIdColumn().references(() => users.id, { onDelete: 'cascade' }),

    /**
     * Token opaco do link de retorno ("continuar de onde parei"), 72h de
     * validade. É credencial de acesso a dado de saúde: precisa ser gerado com
     * CSPRNG e tratado como segredo. A regra de entropia/expiração vem do
     * pentest de anamnese de Sato (§8) e é aplicada na sprint de anamnese.
     */
    token: varchar('token', { length: 64 }).notNull().unique(),

    status: anamnesisStatusEnum('status').notNull().default('IN_PROGRESS'),

    /**
     * Última ETAPA concluída do wizard v2 (1=cadastro, 2=anamnese, 3=PAR-Q) — habilita
     * o salvamento de progresso e a tela de retomada (Sofia §1.4c).
     *
     * A coluna continua se chamando `last_block` de propósito: renomeá-la só trocaria o
     * rótulo de uma coluna cujo significado a aplicação já define, ao custo de um
     * `ALTER ... RENAME` e de um passo interativo no `drizzle-kit generate`. O nome do
     * conceito vive no código; a coluna é detalhe de armazenamento.
     */
    lastStep: smallint('last_block').notNull().default(1),

    /** Etapa 1 — cadastro pessoal (nome, nascimento, sexo, telefone). Dado pessoal comum. */
    dataBlock1: jsonb('data_block_1'),

    /**
     * -- LGPD Art. 11 — DADO SENSÍVEL DE SAÚDE.
     * Na v2 concentra: **seção 4** (dor localizada, intensidade, tendência, diagnóstico
     * informado, acompanhamento, recomendação de evitação), o **PAR-Q inteiro** e
     * **todo campo de texto livre** da anamnese (recomendação vinculante de Alexandre
     * §5.7 — é mais barato cifrar tudo que é livre do que auditar o que o usuário
     * digitou). **Cifrado em repouso com `pgcrypto`**: o valor gravado é o `bytea` de
     * `pgp_sym_encrypt` (`HealthCipherService`), nunca o JSON em claro.
     */
    dataBlock2: bytea('data_block_2'),

    /** Etapa 2, seções 1/2/3/5 — objetivos, histórico, rotina e preferências (comum). */
    dataBlock3: jsonb('data_block_3'),

    // --- Verificação de posse do WhatsApp (US-6.5) --------------------------
    /**
     * Telefone informado na Etapa 1, em E.164. Duplica o que está em `data_block_1`
     * de propósito: é a chave do rate limit por número (evitar usar o AraraHQ como
     * canal de abuso) e do reenvio idempotente, e um predicado indexável não pode
     * viver dentro de um jsonb.
     */
    phoneE164: varchar('phone_e164', { length: 20 }),

    /** Carimbo da verificação. NULL = número não provado; bloqueia o avanço da Etapa 1. */
    phoneVerifiedAt: eventTimestamp('phone_verified_at'),

    /**
     * SHA-256 de `<sessionId>:<código>`. **Nunca o código em claro** — nem aqui, nem em
     * log. O id da sessão faz o papel de sal: dois códigos iguais em sessões diferentes
     * produzem hashes diferentes, o que impede correlacionar sessões por igualdade.
     */
    phoneCodeHash: varchar('phone_code_hash', { length: 64 }),
    phoneCodeExpiresAt: eventTimestamp('phone_code_expires_at'),
    /** Tentativas de verificação do código VIGENTE. Zera a cada novo código. */
    phoneCodeAttempts: integer('phone_code_attempts').notNull().default(0),
    /** Último envio — base do cooldown de 60s e do reenvio idempotente. */
    phoneCodeSentAt: eventTimestamp('phone_code_sent_at'),
    /** Envios nesta sessão (teto absoluto por sessão). */
    phoneCodeSendCount: integer('phone_code_send_count').notNull().default(0),

    // --- Atribuição de primeiro toque (US-8.2) --------------------------------
    /**
     * Origem do primeiro toque, **gravada em bruto** (já saneada: charset em allowlist,
     * minúsculas, 120 chars). A normalização para canal canônico acontece na leitura.
     * Nunca é `null` em sessão criada a partir da US-8.2: ausência de UTM grava
     * `'desconhecida'` explicitamente. `NULL` significa **cadastro anterior à Sprint 8**.
     */
    utmSource: varchar('utm_source', { length: 120 }),
    utmMedium: varchar('utm_medium', { length: 120 }),
    utmCampaign: varchar('utm_campaign', { length: 120 }),
    utmContent: varchar('utm_content', { length: 120 }),
    /**
     * **Somente o host** do referrer. A URL completa carrega termo de busca e
     * identificador de terceiro — PII que o produto não pediu (Sato, US-8.2).
     */
    referrerHost: varchar('referrer_host', { length: 253 }),
    /**
     * Carimbo do primeiro toque. É o **guarda da escrita única**: o UPDATE de
     * atribuição só roda com `first_touch_at IS NULL`, então reabrir o funil por um
     * link orgânico não sobrescreve a origem original.
     */
    firstTouchAt: eventTimestamp('first_touch_at'),

    /** Pré-qualificação capturada na landing, antes do formulário. */
    primaryGoal: varchar('primary_goal', { length: 30 }),

    /**
     * Estado do gate PAR-Q, definido no submit (US-1.3). Nulo enquanto
     * `IN_PROGRESS`. `BLOQUEADO_AGUARDANDO_CLEARANCE` impede geração automática.
     */
    parqState: parqStateEnum('parq_state'),

    /** Expiração do link de retorno; o prazo de 72h é aplicado pela aplicação. */
    expiresAt: eventTimestamp('expires_at').notNull(),

    submittedAt: eventTimestamp('submitted_at'),

    ...timestampColumns,
  },
  (table) => [
    // `user_id` como coluna LÍDER: é o predicado que a RLS injeta em toda query
    // (Sato §4.5 — sem isso a degradação é de duas ordens de grandeza).
    index('idx_anamnesis_sessions_user').on(table.userId, table.createdAt),
    index('idx_anamnesis_sessions_status').on(table.status),
    // Expurgo de sessões expiradas (minimização de dado sensível) sem seq scan.
    index('idx_anamnesis_sessions_expires_at').on(table.expiresAt),
    // Rate limit de envio de código POR NÚMERO (US-6.5): sem este índice, o teto por
    // número viraria seq scan na tabela mais quente do onboarding.
    index('idx_anamnesis_sessions_phone_code').on(table.phoneE164, table.phoneCodeSentAt),
  ],
);

export type AnamnesisSessionRow = typeof anamnesisSessions.$inferSelect;
export type NewAnamnesisSessionRow = typeof anamnesisSessions.$inferInsert;
