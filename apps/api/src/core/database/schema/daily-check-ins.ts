/**
 * Check-in do dia: o que os agentes precisam para entender o dia a dia do aluno (disposição,
 * sono, corpo, estresse, ânimo e alimentação). Uma linha por aluno e dia; vem do fechamento do
 * treino ou do toque em um dia de descanso. Dor fica no treino (`session_executions`).
 */
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

import { primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { users } from './users';

export const dailyCheckIns = pgTable(
  'daily_check_ins',
  {
    id: primaryKeyColumn(),
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    onDate: date('on_date').notNull(),
    /** 1 = pior, 5 = melhor (corpo: 1 = muito dolorido, estresse: 1 = sem estresse). */
    energy: smallint('energy'),
    sleep: smallint('sleep'),
    soreness: smallint('soreness'),
    mood: smallint('mood'),
    stress: smallint('stress'),
    /** Alimentação do dia em relação ao plano: ON_TRACK, PARTIAL ou OFF. */
    nutrition: varchar('nutrition', { length: 10 }),
    /** Água registrada no dia (ml), somada a cada registro pelo WhatsApp. */
    waterMl: integer('water_ml'),
    /** De onde veio: fechamento do treino (`SESSION`) ou dia de descanso (`DAILY`). */
    source: varchar('source', { length: 8 }).notNull(),
    ...timestampColumns,
  },
  (t) => [
    unique('uq_daily_check_ins_day').on(t.userId, t.onDate),
    index('idx_daily_check_ins_user').on(t.userId, t.onDate),
    check(
      'ck_daily_check_ins_scales',
      sql`(${t.energy} is null or ${t.energy} between 1 and 5)
        and (${t.sleep} is null or ${t.sleep} between 1 and 5)
        and (${t.soreness} is null or ${t.soreness} between 1 and 5)
        and (${t.mood} is null or ${t.mood} between 1 and 5)
        and (${t.stress} is null or ${t.stress} between 1 and 5)`,
    ),
    check(
      'ck_daily_check_ins_nutrition',
      sql`${t.nutrition} is null or ${t.nutrition} in ('ON_TRACK', 'PARTIAL', 'OFF')`,
    ),
    check(
      'ck_daily_check_ins_water',
      sql`${t.waterMl} is null or ${t.waterMl} between 0 and 15000`,
    ),
    check('ck_daily_check_ins_source', sql`${t.source} in ('SESSION', 'DAILY')`),
  ],
);
