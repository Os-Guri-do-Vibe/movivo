import { describe, expect, it } from 'vitest';

import { canActOnDomain, canResolveSafety, domainsForCouncil, safetyDomainOf } from './council';

describe('domínios por conselho', () => {
  it('cada conselho responde pelo seu domínio e por geral', () => {
    expect(domainsForCouncil('CREF')).toEqual(['TRAINING', 'GENERAL']);
    expect(domainsForCouncil('CRN')).toEqual(['NUTRITION', 'GENERAL']);
    expect(domainsForCouncil('CRM')).toEqual(['MEDICAL', 'GENERAL']);
  });

  it('um conselho não age no domínio do outro', () => {
    expect(canActOnDomain('CREF', 'NUTRITION')).toBe(false);
    expect(canActOnDomain('CRN', 'TRAINING')).toBe(false);
    expect(canActOnDomain('CREF', 'MEDICAL')).toBe(false);
  });
});

describe('safetyDomainOf', () => {
  it('sinal clínico vai para o médico, independentemente do escopo', () => {
    expect(safetyDomainOf('CHEST_PAIN', 'ALL')).toBe('MEDICAL');
    expect(safetyDomainOf('PREGNANCY', 'TRAINING')).toBe('MEDICAL');
    expect(safetyDomainOf('MENTAL_DISTRESS', 'ALL')).toBe('MEDICAL');
  });

  it('transtorno alimentar e variação rápida de peso vão para a nutrição', () => {
    expect(safetyDomainOf('EATING_DISORDER_SIGNS', 'ALL')).toBe('NUTRITION');
    expect(safetyDomainOf('RAPID_WEIGHT_CHANGE', 'ALL')).toBe('NUTRITION');
  });

  it('dor e lesão seguem o escopo', () => {
    expect(safetyDomainOf('SEVERE_PAIN', 'TRAINING')).toBe('TRAINING');
    expect(safetyDomainOf('NEW_INJURY', 'ALL')).toBe('GENERAL');
  });
});

describe('canResolveSafety', () => {
  it('sinal clínico só o médico encerra', () => {
    expect(canResolveSafety('CRM', 'CHEST_PAIN', 'ALL')).toBe(true);
    expect(canResolveSafety('CREF', 'CHEST_PAIN', 'ALL')).toBe(false);
    expect(canResolveSafety('CRN', 'FAINTING_OR_DIZZINESS', 'ALL')).toBe(false);
  });

  it('cada um encerra o que é do seu domínio', () => {
    expect(canResolveSafety('CREF', 'SEVERE_PAIN', 'TRAINING')).toBe(true);
    expect(canResolveSafety('CRN', 'EATING_DISORDER_SIGNS', 'ALL')).toBe(true);
    expect(canResolveSafety('CREF', 'EATING_DISORDER_SIGNS', 'ALL')).toBe(false);
    expect(canResolveSafety('CRM', 'SEVERE_PAIN', 'TRAINING')).toBe(false);
  });

  it('o domínio geral é de qualquer profissional', () => {
    for (const council of ['CREF', 'CRN', 'CRM'] as const) {
      expect(canResolveSafety(council, 'NEW_INJURY', 'ALL')).toBe(true);
    }
  });
});
