import { describe, expect, it } from 'vitest';

import {
  buildAuditIntegritySql,
  buildProfessionalAccessSql,
  buildRlsPoliciesSql,
} from './security-policies';

describe('controles de banco da Sprint 5', () => {
  // Achado 2026-08-19 (decisão do fundador): a fila de revisão é do CARGO, não da
  // pessoa — qualquer CREF ativo lê/edita titular com consentimento de saúde ativo,
  // sem depender de `professional_assignments` (que continua existindo só pra
  // atribuição nominal, ex.: `protocols.professionalId`).
  it('qualquer profissional le users/anamnese com consentimento ativo, mas nao recebe UPDATE amplo', () => {
    const sql = buildRlsPoliciesSql();
    expect(sql).toContain("= 'PROFESSIONAL' AND public.has_active_health_consent");
    const usersUpdate = sql
      .split(';')
      .find((statement) => statement.includes('CREATE POLICY "users_rls_update"'));
    const anamnesisUpdate = sql
      .split(';')
      .find((statement) => statement.includes('CREATE POLICY "anamnesis_sessions_rls_update"'));
    expect(usersUpdate).not.toContain('professional_assignments');
    expect(anamnesisUpdate).not.toContain('professional_assignments');
    // Leitura/escrita de titular não passa mais por EXISTS em professional_assignments.
    const usersSelect = sql
      .split(';')
      .find((statement) => statement.includes('CREATE POLICY "users_rls_select"'));
    expect(usersSelect).not.toContain('professional_assignments');
    // has_active_health_consent tem seu PRÓPRIO gate de ator (chamado de dentro da
    // policy) — sem soltar o EXISTS aqui também, ele travaria de volta o acesso que
    // a policy acima acabou de liberar pra qualquer profissional.
    const consentFn = buildProfessionalAccessSql('movivo_app')
      .split('CREATE OR REPLACE FUNCTION')
      .find((chunk) => chunk.includes('public.has_active_health_consent'));
    expect(consentFn).toBeDefined();
    expect(consentFn).not.toContain('professional_assignments');
    expect(consentFn).toContain("actor_role = 'PROFESSIONAL'");
  });

  it('audit_logs recebe hash chain serializada e bloqueia UPDATE/DELETE/TRUNCATE', () => {
    const sql = buildAuditIntegritySql('movivo_app');
    expect(sql).toContain("pg_advisory_xact_lock(hashtext('movivo.audit_logs.hash_chain'))");
    expect(sql).toContain("digest(concat_ws('|'");
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON public.audit_logs');
    expect(sql).toContain('BEFORE TRUNCATE ON public.audit_logs');
    expect(sql).toContain('REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM movivo_app');
  });

  // Achado 2026-08-19: liberar PAR-Q não exige mais professional_assignments
  // específico pro titular — qualquer CREF ativo pode liberar (mesma decisão do
  // fundador do teste de RLS acima). `assign_unique_active_professional` (bootstrap)
  // não muda: continua gravando a atribuição nominal.
  it('bootstrap grava vinculo nominal; liberacao PAR-Q so verifica CREF ativo', () => {
    const sql = buildProfessionalAccessSql('movivo_app');
    expect(sql).toContain('expected exactly one active CREF professional');
    expect(sql).toContain('professional_assignments');
    expect(sql).toContain('ON CONFLICT (professional_id, user_id) DO UPDATE');
    expect(sql).toContain(
      'SET active = true, revoked_at = NULL, assigned_at = now(), updated_at = now()',
    );
    expect(sql).toContain("actor_role <> 'PROFESSIONAL'");
    expect(sql).toContain("professional.role = 'PROFESSIONAL'");
    expect(sql).toContain('professional.cref_active = true');
    const releaseFn = sql
      .split('CREATE OR REPLACE FUNCTION')
      .find((chunk) => chunk.includes('public.release_parq_clearance'));
    expect(releaseFn).toBeDefined();
    expect(releaseFn).not.toContain('professional_assignments');
    expect(releaseFn).toContain('active CREF professional required');
    expect(sql).not.toContain("actor_role NOT IN ('PROFESSIONAL', 'ADMIN')");
    expect(sql).toContain("new_state <> 'LIBERADO'::public.parq_state");
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.release_parq_clearance');
  });

  it('lookup do autoaprovado exige o proprio titular e CREF atribuido ativo', () => {
    const sql = buildProfessionalAccessSql('movivo_app');
    expect(sql).toContain('FUNCTION public.assigned_active_professional(target_user uuid)');
    expect(sql).toContain("actor_role <> 'USER' OR actor IS DISTINCT FROM target_user");
    expect(sql).toContain('no active assigned CREF professional');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.assigned_active_professional(uuid) FROM PUBLIC',
    );
  });

  it('revogacao e acesso operacional de saude usam funcoes estreitas e fail-closed', () => {
    const sql = buildProfessionalAccessSql('movivo_app');
    expect(sql).toContain('FUNCTION public.revoke_health_data_consent(target_user uuid)');
    expect(sql).toContain("actor_role <> 'USER' OR actor IS DISTINCT FROM target_user");
    expect(sql).toContain("consent.version = 'consent-health-2026-08-v3'");
    expect(sql).toContain('UPDATE public.professional_assignments');
    expect(sql).toContain('SET active = false, revoked_at = now(), updated_at = now()');
    expect(sql).toContain("'HEALTH_CONSENT_REVOKED'");
    expect(sql).toContain('jsonb_build_object(');
    expect(sql).toContain('FUNCTION public.link_session_consents_to_user');
    expect(sql).toContain("pg_advisory_xact_lock(hashtext('movivo.consent-cycle:'");
    expect(sql).toContain('coalesce(max(existing.cycle), 0) + 1');
    expect(sql).toContain('FUNCTION public.record_session_consent');
    expect(sql).toContain('anonymous session scope required');
    expect(sql).toContain("session.status = 'IN_PROGRESS'");
    expect(sql).toContain('ON CONFLICT (anamnesis_session_id, consent_type, version) DO UPDATE');
    expect(sql).toContain('accepted_at = now()');
    expect(sql).toContain('ip_address = EXCLUDED.ip_address');
    expect(sql).toContain('user_agent = EXCLUDED.user_agent');
    expect(sql).toContain('revoked_at = NULL');
    expect(sql).toContain('REVOKE INSERT, UPDATE, DELETE ON public.consents FROM movivo_app');
    expect(sql).toContain('RETURN false');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.revoke_health_data_consent(uuid) FROM PUBLIC',
    );
    expect(sql).toContain('active health consent required');
  });
});
