import { describe, expect, it } from 'vitest';
import type { ProtocolRenewalBlock3 } from '@movivo/shared';

import { evaluateRenewalSafety } from './protocol-renewal-safety';

function block3(overrides: Partial<ProtocolRenewalBlock3> = {}): ProtocolRenewalBlock3 {
  return {
    newPain: { hasNewPain: false },
    parqRecheck: { changedToYes: false },
    ...overrides,
  };
}

describe('evaluateRenewalSafety', () => {
  it('sem dor nova e sem repescagem: nada dispara', () => {
    const result = evaluateRenewalSafety(block3());
    expect(result).toEqual({
      requiresProfessionalReview: false,
      newPainReported: false,
      newPainNeedsHandoff: false,
    });
  });

  it('pergunta 10 "mudou para Sim" exige revisão profissional — sozinha, sem dor nova', () => {
    const result = evaluateRenewalSafety(
      block3({ parqRecheck: { changedToYes: true, detail: 'nova medicação contínua' } }),
    );
    expect(result.requiresProfessionalReview).toBe(true);
    expect(result.newPainReported).toBe(false);
  });

  it('dor nova de baixa intensidade e estável não exige revisão nem handoff', () => {
    const result = evaluateRenewalSafety(
      block3({
        newPain: {
          hasNewPain: true,
          region: 'KNEE',
          intensity: 2,
          trend: 'STABLE',
          soughtCare: false,
        },
      }),
    );
    expect(result.requiresProfessionalReview).toBe(false);
    expect(result.newPainReported).toBe(true);
    expect(result.newPainNeedsHandoff).toBe(false);
  });

  it('dor nova de alta intensidade dispara handoff mas NÃO força revisão obrigatória', () => {
    const result = evaluateRenewalSafety(
      block3({
        newPain: {
          hasNewPain: true,
          region: 'LOWER_BACK',
          intensity: 8,
          trend: 'STABLE',
          soughtCare: false,
        },
      }),
    );
    expect(result.newPainNeedsHandoff).toBe(true);
    expect(result.requiresProfessionalReview).toBe(false);
  });

  it('dor nova com tendência de piora dispara handoff mesmo com intensidade baixa', () => {
    const result = evaluateRenewalSafety(
      block3({
        newPain: {
          hasNewPain: true,
          region: 'SHOULDER',
          intensity: 3,
          trend: 'WORSENING',
          soughtCare: true,
        },
      }),
    );
    expect(result.newPainNeedsHandoff).toBe(true);
  });

  it('as duas perguntas de segurança podem disparar juntas', () => {
    const result = evaluateRenewalSafety(
      block3({
        newPain: {
          hasNewPain: true,
          region: 'KNEE',
          intensity: 9,
          trend: 'WORSENING',
          soughtCare: true,
        },
        parqRecheck: { changedToYes: true, detail: 'cirurgia recente' },
      }),
    );
    expect(result.requiresProfessionalReview).toBe(true);
    expect(result.newPainNeedsHandoff).toBe(true);
  });
});
