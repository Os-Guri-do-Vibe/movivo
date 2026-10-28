import { migrationPostgresTls } from '../src/core/database/postgres-tls';
/**
 * Teste-semente (b) — migração num Postgres LIMPO (US-0.8 / TASK-0.8.3, valida US-0.4).
 *
 * Não basta checar que as 9 tabelas existem no banco de dev (que já foi migrado ao vivo):
 * isso não provaria que `0000_init` aplica-se do zero. Este teste cria um banco
 * **descartável** dentro do Postgres do Compose, aplica a migração versionada nele com a
 * role `movivo_migrator` e só então confere todas as tabelas de domínio. Ao final, derruba o banco.
 *
 * Extensões (`vector`, `uuid-ossp`, `pgcrypto`) são criadas pelo superusuário — `pgvector`
 * não é uma extensão "trusted", então `movivo_migrator` não poderia criá-la sozinha; no
 * fluxo real quem as instala é o init do container (infra/postgres/init/01-extensions.sql).
 * Aqui reproduzimos essa pré-condição antes de migrar.
 *
 * Pré-requisito: `pnpm run infra:up`.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/core/config/load-env';
import {
  buildAuditIntegritySql,
  buildProfessionalAccessSql,
} from '../src/core/database/security-policies';

/**
 * Tabelas esperadas no schema `public` depois de todas as migrações: o schema v2 inteiro mais
 * os arquivos somente leitura do legado (`legacy_*_archive`, retidos por 5 anos).
 */
const EXPECTED_TABLES = [
  // Cadastro, consentimento e acesso.
  'users',
  'staff',
  'anamnesis_sessions',
  'consents',
  'auth_sessions',
  'audit_logs',
  'user_status_transitions',
  'access_link_tokens',
  'training_access_tokens',
  'short_links',
  // Conversa e assinatura.
  'conversations',
  'subscriptions',
  'payments',
  // Financeiro e parceiros.
  'expenses',
  'model_pricing',
  'ad_spend',
  'partners',
  // Configuração segura da IA e Base de Conhecimento.
  'faq_entries',
  'ai_guardrail_rules',
  'ai_forbidden_topics',
  'knowledge_base',
  'knowledge_documents',
  'knowledge_document_blobs',
  'knowledge_document_reviews',
  'knowledge_document_events',
  'knowledge_document_extractions',
  'knowledge_staged_chunks',
  'knowledge_chunk_embeddings',
  // Catálogo de exercícios (global).
  'exercise_catalog_entries',
  'exercise_catalog_favorites',
  // Estado do Aluno.
  'student_profiles',
  'student_health_records',
  'student_goals',
  'goal_milestones',
  'goal_tasks',
  'student_constraints',
  'student_preferences',
  'student_observations',
  'student_state_snapshots',
  // Treino integrado (plano × sessão × agenda × execução).
  'training_plans',
  'plan_sessions',
  'scheduled_sessions',
  'session_executions',
  'execution_sets',
  'execution_metrics',
  // Nutrição (food_items é a base global de alimentos), corpo e check-ins adaptativos.
  'nutrition_plans',
  'food_items',
  'food_logs',
  'body_measurements',
  'body_photos',
  'body_assessments',
  'check_ins',
  'weekly_reviews',
  // Trilha de decisões, fila por exceção e outbox de eventos de domínio.
  'coaching_proposals',
  'coaching_decisions',
  'decision_executions',
  'safety_events',
  'exception_cases',
  'domain_events',
  'domain_event_receipts',
  // Gateway de modelos: rotas por tier (global) e registro de cada chamada.
  'model_tiers',
  'model_runs',
  // Execuções da avaliação das tarefas de agente (global).
  'eval_runs',
  // Estúdio de metodologia: documentos por domínio, versionados (global).
  'methodology_documents',
  // Arquivo somente leitura do legado, gerado pela migração de corte.
  'legacy_protocols_archive',
  'legacy_protocol_versions_archive',
  'legacy_protocol_renewal_sessions_archive',
  'legacy_protocol_substitution_requests_archive',
  'legacy_checkins_archive',
  'legacy_handoff_alerts_archive',
  'legacy_conversation_followups_archive',
  'legacy_coaching_sessions_archive',
  'legacy_workout_sessions_archive',
  'legacy_workout_set_entries_archive',
  'legacy_workout_completions_archive',
  'legacy_workout_insights_archive',
  'legacy_workout_schedule_adjustments_archive',
  'legacy_professional_assignments_archive',
  'legacy_agent_config_archive',
  'legacy_methodology_versions_archive',
  'legacy_methodology_events_archive',
  'legacy_conversation_protocol_links_archive',
] as const;

const REQUIRED_EXTENSIONS = ['vector', 'uuid-ossp', 'pgcrypto'] as const;

const apiRoot = process.cwd();
const { env } = loadEnv();

const host = env.MIGRATION_DATABASE_HOST ?? env.DATABASE_HOST ?? 'localhost';
const port = Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432);
const migratorUser = env.MIGRATION_DATABASE_USER ?? 'movivo_migrator';
const migratorPassword = env.MIGRATION_DATABASE_PASSWORD;
// Role de runtime (NÃO-dona). Os builders REVOGAM INSERT/UPDATE em consents/audit_logs do
// appRole; passar o migrador (dono das funções SECURITY DEFINER) revogaria dele mesmo e
// quebraria as próprias funções. Em produção o appRole é `movivo_app` — espelhamos isso.
const appRole = env.DATABASE_USER ?? 'movivo_app';

// O superusuário instala extensões não-trusted e cria/derruba o banco descartável.
// Senha lida direto do Docker Secret (fora do schema de env da aplicação). Strip de BOM
// (U+FEFF) protege contra um secret editado à mão no Windows.
const superUser = 'postgres';
const superPassword = readFileSync(
  resolve(apiRoot, '..', '..', 'secrets', 'desenvolvimento', 'postgres_superuser_password'),
  'utf8',
).trimEnd();

const throwawayDb = `movivo_it_${Date.now()}`;

function connect(database: string, user: string, password: string | undefined) {
  return postgres({
    host,
    ssl: migrationPostgresTls(env, host),
    port,
    user,
    password,
    database,

    max: 1,
    idle_timeout: 5,
    onnotice: () => {
      /* notices do Postgres podem conter valores — nunca vão para o log do teste. */
    },
  });
}

beforeAll(async () => {
  const admin = connect('postgres', superUser, superPassword);
  try {
    await admin.unsafe(`CREATE DATABASE "${throwawayDb}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }

  // Prepara o banco limpo: extensões + posse do schema para o migrador (espelha o init).
  const setup = connect(throwawayDb, superUser, superPassword);
  try {
    for (const ext of REQUIRED_EXTENSIONS) {
      await setup.unsafe(`CREATE EXTENSION IF NOT EXISTS "${ext}"`);
    }
    await setup.unsafe(`ALTER SCHEMA public OWNER TO "${migratorUser}"`);
    await setup.unsafe(`GRANT ALL ON SCHEMA public TO "${migratorUser}"`);
    await setup.unsafe(`GRANT CREATE ON DATABASE "${throwawayDb}" TO "${migratorUser}"`);
  } finally {
    await setup.end({ timeout: 5 });
  }
}, 60_000);

afterAll(async () => {
  const admin = connect('postgres', superUser, superPassword);
  try {
    // Encerra conexões remanescentes antes do DROP.
    await admin.unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${throwawayDb}' AND pid <> pg_backend_pid()`,
    );
    await admin.unsafe(`DROP DATABASE IF EXISTS "${throwawayDb}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }
});

describe('migração versionada num Postgres limpo', () => {
  it('aplica todas as migrações como movivo_migrator e cria exatamente as tabelas esperadas', async () => {
    const client = connect(throwawayDb, migratorUser, migratorPassword);
    try {
      await migrate(drizzle(client), { migrationsFolder: resolve(apiRoot, 'drizzle') });

      const rows = await client<{ table_name: string }[]>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `;
      const present = rows.map((r) => r.table_name);

      for (const table of EXPECTED_TABLES) {
        expect(present, `tabela ausente: ${table}`).toContain(table);
      }
      // Nenhuma tabela-base a mais no schema de domínio (o bookkeeping do drizzle
      // vive no schema `drizzle`, não em `public`).
      expect(present).toHaveLength(EXPECTED_TABLES.length);
    } finally {
      await client.end({ timeout: 5 });
    }
  });

  it('preserva os ciclos de consentimento revogado e reaceito', async () => {
    const client = connect(throwawayDb, migratorUser, migratorPassword);
    const holder = '70000000-0000-4000-8000-000000000001';
    const professional = '70000000-0000-4000-8000-000000000002';
    const session = '60000000-0000-4000-8000-000000000001';
    try {
      await client.unsafe(buildAuditIntegritySql(appRole));
      await client.unsafe(buildProfessionalAccessSql(appRole));
      await client`
        INSERT INTO users (id, phone_number, email, role)
        VALUES (${holder}::uuid, '+5555700000001', 'migration-holder-70@example.invalid', 'USER')
      `;
      await client`
        INSERT INTO staff (id, phone_number, email, role, password_hash, council_number, council_region, council_active)
        VALUES (${professional}::uuid, '+5555700000002', 'migration-professional-70@movivo.test',
                'PROFESSIONAL', 'x', '700001', 'SP', true)
      `;
      await client`
        INSERT INTO consents (user_id, consent_type, version, cycle, accepted)
        VALUES (${holder}::uuid, 'HEALTH_DATA', 'consent-health-2026-08-v3', 1, true)
      `;

      await client.begin(async (tx) => {
        await tx`SELECT set_config('app.current_role', 'USER', true)`;
        await tx`SELECT set_config('app.current_user_id', ${holder}, true)`;
        await tx`SELECT public.revoke_health_data_consent(${holder}::uuid)`;
      });

      await client`
        INSERT INTO anamnesis_sessions (id, token, status, expires_at)
        VALUES (${session}::uuid, 'consent-cycle-test', 'IN_PROGRESS', now() + interval '1 hour')
      `;
      await client.begin(async (tx) => {
        await tx`SELECT set_config('app.current_role', 'ANONYMOUS', true)`;
        await tx`SELECT set_config('app.current_anamnesis_session_id', ${session}, true)`;
        await tx`SELECT public.record_session_consent(
          ${session}::uuid, 'HEALTH_DATA'::consent_type,
          'consent-health-2026-08-v3', true, '203.0.113.10'::inet, 'migration-int-spec'
        )`;
      });
      await client.begin(async (tx) => {
        await tx`SELECT set_config('app.current_role', 'SYSTEM', true)`;
        await tx`SELECT public.link_session_consents_to_user(${session}::uuid, ${holder}::uuid)`;
      });

      const consentCycles = await client<
        { cycle: number; revokedAt: Date | null; accepted: boolean }[]
      >`
        SELECT cycle, revoked_at AS "revokedAt", accepted FROM consents
        WHERE user_id = ${holder}::uuid AND consent_type = 'HEALTH_DATA'
          AND version = 'consent-health-2026-08-v3'
        ORDER BY cycle
      `;
      expect(consentCycles).toHaveLength(2);
      expect(consentCycles[0]).toMatchObject({ cycle: 1, accepted: true });
      expect(consentCycles[0]?.revokedAt).toBeInstanceOf(Date);
      expect(consentCycles[1]).toMatchObject({ cycle: 2, accepted: true, revokedAt: null });

      const [audit] = await client<{ action: string; changes: Record<string, unknown> }[]>`
        SELECT action, changes FROM audit_logs
        WHERE user_id = ${holder}::uuid AND action = 'HEALTH_CONSENT_REVOKED'
        ORDER BY created_at DESC LIMIT 1
      `;
      expect(audit).toMatchObject({
        action: 'HEALTH_CONSENT_REVOKED',
        changes: { consentType: 'HEALTH_DATA', revoked: true },
      });
    } finally {
      await client.end({ timeout: 5 });
    }
  });
});

/**
 * Migração 0062 (2026-09-29, `levels` substitui `min_level` como seleção múltipla): aditiva,
 * com backfill no próprio .sql. Aplica as migrações ATÉ a 0061 num banco descartável próprio,
 * grava linhas no formato antigo (só `min_level`), aplica o resto e confere o mapeamento —
 * que preserva exatamente o comportamento anterior ("a partir de X").
 */
describe('migração 0062 — backfill de exercise_catalog_entries.levels', () => {
  const levelsDb = `${throwawayDb}_levels`;
  let partialFolder = '';

  beforeAll(async () => {
    const admin = connect('postgres', superUser, superPassword);
    try {
      await admin.unsafe(`CREATE DATABASE "${levelsDb}"`);
    } finally {
      await admin.end({ timeout: 5 });
    }
    const setup = connect(levelsDb, superUser, superPassword);
    try {
      for (const ext of REQUIRED_EXTENSIONS) {
        await setup.unsafe(`CREATE EXTENSION IF NOT EXISTS "${ext}"`);
      }
      await setup.unsafe(`ALTER SCHEMA public OWNER TO "${migratorUser}"`);
      await setup.unsafe(`GRANT ALL ON SCHEMA public TO "${migratorUser}"`);
      await setup.unsafe(`GRANT CREATE ON DATABASE "${levelsDb}" TO "${migratorUser}"`);
    } finally {
      await setup.end({ timeout: 5 });
    }
    // Pasta de migrações truncada: mesmo conteúdo, journal só até a 0061.
    partialFolder = mkdtempSync(join(tmpdir(), 'movivo-mig-0061-'));
    cpSync(resolve(apiRoot, 'drizzle'), partialFolder, { recursive: true });
    const journalPath = join(partialFolder, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { idx: number }[];
    };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 61);
    writeFileSync(journalPath, JSON.stringify(journal));
  }, 60_000);

  afterAll(async () => {
    rmSync(partialFolder, { recursive: true, force: true });
    const admin = connect('postgres', superUser, superPassword);
    try {
      await admin.unsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${levelsDb}' AND pid <> pg_backend_pid()`,
      );
      await admin.unsafe(`DROP DATABASE IF EXISTS "${levelsDb}"`);
    } finally {
      await admin.end({ timeout: 5 });
    }
  });

  it('linhas antigas ganham `levels` pelo mapeamento de min_level; min_level fica intacto', async () => {
    const client = connect(levelsDb, migratorUser, migratorPassword);
    try {
      await migrate(drizzle(client), { migrationsFolder: partialFolder });
      const [before] = await client<{ count: number }[]>`
        SELECT count(*)::int AS count FROM information_schema.columns
        WHERE table_name = 'exercise_catalog_entries' AND column_name = 'levels'`;
      expect(before?.count).toBe(0);

      for (const [key, minLevel] of [
        ['nivel_iniciante', 'INICIANTE'],
        ['nivel_intermediario', 'INTERMEDIARIO'],
        ['nivel_avancado', 'AVANCADO'],
      ] as const) {
        await client`
          INSERT INTO exercise_catalog_entries
            (exercise_key, name, pattern, muscle_groups, equipment, locations, min_level,
             contraindicated_for, substitutes, version, status, change_note)
          VALUES (${key}, ${key}, 'SQUAT', '["quadríceps"]'::jsonb, '[]'::jsonb,
                  '["HOME"]'::jsonb, ${minLevel}, '[]'::jsonb, '[]'::jsonb, 1, 'PUBLISHED',
                  'linha no formato anterior à 0062')`;
      }

      await migrate(drizzle(client), { migrationsFolder: resolve(apiRoot, 'drizzle') });

      const rows = await client<{ exercise_key: string; min_level: string; levels: string[] }[]>`
        SELECT exercise_key, min_level, levels FROM exercise_catalog_entries
        ORDER BY exercise_key`;
      expect(rows).toEqual([
        { exercise_key: 'nivel_avancado', min_level: 'AVANCADO', levels: ['AVANCADO'] },
        {
          exercise_key: 'nivel_iniciante',
          min_level: 'INICIANTE',
          levels: ['INICIANTE', 'INTERMEDIARIO', 'AVANCADO'],
        },
        {
          exercise_key: 'nivel_intermediario',
          min_level: 'INTERMEDIARIO',
          levels: ['INTERMEDIARIO', 'AVANCADO'],
        },
      ]);

      // Aditiva: `levels` nullable (API anterior pós-rollback grava sem ele) e `min_level`
      // continua NOT NULL.
      const columns = await client<{ column_name: string; is_nullable: string }[]>`
        SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_name = 'exercise_catalog_entries'
          AND column_name IN ('levels', 'min_level')
        ORDER BY column_name`;
      expect(columns).toEqual([
        { column_name: 'levels', is_nullable: 'YES' },
        { column_name: 'min_level', is_nullable: 'NO' },
      ]);
    } finally {
      await client.end({ timeout: 5 });
    }
  }, 60_000);
});
