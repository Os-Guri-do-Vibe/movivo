import { describe, expect, it } from 'vitest';

import {
  CONSENT_TEXTS,
  HEALTH_DATA_CONSENT_V1,
  isRevocableConsent,
  recordConsentsSchema,
  REQUIRED_CONSENT_TYPES,
  WHATSAPP_OPERATIONAL_NOTICE,
} from './consent.schema';

describe('consentimento versionado (Alexandre §5 — onboarding v2)', () => {
  it('preserva a v1 histórica e publica a v3 de saúde com escopo ampliado', () => {
    expect(HEALTH_DATA_CONSENT_V1.version).toBe('consent-health-2026-07-v1');
    expect(HEALTH_DATA_CONSENT_V1.body.join(' ')).not.toContain('REVOGAR CONSENTIMENTO DE SAÚDE');
    expect(CONSENT_TEXTS.HEALTH_DATA.version).toBe('consent-health-2026-08-v3');
    const body = CONSENT_TEXTS.HEALTH_DATA.body.join(' ');
    expect(body).toContain('REVOGAR CONSENTIMENTO DE SAÚDE');
    // Escopo novo da v2 da anamnese: sem estes termos, o consentimento não cobre o que se coleta.
    expect(body).toContain('dores atuais');
    expect(body).toContain('acompanhamento com médico ou fisioterapeuta');
  });

  it('publica as versões da Sprint 6 dos demais tipos', () => {
    expect(CONSENT_TEXTS.TERMS_OF_SERVICE.version).toBe('terms-2026-08-v2');
    expect(CONSENT_TEXTS.MARKETING.version).toBe('consent-marketing-2026-08-v2');
    expect(CONSENT_TEXTS.AI_DISCLOSURE.version).toBe('ai-disclosure-2026-08-v1');
  });

  it('mantém AI_DISCLOSURE como ciência (nunca "Autorizo") e não revogável', () => {
    expect(CONSENT_TEXTS.AI_DISCLOSURE.label.startsWith('Estou ciente')).toBe(true);
    expect(CONSENT_TEXTS.AI_DISCLOSURE.label).not.toContain('Autorizo');
    expect(isRevocableConsent('AI_DISCLOSURE')).toBe(false);
    expect(isRevocableConsent('HEALTH_DATA')).toBe(true);
    expect(isRevocableConsent('MARKETING')).toBe(true);
    // Termos também não se "revogam" (equivale a cancelar) — §5.8.
    expect(isRevocableConsent('TERMS_OF_SERVICE')).toBe(false);
  });

  it('tem 3 obrigatórios e marketing opcional', () => {
    expect([...REQUIRED_CONSENT_TYPES].sort()).toEqual([
      'AI_DISCLOSURE',
      'HEALTH_DATA',
      'TERMS_OF_SERVICE',
    ]);
    expect(CONSENT_TEXTS.MARKETING.required).toBe(false);
  });

  it('mantém o aviso de WhatsApp fora do enum de consentimento', () => {
    expect(WHATSAPP_OPERATIONAL_NOTICE.version).toBe('aviso-whatsapp-operacional-2026-08-v1');
    expect(Object.keys(CONSENT_TEXTS)).not.toContain('WHATSAPP_OPERATIONAL_NOTICE');
    const parsed = recordConsentsSchema.safeParse({
      consents: [{ type: 'WHATSAPP_OPERATIONAL_NOTICE', version: 'x', accepted: true }],
    });
    expect(parsed.success).toBe(false);
  });

  it('aceita o lote de até 4 itens da Etapa 1', () => {
    const consents = (Object.keys(CONSENT_TEXTS) as (keyof typeof CONSENT_TEXTS)[]).map((type) => ({
      type,
      version: CONSENT_TEXTS[type].version,
      accepted: true,
    }));
    expect(recordConsentsSchema.safeParse({ consents }).success).toBe(true);
  });
});
