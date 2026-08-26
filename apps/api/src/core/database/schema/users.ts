/**
 * Tabela `users` — raiz do agregado USER e âncora do isolamento por titular.
 *
 * Toda tabela com dado pessoal referencia `users.id`. É esse `user_id` que as
 * políticas `FORCE ROW LEVEL SECURITY` das próximas sprints vão comparar com
 * `current_setting('app.current_user_id')` (Sato §4.2), e é por isso que ele é
 * **coluna líder** dos índices por usuário (Sato §4.5).
 */
import { boolean, index, pgTable, text, varchar } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn, timestampColumns } from './_shared';
import { biologicalSexEnum, userRoleEnum, userStatusEnum } from './enums';

export const users = pgTable(
  'users',
  {
    id: primaryKeyColumn(),

    /**
     * Telefone em E.164 (`+5511999999999`) — é o identificador funcional do
     * produto, já que a entrega inteira acontece no WhatsApp.
     *
     * -- LGPD Art. 5º, I: dado pessoal (identifica o titular). Não é dado
     * sensível do Art. 11, mas o `ARQUITETURA.md` §8 é explícito: **nunca é
     * logado em texto claro** (a redação já está implementada no LoggerModule,
     * US-0.3). Ficará também sob RLS e é o campo alvo de pseudonimização no
     * fluxo de direito ao esquecimento (LGPD Art. 18, IV).
     */
    phoneNumber: varchar('phone_number', { length: 20 }).notNull().unique(),

    /** Nome informado no cadastro. Dado pessoal comum. */
    name: varchar('name', { length: 255 }),

    /** Opcional: só existe para quem acessa o dashboard/recibos. */
    email: varchar('email', { length: 255 }).unique(),

    /** Nome do perfil no WhatsApp, retornado pela AraraHQ. Dado pessoal comum. */
    whatsappName: varchar('whatsapp_name', { length: 255 }),

    /**
     * Sexo biológico informado pelo titular na Etapa 1 da anamnese — denormalizado aqui
     * (a origem continua sendo `anamnesis_sessions.data_block_1`) porque toda mensagem do
     * WhatsApp precisa dele para resolver QUAL persona atende o titular (Sprint 11).
     *
     * **Nullable de propósito.** Titular criado antes desta coluna existir fica `NULL` até
     * uma nova anamnese (o backfill do `migrate.ts` cobre quem já submeteu). `NULL` nunca
     * derruba mensagem: a resolução da persona trata como "sem titular em contexto" e cai
     * no empréstimo entre slots. **Nunca inferir por heurística de nome** (exigência
     * explícita do Sato): errar o palpite é pior que não ter o dado.
     *
     * -- LGPD: dado pessoal comum (Alexandre §5.7), não sensível do Art. 11. Ainda assim
     * é redigido no log (`PII_FIELDS`) e **não entra em nenhuma projeção** de
     * `control-center.service.ts` (`students()`/`student()`) — condição sob a qual o Sato
     * aprovou a denormalização. Entra na lista de campos zerados na anonimização (Art. 18, IV).
     */
    biologicalSex: biologicalSexEnum('biological_sex'),

    status: userStatusEnum('status').notNull().default('ONBOARDING'),

    /**
     * Papel de autorização (RBAC — US-1.4 / Sato §9.2). Default `USER`: todo
     * titular criado pelo funil de anamnese nasce como usuário comum. Só sobe
     * para um papel interno por provisionamento administrativo (fora do fluxo
     * público). Consumido pelos guards e pelo GUC `app.current_role`.
     */
    role: userRoleEnum('role').notNull().default('USER'),

    /**
     * Hash Argon2id da senha — existe somente para contas internas provisionadas
     * (o titular final não faz login no MVP). Nulo para `USER`.
     *
     * -- SENSÍVEL: credencial. Nunca é logado (LoggerModule redige), nunca sai
     * em resposta de API e nunca trafega em claro. O hashing (Argon2id) é feito
     * na aplicação em US-1.4 — esta coluna guarda apenas o *encoded hash* final,
     * jamais a senha. `text` porque o encoded do Argon2id não tem tamanho fixo.
     */
    passwordHash: text('password_hash'),

    /** Credencial profissional verificada no provisionamento interno. */
    crefNumber: varchar('cref_number', { length: 30 }),
    crefRegion: varchar('cref_region', { length: 2 }),
    crefActive: boolean('cref_active').notNull().default(false),

    trialStartedAt: eventTimestamp('trial_started_at'),
    trialEndsAt: eventTimestamp('trial_ends_at'),

    /**
     * Marca de anonimização do direito ao esquecimento (LGPD Art. 18, IV).
     *
     * A MOVIVO **não** apaga a linha: o protocolo assinado por um profissional
     * CREF precisa sobreviver por prazo de guarda defensiva (`ARQUITETURA.md`
     * §8). O fluxo correto é anonimizar os identificadores e carimbar aqui a
     * data. A coluna nasce agora, mesmo sem o fluxo implementado, para que
     * nenhuma query escrita nas Sprints 1-3 ignore a existência do estado
     * "titular anonimizado" e precise ser reescrita depois.
     *
     * ## Campos que o fluxo precisa zerar quando for implementado
     * `name`, `email`, `whatsapp_name`, `phone_number` (pseudonimizado) e
     * **`biological_sex`** (Sprint 11 — exigência do Sato ao aprovar a denormalização:
     * campo derivado de anamnese não pode sobreviver ao apagamento da origem). O endpoint
     * `POST /control-center/admin/subjects/:id/anonymize` segue deliberadamente bloqueado
     * (`STEP_UP_REQUIRED_NOT_IMPLEMENTED`) até existir step-up — esta lista é o contrato
     * que aquele fluxo terá de cumprir.
     */
    anonymizedAt: eventTimestamp('anonymized_at'),

    /**
     * PAR-Q com resposta positiva bloqueia a geração automática e exige o
     * profissional CREF (guardrail de Clóvis/Alexandre: a IA nunca decide
     * sozinha). Fica em `users` — e não só na anamnese — porque é uma trava de
     * conta consultada em todo fluxo de geração.
     */
    requiresProfessionalReview: boolean('requires_professional_review').notNull().default(false),

    ...timestampColumns,
  },
  (table) => [
    // Login/roteamento de webhook resolvem o usuário pelo telefone: o unique já
    // cria índice, então aqui só indexamos o que ele não cobre.
    index('idx_users_status').on(table.status),
    // Sequência de conversão do trial (dias 7/10/13/14 — Lucas §MVP).
    index('idx_users_trial_ends_at').on(table.trialEndsAt),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
