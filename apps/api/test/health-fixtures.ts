/**
 * Fixtures de elegibilidade de saúde para os testes de INTEGRAÇÃO (Sprint 5).
 *
 * O schema de Sprint 5 introduziu o vínculo obrigatório titular→profissional CREF
 * (`professional_assignments`) e o gate de consentimento de saúde. O submit da anamnese
 * cria os dois automaticamente; mas os specs que semeiam o titular DIRETO no banco (sem
 * passar pelo submit) precisam recriar essa pré-condição, senão os fluxos gated de Sprint
 * 2/3/4 (geração/entrega de protocolo, resposta do Coach, webhook de entrada, dunning)
 * são descartados por falta de vínculo/consentimento.
 *
 * Usa o cliente SUPERUSUÁRIO porque o runtime (`movivo_app`) não tem INSERT em `consents`
 * (só a função estreita `record_session_consent`) e não cria vínculos fora do contexto SYSTEM.
 */
import { CONSENT_TEXTS } from '@movivo/shared';
import type postgres from 'postgres';

/** RT singleton semeado pelo global-setup da suíte (id FIXO — specs asseram esse id). */
export const PROFESSIONAL_ID = '00000000-0000-4000-8000-000000000001';

/** Vincula o titular ao RT singleton e registra consentimento HEALTH_DATA ativo. */
export async function seedHealthEligibility(admin: postgres.Sql, userId: string): Promise<void> {
  await admin`
    INSERT INTO professional_assignments (professional_id, user_id)
    VALUES (${PROFESSIONAL_ID}::uuid, ${userId}::uuid)
    ON CONFLICT (professional_id, user_id) DO UPDATE SET active = true, revoked_at = NULL`;
  await admin`
    INSERT INTO consents (user_id, consent_type, version, accepted)
    VALUES (${userId}::uuid, 'HEALTH_DATA', ${CONSENT_TEXTS.HEALTH_DATA.version}, true)`;
}
