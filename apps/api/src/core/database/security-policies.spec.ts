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

  it('as políticas comparam pelo GUC de sessão (fail-closed com current_setting(...,true))', () => {
    expect(sql).toContain("current_setting('app.current_user_id', true)");
    expect(sql).toContain("current_setting('app.current_role', true)");
  });

  it('users ancora pela própria id e permite criação sem contexto (onboarding público)', () => {
    expect(sql).toContain(
      `CREATE POLICY "users_rls_select" ON "users" FOR SELECT USING (("id"::text = current_setting('app.current_user_id', true))`,
    );
    // INSERT liberado quando não há titular no contexto (criação anônima/sistema).
    expect(sql).toMatch(
      /CREATE POLICY "users_rls_insert" ON "users" FOR INSERT WITH CHECK \(current_setting\('app.current_user_id', true\) IS NULL/,
    );
  });

  it('consents é append-only: NÃO gera policy de DELETE', () => {
    expect(sql).not.toContain('CREATE POLICY "consents_rls_delete"');
    // as demais tabelas têm DELETE (sistema/admin).
    expect(sql).toContain('CREATE POLICY "auth_sessions_rls_delete"');
  });

  it('anamnesis_sessions libera a fase anônima (user_id NULL + role ANONYMOUS)', () => {
    expect(sql).toContain(
      `("user_id" IS NULL AND current_setting('app.current_role', true) = 'ANONYMOUS')`,
    );
  });
});
