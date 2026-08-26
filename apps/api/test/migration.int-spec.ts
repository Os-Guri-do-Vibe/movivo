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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
 * As 9 tabelas-base do schema lógico de Lucas (§9, US-0.4) + `auth_sessions`,
 * adicionada na US-1.1/TASK-1.1.5 (schema de refresh token para o AUTH).
 */
const EXPECTED_TABLES = [
  'users',
  'anamnesis_sessions',
  'consents',
  'protocols',
  'protocol_versions',
  'conversations',
  'checkins',
  'subscriptions',
  'ai_jobs',
  'auth_sessions',
  // Sprint 3 (US-3.2): memória de longo prazo da conversa.
  'coaching_sessions',
  // Sprint 3 (US-3.3): corpus curado do RAG (global, read-only).
  'knowledge_base',
  // Sprint 3 (US-3.4): exemplos rotulados do kNN de intenção (global, read-only).
  'intent_examples',
  // Sprint 3 (US-3.6): alertas/handoff ao painel CREF (dado de titular).
  'handoff_alerts',
  // Sprint 5: escopo profissional explicito, auditoria e reengajamento duravel.
  'professional_assignments',
  'audit_logs',
  'reengagement_nudges',
  // Sprint 7 (US-7.6): persona do agente, append-only.
  'agent_config',
  // Sprint 8: treino concluido (US-8.1), historico de estado (US-8.3), despesa e
  // preco de modelo versionado (US-8.4), pagamento liquidado (US-8.5), investimento
  // por canal (US-8.6) e cap table (US-8.7).
  'workout_completions',
  'user_status_transitions',
  'expenses',
  'model_pricing',
  'payments',
  'ad_spend',
  'partners',
  // Sprint 9: configuracao segura da IA e pipeline de curadoria do RAG.
  'faq_entries',
  'ai_guardrail_rules',
  'knowledge_documents',
  'knowledge_document_blobs',
  'knowledge_document_reviews',
  // Sprint 10: temas proibidos append-only, versionamento de metodologia CREF e o
  // pipeline completo de ingestao/staging/embeddings da Base de Conhecimento.
  'ai_forbidden_topics',
  'knowledge_document_events',
  'knowledge_document_extractions',
  'knowledge_staged_chunks',
  'knowledge_chunk_embeddings',
  'methodology_versions',
  'methodology_events',
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
  resolve(apiRoot, '..', '..', 'secrets', 'postgres_superuser_password'),
  'utf8',
).trimEnd();

const throwawayDb = `movivo_it_${Date.now()}`;

function connect(database: string, user: string, password: string | undefined) {
  return postgres({
    host,
    port,
    user,
    password,
    database,
    ssl: false,
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

  it('migra assinaturas legadas para CREF atribuido ou falha fechado antes da FK', async () => {
    const client = connect(throwawayDb, migratorUser, migratorPassword);
    const mappedHolder = '10000000-0000-4000-8000-000000000001';
    const blockedHolder = '10000000-0000-4000-8000-000000000002';
    const invalidRoleHolder = '10000000-0000-4000-8000-000000000003';
    const inactiveCrefHolder = '10000000-0000-4000-8000-000000000004';
    const professional = '20000000-0000-4000-8000-000000000001';
    const invalidSigner = '30000000-0000-4000-8000-000000000001';
    const inactiveSigner = '30000000-0000-4000-8000-000000000002';
    const orphanSigner = '40000000-0000-4000-8000-000000000001';
    try {
      await client.unsafe(
        'ALTER TABLE "protocols" DROP CONSTRAINT "protocols_professional_id_users_id_fk"',
      );
      await client`
        INSERT INTO users (id, phone_number, role, cref_number, cref_region, cref_active)
        VALUES
          (${mappedHolder}::uuid, '+5555100000001', 'USER', NULL, NULL, false),
          (${blockedHolder}::uuid, '+5555100000002', 'USER', NULL, NULL, false),
          (${invalidRoleHolder}::uuid, '+5555100000003', 'USER', NULL, NULL, false),
          (${inactiveCrefHolder}::uuid, '+5555100000004', 'USER', NULL, NULL, false),
          (${professional}::uuid, '+5555200000001', 'PROFESSIONAL', '123456', 'SP', true),
          (${invalidSigner}::uuid, '+5555300000001', 'USER', NULL, NULL, false),
          (${inactiveSigner}::uuid, '+5555300000002', 'PROFESSIONAL', '999999', 'SP', false)
      `;
      await client`
        INSERT INTO professional_assignments (professional_id, user_id)
        VALUES (${professional}::uuid, ${mappedHolder}::uuid),
               (${professional}::uuid, ${invalidRoleHolder}::uuid)
      `;
      await client`
        INSERT INTO protocols (
          id, user_id, status, approval_status, professional_id, signed_at,
          signature_hash, content, constraints, human_review_required,
          -- NOT NULL sem default desde a migração 0033.
          mesocycle_name, start_date, end_date
        ) VALUES
          ('50000000-0000-4000-8000-000000000001', ${mappedHolder}::uuid,
           'ACTIVE', 'AUTO_APPROVED', ${orphanSigner}::uuid, now(), repeat('a', 64), '{}', '{}', false,
           'Mesociclo 1 — Adaptação', now(), now() + interval '12 weeks'),
          ('50000000-0000-4000-8000-000000000002', ${blockedHolder}::uuid,
           'ACTIVE', 'AUTO_APPROVED', ${orphanSigner}::uuid, now(), repeat('b', 64), '{}', '{}', false,
           'Mesociclo 1 — Adaptação', now(), now() + interval '12 weeks'),
          ('50000000-0000-4000-8000-000000000003', ${invalidRoleHolder}::uuid,
           'ACTIVE', 'AUTO_APPROVED', ${invalidSigner}::uuid, now(), repeat('c', 64), '{}', '{}', false,
           'Mesociclo 1 — Adaptação', now(), now() + interval '12 weeks'),
          ('50000000-0000-4000-8000-000000000004', ${inactiveCrefHolder}::uuid,
           'ACTIVE', 'AUTO_APPROVED', ${inactiveSigner}::uuid, now(), repeat('d', 64), '{}', '{}', false,
           'Mesociclo 1 — Adaptação', now(), now() + interval '12 weeks')
      `;

      const migration = readFileSync(resolve(apiRoot, 'drizzle', '0015_calm_sage.sql'), 'utf8');
      await client.unsafe(migration);

      const rows = await client<
        {
          id: string;
          professionalId: string | null;
          status: string;
          approvalStatus: string;
          signedAt: Date | null;
          signatureHash: string | null;
          humanReviewRequired: boolean;
        }[]
      >`
        SELECT id, professional_id AS "professionalId", status,
          approval_status AS "approvalStatus", signed_at AS "signedAt",
          signature_hash AS "signatureHash", human_review_required AS "humanReviewRequired"
        FROM protocols WHERE id::text LIKE '50000000-%' ORDER BY id
      `;

      expect(rows[0]).toMatchObject({ professionalId: professional, status: 'ACTIVE' });
      expect(rows[1]).toMatchObject({
        professionalId: null,
        status: 'PENDING_SIGNATURE',
        approvalStatus: 'PENDING_REVIEW',
        signedAt: null,
        signatureHash: null,
        humanReviewRequired: true,
      });
      expect(rows[2]).toMatchObject({ professionalId: professional, status: 'ACTIVE' });
      expect(rows[3]).toMatchObject({
        professionalId: null,
        status: 'PENDING_SIGNATURE',
        approvalStatus: 'PENDING_REVIEW',
        humanReviewRequired: true,
      });
      await client`DELETE FROM protocols WHERE id::text LIKE '50000000-%'`;
      await client`DELETE FROM professional_assignments WHERE professional_id = ${professional}::uuid`;
      await client`
        DELETE FROM users WHERE id IN (
          ${mappedHolder}::uuid, ${blockedHolder}::uuid, ${invalidRoleHolder}::uuid,
          ${inactiveCrefHolder}::uuid, ${professional}::uuid, ${invalidSigner}::uuid,
          ${inactiveSigner}::uuid
        )
      `;
    } finally {
      await client.end({ timeout: 5 });
    }
  });

  it('preserva ciclos revogado e reaceito e reativa o vinculo CREF explicitamente', async () => {
    const client = connect(throwawayDb, migratorUser, migratorPassword);
    const holder = '70000000-0000-4000-8000-000000000001';
    const professional = '70000000-0000-4000-8000-000000000002';
    const session = '60000000-0000-4000-8000-000000000001';
    try {
      await client.unsafe(buildAuditIntegritySql(appRole));
      await client.unsafe(buildProfessionalAccessSql(appRole));
      await client`
        INSERT INTO users (id, phone_number, role, cref_number, cref_region, cref_active)
        VALUES
          (${holder}::uuid, '+5555700000001', 'USER', NULL, NULL, false),
          (${professional}::uuid, '+5555700000002', 'PROFESSIONAL', '700001', 'SP', true)
      `;
      await client`
        INSERT INTO professional_assignments (professional_id, user_id)
        VALUES (${professional}::uuid, ${holder}::uuid)
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

      const [revokedAssignment] = await client<{ active: boolean; revokedAt: Date | null }[]>`
        SELECT active, revoked_at AS "revokedAt" FROM professional_assignments
        WHERE professional_id = ${professional}::uuid AND user_id = ${holder}::uuid
      `;
      expect(revokedAssignment).toMatchObject({ active: false });
      expect(revokedAssignment?.revokedAt).toBeInstanceOf(Date);

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
        await tx`SELECT public.assign_unique_active_professional(${holder}::uuid)`;
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

      const [reactivatedAssignment] = await client<{ active: boolean; revokedAt: Date | null }[]>`
        SELECT active, revoked_at AS "revokedAt" FROM professional_assignments
        WHERE professional_id = ${professional}::uuid AND user_id = ${holder}::uuid
      `;
      expect(reactivatedAssignment).toEqual({ active: true, revokedAt: null });

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
