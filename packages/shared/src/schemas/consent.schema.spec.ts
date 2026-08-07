import { describe, expect, it } from 'vitest';

import { CONSENT_TEXTS, HEALTH_DATA_CONSENT_V1 } from './consent.schema';

describe('consentimento HEALTH_DATA versionado', () => {
  it('preserva a v1 e publica v2 com o comando exato de revogação', () => {
    expect(HEALTH_DATA_CONSENT_V1.version).toBe('consent-health-2026-07-v1');
    expect(HEALTH_DATA_CONSENT_V1.body.join(' ')).not.toContain('REVOGAR CONSENTIMENTO DE SAÚDE');
    expect(CONSENT_TEXTS.HEALTH_DATA.version).toBe('consent-health-2026-08-v2');
    expect(CONSENT_TEXTS.HEALTH_DATA.body.join(' ')).toContain('REVOGAR CONSENTIMENTO DE SAÚDE');
  });
});
