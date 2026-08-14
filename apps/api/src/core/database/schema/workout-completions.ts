/**
 * Tabela `workout_completions` — o treino que o aluno **realmente fez** (US-8.1).
 *
 * Sete sprints sem essa tabela deixaram a North Star do produto (Treinos Concluídos
 * por Usuário Pago nos Primeiros 30 Dias, meta ≥8 — `08-relatorio-lucas.md`) sem
 * nenhuma medição: o sistema sabia que entregou o protocolo e que o aluno respondeu
 * o check-in, e **não sabia se ele treinou**.
 *
 * ## `completed_at` é `date`, não `timestamptz`
 * A constraint de unicidade pedida em TASK-8.1.2 é por (titular, **dia**, sessão).
 * Escrever isso sobre um `timestamptz` exigiria indexar `completed_at::date`, que é
 * `STABLE` (depende do GUC `TimeZone`) e **não** pode compor índice no PostgreSQL.
 * Guardar o dia civil já materializado como `date` resolve o índice, remove a classe
 * inteira de bug de fuso e é exatamente a granularidade do dado: quem responde
 * "Treinei ✅" está afirmando um dia, não um instante. O instante do registro
 * continua existindo em `created_at` — os dois nunca coincidem por definição
 * (o check-in atribui a data ao dia previsto do protocolo, não à data da resposta).
 *
 * ## Precedência de fonte na colisão
 * A ordem de declaração de `workout_completion_source` **é** a ordem de precedência:
 * enum nativo compara pelo ordinal de declaração, então `WHATSAPP_QUICK_REPLY <
 * CHECKIN < CONVERSATION` no operador `<` do próprio Postgres. O upsert resolve o
 * conflito com `where source > excluded.source` — sem coluna de rank paralela, sem
 * CASE no SQL de escrita. Ver `WorkoutCompletionService.record`.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  jsonb,
  pgTable,
  smallint,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { workoutCompletionSourceEnum } from './enums';
import { protocols } from './protocols';
import { users } from './users';

export const workoutCompletions = pgTable(
  'workout_completions',
  {
    id: primaryKeyColumn(),

    /** `RESTRICT`: compõe o histórico de acompanhamento supervisionado, como `checkins`. */
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    protocolId: uuid('protocol_id')
      .notNull()
      .references(() => protocols.id, { onDelete: 'restrict' }),

    /** Versão do protocolo vigente no dia do treino — o protocolo evolui, o registro não. */
    protocolVersion: smallint('protocol_version').notNull(),

    /** Semana do protocolo (1..`protocols.total_weeks`). */
    weekNumber: smallint('week_number').notNull(),

    /** Sessão do protocolo (`ProtocolSession.dayLabel`, ex.: `A`/`B`/`C`). */
    sessionKey: varchar('session_key', { length: 60 }).notNull(),

    /** Dia civil do treino. Distinto de `created_at` — ver cabeçalho. */
    completedAt: date('completed_at').notNull(),

    source: workoutCompletionSourceEnum('source').notNull(),

    /** Opcional: exercícios efetivamente executados, quando a fonte souber informar. */
    exercisesDone: jsonb('exercises_done'),

    /** Opcional: percepção de esforço 1–10 (escala de Borg CR10), validada no banco. */
    perceivedEffort: smallint('perceived_effort'),

    ...timestampColumns,
  },
  (table) => [
    // Dedupe (TASK-8.1.2, regra 1): dois canais reportando o mesmo treino = 1 linha.
    // Serve também como índice da janela de 30 dias por aluno — `(user_id, completed_at)`
    // é prefixo desta chave, então um índice extra por titular seria redundante.
    unique('uq_workout_completions_user_day_session').on(
      table.userId,
      table.completedAt,
      table.sessionKey,
    ),
    // Coorte da North Star: varre a janela por data cruzando todos os titulares.
    index('idx_workout_completions_completed_at').on(table.completedAt),
    check(
      'ck_workout_completions_perceived_effort',
      sql`${table.perceivedEffort} is null or ${table.perceivedEffort} between 1 and 10`,
    ),
  ],
);

export type WorkoutCompletionRow = typeof workoutCompletions.$inferSelect;
export type NewWorkoutCompletionRow = typeof workoutCompletions.$inferInsert;
