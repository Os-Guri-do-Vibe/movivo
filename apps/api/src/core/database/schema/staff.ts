/**
 * Tabela `staff` — contas da Plataforma Interna (login em `/entrar`, dashboard).
 *
 * Separada de `users` (o titular final) porque são conceitos que nunca deveriam
 * ter dividido tabela: `users` é quem treina, sem senha, identificado por telefone;
 * `staff` é quem opera a MOVIVO (o profissional CREF incluído), com e-mail+senha e
 * JWT via `POST /auth/login`. Toda coluna de auditoria (`created_by`, `actor_id`,
 * `approved_by`, `reviewed_by`, `uploaded_by`, `decided_by`) e `professional_id`
 * (`protocols`, `professional_assignments`) apontam para `staff.id` — só o `user_id`
 * (o titular) continua em `users.id`.
 */
import { boolean, pgTable, text, varchar } from 'drizzle-orm/pg-core';

import { primaryKeyColumn, timestampColumns } from './_shared';
import { staffRoleEnum, staffStatusEnum } from './enums';

export const staff = pgTable('staff', {
  id: primaryKeyColumn(),

  /** Identificador de login — sempre exigido (ao contrário de `users.email`, opcional). */
  email: varchar('email', { length: 255 }).notNull().unique(),

  /**
   * Telefone em E.164 — contato da própria conta, editável na tela "Minha Conta"
   * (`PATCH /account/profile`). Mesma obrigatoriedade de `users.phoneNumber` antes
   * da separação: preservar o contrato atual de `AccountProfileView.phoneNumber`
   * (sempre presente, nunca `null`).
   */
  phoneNumber: varchar('phone_number', { length: 20 }).notNull().unique(),

  /** Nome exibido no dashboard (cabeçalho, trilhas de auditoria). */
  name: varchar('name', { length: 255 }),

  /**
   * Caminho relativo do arquivo de foto de perfil no disco persistente da VPS —
   * mesma semântica de `users.avatarPath` antes da separação.
   */
  avatarPath: varchar('avatar_path', { length: 512 }),

  /** Hash Argon2id — sempre exigido (staff sempre loga por senha). */
  passwordHash: text('password_hash').notNull(),

  role: staffRoleEnum('role').notNull(),
  status: staffStatusEnum('status').notNull().default('ACTIVE'),

  /** Credencial profissional verificada — só relevante quando `role = 'PROFESSIONAL'`. */
  crefNumber: varchar('cref_number', { length: 30 }),
  crefRegion: varchar('cref_region', { length: 2 }),
  crefActive: boolean('cref_active').notNull().default(false),

  ...timestampColumns,
});

export type StaffRow = typeof staff.$inferSelect;
export type NewStaffRow = typeof staff.$inferInsert;
