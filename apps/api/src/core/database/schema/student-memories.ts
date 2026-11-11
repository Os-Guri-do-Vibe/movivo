/**
 * Memória do aluno: o que os agentes sabem sobre ele além dos números (rotina, o que o motiva,
 * barreiras, contexto de vida, jeito de conversar, marcos). Cada linha é um fato curto, dele e só
 * dele; a leitura sempre filtra por `user_id` e roda sob FORCE RLS. O texto é cifrado
 * (`HealthCipherService`) porque pode conter dado de saúde. Fato que deixa de valer ganha
 * `retired_at` em vez de ser apagado: o histórico mostra como o acompanhamento evoluiu.
 */
import { index, pgTable, smallint, varchar } from 'drizzle-orm/pg-core';

import {
  bytea,
  checkOneOf,
  eventTimestamp,
  primaryKeyColumn,
  timestampColumns,
  userIdColumn,
} from './_shared';
import { users } from './users';

export const MEMORY_KINDS = [
  'ROUTINE',
  'MOTIVATION',
  'BARRIER',
  'PREFERENCE',
  'PERSONAL',
  'HEALTH_CONTEXT',
  'COMMUNICATION',
  'MILESTONE',
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_ORIGINS = [
  'CONVERSATION',
  'WORKOUT',
  'CHECK_IN',
  'REASSESSMENT',
  'AGENT',
] as const;
export type MemoryOrigin = (typeof MEMORY_ORIGINS)[number];

export const studentMemories = pgTable(
  'student_memories',
  {
    id: primaryKeyColumn(),
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 16 }).notNull(),
    /** O fato, em uma frase (cifrado). Nunca logar conteúdo. */
    content: bytea('content').notNull(),
    /** 1 = detalhe, 2 = relevante, 3 = essencial para o acompanhamento. */
    importance: smallint('importance').notNull().default(2),
    origin: varchar('origin', { length: 16 }).notNull(),
    recordedAt: eventTimestamp('recorded_at').notNull().defaultNow(),
    /** Última vez que um agente usou o fato no contexto. */
    lastUsedAt: eventTimestamp('last_used_at'),
    /** O fato deixou de valer (mudou, foi corrigido pelo aluno ou ficou velho). */
    retiredAt: eventTimestamp('retired_at'),
    ...timestampColumns,
  },
  (t) => [
    index('idx_student_memories_user').on(t.userId, t.retiredAt),
    checkOneOf('ck_student_memories_kind', t.kind, MEMORY_KINDS),
    checkOneOf('ck_student_memories_origin', t.origin, MEMORY_ORIGINS),
  ],
);
