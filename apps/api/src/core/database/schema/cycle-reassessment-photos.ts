/**
 * Fotos da reavaliação de fim de ciclo: as mesmas quatro posições da anamnese, para comparar o
 * começo com o agora. Dado de saúde: o conteúdo vai CIFRADO (`HealthCipherService`) e só existe
 * com o consentimento próprio `BODY_PHOTOS` vigente; revogar apaga as fotos junto.
 */
import { photoAngleSchema } from '@movivo/shared';
import { integer, pgTable, unique, uuid, varchar } from 'drizzle-orm/pg-core';

import { bytea, checkOneOf, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { PHOTO_FORMATS } from './anamnesis-session-photos';
import { cycleReassessments } from './cycle-reassessments';
import { users } from './users';

/** Prefixo do `body_photos.storage_path` que aponta para uma foto guardada aqui. */
export const REASSESSMENT_PHOTO_PATH_PREFIX = 'reassessment-photo:';

export const cycleReassessmentPhotos = pgTable(
  'cycle_reassessment_photos',
  {
    id: primaryKeyColumn(),
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reassessmentId: uuid('reassessment_id')
      .notNull()
      .references(() => cycleReassessments.id, { onDelete: 'cascade' }),
    angle: varchar('angle', { length: 8 }).notNull(),
    format: varchar('format', { length: 8 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** Imagem cifrada (a cifra recebe o arquivo em base64). */
    content: bytea('content').notNull(),
    ...timestampColumns,
  },
  (t) => [
    unique('uq_cycle_reassessment_photos_angle').on(t.reassessmentId, t.angle),
    checkOneOf('ck_cycle_reassessment_photos_angle', t.angle, photoAngleSchema.options),
    checkOneOf('ck_cycle_reassessment_photos_format', t.format, PHOTO_FORMATS),
  ],
);
