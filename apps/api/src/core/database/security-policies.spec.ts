/**
 * Testes de `buildRlsPoliciesSql` (US-1.1 / TASK-1.1.2).
 *
 * Unitários sobre o SQL gerado: garantem que toda tabela de titular recebe
 * ENABLE **e** FORCE, que as políticas usam os GUCs corretos, que `consents`
 * é append-only (sem policy de DELETE) e que a anamnese cobre a fase anônima.
 * A aplicação real do SQL é provada pelo teste de migração/isolamento (int-spec).
 */
import { describe, expect, it } from 'vitest';

import {
  buildAiForbiddenTopicsImmutabilitySql,
  buildFaqEntriesImmutabilitySql,
  buildAiGuardrailRulesImmutabilitySql,
  buildKnowledgeDocumentsSecuritySql,
  buildRlsPoliciesSql,
  RLS_TENANT_TABLES,
} from './security-policies';

describe('buildAiForbiddenTopicsImmutabilitySql', () => {
  const sql = buildAiForbiddenTopicsImmutabilitySql('movivo_app');

  it('impede UPDATE, DELETE e TRUNCATE na trilha de temas proibidos', () => {
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON public.ai_forbidden_topics');
    expect(sql).toContain('BEFORE TRUNCATE ON public.ai_forbidden_topics');
    expect(sql).toContain('REVOKE UPDATE, DELETE, TRUNCATE ON public.ai_forbidden_topics');
    expect(sql).toContain('GRANT SELECT, INSERT ON public.ai_forbidden_topics');
  });
});

describe('buildKnowledgeDocumentsSecuritySql', () => {
  const sql = buildKnowledgeDocumentsSecuritySql('movivo_app');

  it('aceita revisão aprovada por ADMIN ou profissional CREF ativo', () => {
    expect(sql).toContain("reviewer.role = 'ADMIN'");
    expect(sql).toContain("reviewer.role = 'PROFESSIONAL' AND reviewer.council_active = true");
  });
});

describe('buildRlsPoliciesSql', () => {
  const sql = buildRlsPoliciesSql();

  it('cobre exatamente as tabelas de titular', () => {
    expect(RLS_TENANT_TABLES).toEqual([
      'users',
      // Conta da Plataforma Interna (login, dashboard) — não é dado de titular.
      'staff',
      'consents',
      'anamnesis_sessions',
      'auth_sessions',
      'subscriptions',
      'conversations',
      'audit_logs',
      'access_link_tokens',
      'training_access_tokens',
      'user_status_transitions',
      // US-8.5 — liquidacao recebida do gateway, dado financeiro do titular.
      'payments',
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
      // Treino integrado.
      'training_plans',
      'plan_sessions',
      'scheduled_sessions',
      'session_executions',
      'execution_sets',
      'execution_metrics',
      // Nutrição, corpo e check-ins.
      'nutrition_plans',
      'food_logs',
      'body_measurements',
      'body_photos',
      'body_assessments',
      'check_ins',
      'weekly_reviews',
      // Trilha de decisões, fila por exceção e outbox.
      'coaching_proposals',
      'coaching_decisions',
      'decision_executions',
      'safety_events',
      'exception_cases',
      'domain_events',
      'model_runs',
    ]);
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

  it('cadastro de alunos e staff exige SYSTEM/ADMIN, nunca contexto ausente ou autocadastro', () => {
    for (const table of ['users', 'staff']) {
      const insert = sql
        .split(';')
        .find((statement) => statement.includes(`CREATE POLICY "${table}_rls_insert"`));
      expect(insert).toContain("= 'SYSTEM'");
      expect(insert).toContain("= 'ADMIN'");
      expect(insert).not.toContain('IS NULL');
      expect(insert).not.toContain('current_user_id');
    }
  });

  it('escrita de registros filhos exige o mesmo titular do recurso-pai', () => {
    for (const [table, parent, column] of [
      ['payments', 'subscriptions', 'subscription_id'],
      ['goal_milestones', 'student_goals', 'goal_id'],
      ['goal_tasks', 'student_goals', 'goal_id'],
      ['plan_sessions', 'training_plans', 'plan_id'],
      ['scheduled_sessions', 'training_plans', 'plan_id'],
      ['scheduled_sessions', 'plan_sessions', 'plan_session_id'],
      ['execution_sets', 'session_executions', 'execution_id'],
      ['execution_metrics', 'session_executions', 'execution_id'],
      ['coaching_decisions', 'coaching_proposals', 'proposal_id'],
      ['decision_executions', 'coaching_decisions', 'decision_id'],
    ]) {
      for (const operation of ['insert', 'update']) {
        const policy = sql
          .split(';')
          .find((statement) => statement.includes(`CREATE POLICY "${table}_rls_${operation}"`));
        expect(policy).toContain(`FROM "${parent}" owner`);
        expect(policy).toContain(`owner.id = "${table}"."${column}"`);
        expect(policy).toContain(`owner.user_id = "${table}"."user_id"`);
      }
    }
  });

  it('consents é append-only: NÃO gera policy de DELETE', () => {
    expect(sql).not.toContain('CREATE POLICY "consents_rls_delete"');
    // as demais tabelas têm DELETE (sistema/admin).
    expect(sql).toContain('CREATE POLICY "auth_sessions_rls_delete"');
    const consentSelect = sql
      .split(';')
      .find((statement) => statement.includes('CREATE POLICY "consents_rls_select"'));
    expect(consentSelect).not.toContain("= 'PROFESSIONAL'");
    expect(consentSelect).toContain("= 'SYSTEM'");
    expect(consentSelect).toContain("= 'ADMIN'");
  });

  it('retira titulares sem consentimento vigente de todo acesso profissional operacional', () => {
    const usersSelect = sql
      .split(';')
      .find((statement) => statement.includes('CREATE POLICY "users_rls_select"'));
    expect(usersSelect).toContain('public.has_active_health_consent("users"."id")');
    const plansUpdate = sql
      .split(';')
      .find((statement) => statement.includes('CREATE POLICY "training_plans_rls_update"'));
    expect(plansUpdate).toContain('public.has_active_health_consent("training_plans"."user_id")');
  });

  // A fila é do CARGO, não da pessoa: qualquer profissional ativo acessa todo titular com
  // consentimento de saúde vigente.
  it('acesso profissional depende só do papel e do consentimento de saúde', () => {
    const plansSelect = sql
      .split(';')
      .find((statement) => statement.includes('CREATE POLICY "training_plans_rls_select"'));
    expect(plansSelect).toContain("= 'PROFESSIONAL' AND public.has_active_health_consent");
    expect(sql).not.toContain('professional_assignments');
  });

  it('lookup anônimo exige token e consentimentos exigem sessão conhecida', () => {
    const sessionRead = sql
      .split(';')
      .find((statement) => statement.includes('CREATE POLICY "anamnesis_sessions_rls_select"'));
    expect(sessionRead).toContain("current_setting('app.current_anamnesis_token', true)");
    expect(sessionRead).not.toContain("current_anamnesis_session_id', true), '') IS NULL");
    const consentRead = sql
      .split(';')
      .find((statement) => statement.includes('CREATE POLICY "consents_rls_select"'));
    expect(consentRead).toContain("current_setting('app.current_anamnesis_session_id', true)");
    expect(consentRead).not.toContain('current_anamnesis_token');
    expect(consentRead).not.toContain("current_anamnesis_session_id', true), '') IS NULL");
  });

  it('admin só grava auditoria em nome do próprio ator autenticado', () => {
    // A policy generica do loop de TenantTable cria um "audit_logs_rls_insert"
    // permissivo primeiro; o DROP + CREATE explicito mais abaixo (linha 266-267 de
    // security-policies.ts) o substitui em runtime. `findLast` pega a versao que
    // efetivamente vale apos a execucao sequencial do `sql.unsafe`.
    const policy = sql
      .split(';')
      .findLast((statement) => statement.includes('CREATE POLICY "audit_logs_rls_insert"'));
    expect(policy).toContain(
      "actor_id::text = nullif(current_setting('app.current_user_id', true), '') AND nullif(current_setting('app.current_role', true), '') = 'ADMIN'",
    );
    expect(policy).not.toMatch(/OR nullif\(current_setting\('app\.current_role'.*\) = 'ADMIN'\)$/);
  });
});

describe('buildFaqEntriesImmutabilitySql', () => {
  const sql = buildFaqEntriesImmutabilitySql('movivo_app');

  it('combina trigger 55000 com revogação das mutações destrutivas', () => {
    expect(sql).toContain("RAISE EXCEPTION 'faq_entries is append-only' USING ERRCODE = '55000'");
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON public.faq_entries');
    expect(sql).toContain('BEFORE TRUNCATE ON public.faq_entries');
    expect(sql).toContain('REVOKE UPDATE, DELETE, TRUNCATE ON public.faq_entries FROM movivo_app');
    expect(sql).toContain('GRANT SELECT, INSERT ON public.faq_entries TO movivo_app');
  });
});

describe('buildAiGuardrailRulesImmutabilitySql', () => {
  const sql = buildAiGuardrailRulesImmutabilitySql('movivo_app');

  it('combina trigger 55000 e revogação da role de runtime', () => {
    expect(sql).toContain(
      "RAISE EXCEPTION 'ai_guardrail_rules is append-only' USING ERRCODE = '55000'",
    );
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON public.ai_guardrail_rules');
    expect(sql).toContain(
      'REVOKE UPDATE, DELETE, TRUNCATE ON public.ai_guardrail_rules FROM movivo_app',
    );
  });
});
