/**
 * Testes de `buildRlsPoliciesSql` (US-1.1 / TASK-1.1.2).
 *
 * Unitários sobre o SQL gerado: garantem que toda tabela de titular recebe
 * ENABLE **e** FORCE, que as políticas usam os GUCs corretos, que `consents`
 * é append-only (sem policy de DELETE) e que a anamnese cobre a fase anônima.
 * A aplicação real do SQL é provada pelo teste de migração/isolamento (int-spec).
 */
import { describe, expect, it } from 'vitest';

import { buildRlsPoliciesSql, RLS_TENANT_TABLES } from './security-policies';

describe('buildRlsPoliciesSql', () => {
  const sql = buildRlsPoliciesSql();

  it('cobre exatamente as tabelas de titular de Sprint 1', () => {
    expect(RLS_TENANT_TABLES).toEqual(['users', 'consents', 'anamnesis_sessions', 'auth_sessions']);
  });

  it('ativa ENABLE e FORCE ROW LEVEL SECURITY em toda tabela', () => {
    for (const table of RLS_TENANT_TABLES) {
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`);
    }
  });

  it('lê os GUCs sempre via nullif — vazio conta como ausente (fix de pooling)', () => {
    // Sob PgBouncer, um GUC customizado reverte para '' (não NULL) no backend
    // reusado; sem nullif, `IS NULL` daria falso e a fase anônima esconderia a
    // própria linha. As leituras cruas (sem nullif) não podem mais existir.
    expect(sql).toContain("nullif(current_setting('app.current_user_id', true), '')");
    expect(sql).toContain("nullif(current_setting('app.current_role', true), '')");
    expect(sql).not.toMatch(/[^(]current_setting\('app\.current_user_id', true\)(?!, '')/);
  });

  it('users ancora pela própria id e permite criação sem contexto (onboarding público)', () => {
    expect(sql).toContain(
      `CREATE POLICY "users_rls_select" ON "users" FOR SELECT USING (("id"::text = nullif(current_setting('app.current_user_id', true), ''))`,
    );
    // INSERT liberado quando não há titular no contexto (criação anônima/sistema).
    expect(sql).toMatch(
      /CREATE POLICY "users_rls_insert" ON "users" FOR INSERT WITH CHECK \(nullif\(current_setting\('app.current_user_id', true\), ''\) IS NULL/,
    );
  });

  it('consents é append-only: NÃO gera policy de DELETE', () => {
    expect(sql).not.toContain('CREATE POLICY "consents_rls_delete"');
    // as demais tabelas têm DELETE (sistema/admin).
    expect(sql).toContain('CREATE POLICY "auth_sessions_rls_delete"');
  });

  it('anamnesis_sessions libera a fase anônima escopada por sessão (Sato — achado 1)', () => {
    // Órfã (user_id NULL + ANONYMOUS) só visível quando o GUC de sessão está
    // ausente (lookup por token) OU bate a própria linha — nunca a de outra sessão.
    expect(sql).toContain(
      `"user_id" IS NULL AND nullif(current_setting('app.current_role', true), '') = 'ANONYMOUS' AND (nullif(current_setting('app.current_anamnesis_session_id', true), '') IS NULL OR "id"::text = nullif(current_setting('app.current_anamnesis_session_id', true), ''))`,
    );
  });
});
