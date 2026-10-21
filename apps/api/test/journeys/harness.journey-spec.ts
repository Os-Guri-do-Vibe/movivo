/**
 * Prova do próprio harness: as migrações (incluindo a 0075) sobem num Postgres real e o app
 * roda como `movivo_app`, sob RLS FORCE. Se isto falhar, as jornadas não provam nada.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type JourneyDatabase, startJourneyDatabase } from './support/pglite';

let db: JourneyDatabase;

beforeAll(async () => {
  db = await startJourneyDatabase();
});

afterAll(async () => {
  await db?.close();
});

describe('harness das jornadas (PGlite)', () => {
  it('aplica todas as migrações do journal, inclusive a 0075_agenda_flexivel', async () => {
    expect(db.migrations).toBeGreaterThanOrEqual(76);
    const columns = await db.admin.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns
          where table_name = 'workout_schedule_adjustments' order by ordinal_position`,
    );
    expect(columns.map((row) => row.column_name)).toEqual([
      'id',
      'user_id',
      'protocol_id',
      'kind',
      'source',
      'assignments',
      'dropped',
      'idempotency_key',
      'undone_at',
      'created_at',
      'updated_at',
    ]);
    const lateColumn = await db.admin.execute<{ column_default: string; is_nullable: string }>(
      sql`select column_default, is_nullable from information_schema.columns
          where table_name = 'workout_sessions' and column_name = 'logged_late'`,
    );
    expect(lateColumn[0]).toEqual({ column_default: 'false', is_nullable: 'NO' });
  });

  it('o app roda como movivo_app e a tabela nova está sob RLS FORCE', async () => {
    expect(db.rlsUnavailable).toBeNull();
    const [who] = await db.tenant.runAsSystem((tx) =>
      tx.execute<{ role: string }>(sql`select current_user as role`),
    );
    expect(who?.role).toBe('movivo_app');
    const [rls] = await db.admin.execute<{ enabled: boolean; forced: boolean }>(
      sql`select relrowsecurity as enabled, relforcerowsecurity as forced from pg_class
          where relname = 'workout_schedule_adjustments'`,
    );
    expect(rls).toEqual({ enabled: true, forced: true });
  });
});
