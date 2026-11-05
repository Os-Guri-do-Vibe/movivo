/**
 * Fixtures de elegibilidade de saúde para os testes de INTEGRAÇÃO.
 *
 * O gate de consentimento de saúde é criado pelo submit da anamnese; os specs que semeiam o
 * titular DIRETO no banco (sem passar pelo submit) precisam recriar essa pré-condição, senão
 * os fluxos gated (resposta do Coach, webhook de entrada, dunning) são descartados.
 *
 * Usa o cliente SUPERUSUÁRIO porque o runtime (`movivo_app`) não tem INSERT em `consents`
 * (só a função estreita `record_session_consent`).
 */
import { CONSENT_TEXTS } from '@movivo/shared';
import type postgres from 'postgres';

/** Registra consentimento HEALTH_DATA ativo para o titular. */
export async function seedHealthEligibility(admin: postgres.Sql, userId: string): Promise<void> {
  await admin`
    INSERT INTO consents (user_id, consent_type, version, accepted)
    VALUES (${userId}::uuid, 'HEALTH_DATA', ${CONSENT_TEXTS.HEALTH_DATA.version}, true)`;
}
