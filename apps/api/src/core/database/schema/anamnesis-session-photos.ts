/**
 * Fotos do corpo enviadas durante a anamnese (etapa opcional de medidas).
 *
 * A foto é dado de saúde: o conteúdo vai CIFRADO (`HealthCipherService`) e nunca é lido sem o
 * consentimento próprio `BODY_PHOTOS`. Na fase anônima a âncora é a sessão (mesma RLS dos
 * consentimentos); no envio da anamnese a linha é vinculada ao titular e vira `body_photos`.
 * Sessão expirada apaga as fotos junto.
 */
import { photoAngleSchema } from '@movivo/shared';
import { integer, pgTable, unique, uuid, varchar } from 'drizzle-orm/pg-core';

import { bytea, checkOneOf, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { anamnesisSessions } from './anamnesis-sessions';
import { users } from './users';

/** Formatos aceitos (reconhecidos pelos primeiros bytes do arquivo, não pelo que o cliente declara). */
export const PHOTO_FORMATS = ['jpeg', 'png', 'webp'] as const;
export type PhotoFormat = (typeof PHOTO_FORMATS)[number];

/** Prefixo do `body_photos.storage_path` que aponta para uma foto guardada cifrada neste banco. */
export const ANAMNESIS_PHOTO_PATH_PREFIX = 'anamnesis-photo:';

export const anamnesisSessionPhotos = pgTable(
  'anamnesis_session_photos',
  {
    id: primaryKeyColumn(),
    /** Nulo na fase anônima; preenchido quando a sessão vira titular. */
    userId: userIdColumn().references(() => users.id, { onDelete: 'cascade' }),
    anamnesisSessionId: uuid('anamnesis_session_id')
      .notNull()
      .references(() => anamnesisSessions.id, { onDelete: 'cascade' }),
    angle: varchar('angle', { length: 8 }).notNull(),
    format: varchar('format', { length: 8 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** Imagem cifrada (a cifra recebe o arquivo em base64). */
    content: bytea('content').notNull(),
    ...timestampColumns,
  },
  (t) => [
    unique('uq_anamnesis_session_photos_angle').on(t.anamnesisSessionId, t.angle),
    checkOneOf('ck_anamnesis_session_photos_angle', t.angle, photoAngleSchema.options),
    checkOneOf('ck_anamnesis_session_photos_format', t.format, PHOTO_FORMATS),
  ],
);
