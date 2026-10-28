/**
 * Tabela `users` — raiz do agregado USER e âncora do isolamento por titular.
 *
 * Toda tabela com dado pessoal referencia `users.id`. É esse `user_id` que as
 * políticas `FORCE ROW LEVEL SECURITY` das próximas sprints vão comparar com
 * `current_setting('app.current_user_id')` (Sato §4.2), e é por isso que ele é
 * **coluna líder** dos índices por usuário (Sato §4.5).
 */
import { boolean, index, pgTable, varchar } from 'drizzle-orm/pg-core';

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

    /**
     * Obrigatório desde a etapa 1 da anamnese (dado de contato futuro: recibos,
     * recuperação de conta, comunicação fora do WhatsApp). Único por titular —
     * um mesmo e-mail não pode se cadastrar duas vezes.
     */
    email: varchar('email', { length: 255 }).notNull().unique(),

    /**
     * Caminho relativo do arquivo de foto de perfil no disco persistente da VPS (ex:
     * `avatars/<uuid>.webp`), servido por rota estática dedicada — nunca uma URL externa.
     * Só existe para contas internas (dashboard); `NULL` cai no fallback de iniciais na UI.
     */
    avatarPath: varchar('avatar_path', { length: 512 }),

    /** Nome do perfil no WhatsApp. Dado pessoal comum. */
    whatsappName: varchar('whatsapp_name', { length: 255 }),

    /** Fuso do titular: agenda de treino, check-ins e revisão semanal respeitam este fuso. */
    timezone: varchar('timezone', { length: 64 }).notNull().default('America/Sao_Paulo'),

    /**
     * Sexo biológico informado pelo titular na anamnese — denormalizado aqui porque os
     * cálculos de energia e de referência do planejamento dependem dele.
     *
     * **Nullable de propósito.** `NULL` significa "não informado"; o planejamento então
     * trabalha sem a referência. **Nunca inferir por heurística de nome** (exigência
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
    /**
     * Papel do titular perante o RBAC — na prática sempre `USER` desde a separação
     * das contas internas para a tabela `staff`. Mantido (em vez de removido) para
     * não reabrir a policy de RLS `users.role = 'USER'` (SUPPORT) nem o enum
     * `user_role`; ver `staff.ts` para ADMIN/PROFESSIONAL/etc.
     */
    role: userRoleEnum('role').notNull().default('USER'),

    trialStartedAt: eventTimestamp('trial_started_at'),
    trialEndsAt: eventTimestamp('trial_ends_at'),

    /**
     * Marca de anonimização do direito ao esquecimento (LGPD Art. 18, IV).
     *
     * A MOVIVO **não** apaga a linha: planos, decisões e registros assinados por um
     * profissional precisam sobreviver por prazo de guarda defensiva (`ARQUITETURA.md`
     * §8). O fluxo correto é anonimizar os identificadores e carimbar aqui a data.
     *
     * ## Campos que o fluxo precisa zerar quando for implementado
     * `name`, `email`, `whatsapp_name`, `phone_number` (pseudonimizado) e
     * **`biological_sex`** (exigência do Sato ao aprovar a denormalização: campo derivado de
     * anamnese não pode sobreviver ao apagamento da origem). O endpoint
     * `POST /control-center/admin/subjects/:id/anonymize` segue deliberadamente bloqueado
     * (`STEP_UP_REQUIRED_NOT_IMPLEMENTED`) até existir step-up — esta lista é o contrato
     * que aquele fluxo terá de cumprir.
     */
    anonymizedAt: eventTimestamp('anonymized_at'),

    /**
     * PAR-Q com resposta positiva bloqueia a geração automática e exige o
     * profissional (a IA nunca decide sozinha nesse caso). Fica em `users` — e não só na
     * anamnese — porque é uma trava de conta consultada em todo fluxo de geração.
     */
    requiresProfessionalReview: boolean('requires_professional_review').notNull().default(false),

    /**
     * Quando o profissional pausou o atendimento automático para este titular (aba
     * "Conversas" do painel). `NULL` = a IA responde normalmente. Pausado, o inbound
     * é só registrado no histórico e quem responde é um humano. Vale até reativar à mão —
     * não expira sozinho. Quem pausou/reativou fica na trilha de auditoria.
     */
    attendancePausedAt: eventTimestamp('attendance_paused_at'),

    /**
     * Até quando a equipe já leu a conversa deste titular na aba "Conversas". Mensagem
     * recebida DEPOIS disso conta como "não lida" (selo verde na lista). Ponteiro único,
     * compartilhado: se um profissional leu, os demais veem como lida. `NULL` = nunca lida.
     */
    conversationReadAt: eventTimestamp('conversation_read_at'),

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
