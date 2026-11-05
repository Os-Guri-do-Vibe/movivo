import { CONSENT_TEXTS } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import {
  buildAuditIntegritySql,
  buildProfessionalAccessSql,
  buildRlsPoliciesSql,
} from './security-policies';

describe('controles de acesso e trilha no banco', () => {
  // A fila é do CARGO, não da pessoa: qualquer profissional ativo lê titular com
  // consentimento de saúde ativo.
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

  it('revogacao e acesso operacional de saude usam funcoes estreitas e fail-closed', () => {
    const sql = buildProfessionalAccessSql('movivo_app');
    expect(sql).toContain('FUNCTION public.revoke_health_data_consent(target_user uuid)');
    expect(sql).toContain(
      "actor_role IS DISTINCT FROM 'USER' OR actor IS DISTINCT FROM target_user",
    );
    expect(sql).toContain(`consent.version = '${CONSENT_TEXTS.HEALTH_DATA.version}'`);
    expect(sql).not.toContain('professional_assignments');
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
  });
});
