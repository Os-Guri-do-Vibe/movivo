/**
 * Exames enviados pelo aluno no WhatsApp (PDF ou foto). Arquivo, leitura e comentário são
 * dado de saúde: tudo cifrado (`HealthCipherService`). O médico (CRM) da equipe lê pelo painel.
 */
import { index, pgTable, uuid, varchar } from 'drizzle-orm/pg-core';

import { medicalExamStatusSchema } from '@movivo/shared';

import { bytea, checkOneOf, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { users } from './users';

export const medicalExams = pgTable(
  'medical_exams',
  {
    id: primaryKeyColumn(),
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** `application/pdf` ou imagem (jpeg/png/webp). */
    mediaType: varchar('media_type', { length: 40 }).notNull(),
    /** Arquivo original cifrado. */
    file: bytea('file').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('RECEIVED'),
    /** `ExamReading` cifrado (JSON). */
    reading: bytea('reading'),
    /** `ExamComment` cifrado (JSON). */
    comment: bytea('comment'),
    exceptionCaseId: uuid('exception_case_id'),
    ...timestampColumns,
  },
  (t) => [
    index('idx_medical_exams_user').on(t.userId, t.createdAt),
    checkOneOf('ck_medical_exams_status', t.status, medicalExamStatusSchema.options),
  ],
);
