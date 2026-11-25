/**
 * Avaliação corporal opcional: medidas, fotos e análises visuais.
 *
 * Fotos ficam em armazenamento privado (só o caminho vive aqui), com consentimento próprio
 * (`consent_id`). Análises guardam FAIXA e incerteza; observações posturais são pontos para
 * avaliação profissional, nunca diagnóstico. Apagar a foto (`deleted_at`) não apaga a análise
 * já feita, que só referencia o id.
 */
import { sql } from 'drizzle-orm';
import { date, index, jsonb, numeric, pgTable, uuid, varchar } from 'drizzle-orm/pg-core';

import {
  measurementKindSchema,
  measurementMethodSchema,
  photoAngleSchema,
  type BodyAssessmentResult,
  type PhotoQuality,
} from '@movivo/shared';

import {
  checkOneOf,
  eventTimestamp,
  primaryKeyColumn,
  timestampColumns,
  userIdColumn,
} from './_shared';
import { consents } from './consents';
import { users } from './users';

const ownerColumn = () =>
  userIdColumn()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

export const bodyMeasurements = pgTable(
  'body_measurements',
  {
    id: primaryKeyColumn(),
    userId: ownerColumn(),
    kind: varchar('kind', { length: 24 }).notNull(),
    value: numeric('value', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    method: varchar('method', { length: 16 }).notNull(),
    measuredOn: date('measured_on').notNull(),
    ...timestampColumns,
  },
  (t) => [
    index('idx_body_measurements_user_kind').on(t.userId, t.kind, t.measuredOn),
    checkOneOf('ck_body_measurements_kind', t.kind, measurementKindSchema.options),
    checkOneOf('ck_body_measurements_method', t.method, measurementMethodSchema.options),
  ],
);

export const bodyPhotos = pgTable(
  'body_photos',
  {
    id: primaryKeyColumn(),
    userId: ownerColumn(),
    angle: varchar('angle', { length: 8 }).notNull(),
    takenOn: date('taken_on').notNull(),
    storagePath: varchar('storage_path', { length: 120 }).notNull(),
    consentId: uuid('consent_id')
      .notNull()
      .references(() => consents.id, { onDelete: 'restrict' }),
    quality: jsonb('quality').$type<PhotoQuality>(),
    deletedAt: eventTimestamp('deleted_at'),
    ...timestampColumns,
  },
  (t) => [
    index('idx_body_photos_user_active')
      .on(t.userId, t.takenOn)
      .where(sql`${t.deletedAt} is null`),
    checkOneOf('ck_body_photos_angle', t.angle, photoAngleSchema.options),
  ],
);

export const bodyAssessments = pgTable(
  'body_assessments',
  {
    id: primaryKeyColumn(),
    userId: ownerColumn(),
    assessedOn: date('assessed_on').notNull(),
    photoIds: jsonb('photo_ids').$type<string[]>().notNull(),
    result: jsonb('result').$type<BodyAssessmentResult>().notNull(),
    /** Execução de modelo que produziu a análise (rastreabilidade de versão e custo). */
    modelRunId: uuid('model_run_id'),
    ...timestampColumns,
  },
  (t) => [index('idx_body_assessments_user').on(t.userId, t.assessedOn)],
);
