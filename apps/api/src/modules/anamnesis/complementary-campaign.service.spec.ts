import { describe, expect, it } from 'vitest';

import { complementaryInviteMessage } from './complementary-campaign.service';

describe('complementaryInviteMessage', () => {
  it('cumprimenta pelo primeiro nome e leva o link', () => {
    const text = complementaryInviteMessage('Ana', 'https://app.movivo.test/anamnese/c/abc');
    expect(text).toMatch(/^Oi, Ana!/);
    expect(text).toContain('https://app.movivo.test/anamnese/c/abc');
  });

  it('cai no cumprimento genérico sem nome', () => {
    expect(complementaryInviteMessage(null, 'https://x.test')).toMatch(/^Oi! /);
  });

  it('respeita os guardrails: sem travessão, sem promessa de resultado e sem termo clínico', () => {
    const text = complementaryInviteMessage('Ana', 'https://x.test');
    expect(text).not.toMatch(/[—–]/u);
    expect(text).not.toMatch(/diagnóstico|tratamento|cura|garantid/iu);
  });
});
