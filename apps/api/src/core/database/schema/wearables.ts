/**
 * Conexões com plataformas de treino (hoje só o Strava). Os tokens OAuth do atleta são
 * credenciais de terceiros: ficam cifrados (`HealthCipherService.encryptText`), nunca em log.
 */
import { pgTable, uniqueIndex, varchar, text } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { users } from './users';

export const wearableConnections = pgTable(
  'wearable_connections',
  {
    id: primaryKeyColumn(),
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 16 }).notNull().default('STRAVA'),
    /** Id do atleta no Strava (chega no webhook como `owner_id`). */
    athleteId: varchar('athlete_id', { length: 24 }).notNull(),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token').notNull(),
    expiresAt: eventTimestamp('expires_at').notNull(),
    ...timestampColumns,
  },
  (t) => [
    uniqueIndex('uq_wearable_connections_user').on(t.userId, t.provider),
    uniqueIndex('uq_wearable_connections_athlete').on(t.provider, t.athleteId),
  ],
);
