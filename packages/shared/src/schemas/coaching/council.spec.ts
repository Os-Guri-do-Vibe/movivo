import { describe, expect, it } from 'vitest';

import {
  canActOnCase,
  canActOnDomain,
  canCloseSafety,
  canResolveSafety,
  domainsForCouncil,
  safetyDomainOf,
} from './council';

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

describe('quem age na fila de exceções', () => {
  const admin = { role: 'ADMIN', council: null, councilActive: false } as const;

  it('o ADMIN age em todos os domínios, com ou sem registro cadastrado', () => {
    for (const domain of ['TRAINING', 'NUTRITION', 'MEDICAL', 'GENERAL'] as const) {
      expect(canActOnCase(admin, domain), domain).toBe(true);
    }
  });

  it('o profissional segue limitado ao conselho dele, e registro inativo não age', () => {
    const cref = { role: 'PROFESSIONAL', council: 'CREF', councilActive: true } as const;
    expect(canActOnCase(cref, 'TRAINING')).toBe(true);
    expect(canActOnCase(cref, 'NUTRITION')).toBe(false);
    expect(canActOnCase({ ...cref, councilActive: false }, 'TRAINING')).toBe(false);
  });
});

describe('quem encerra um sinal de segurança', () => {
  const admin = { role: 'ADMIN', registeredCouncil: null } as const;

  it('sinal clínico: o ADMIN sem CRM ativo NÃO encerra', () => {
    expect(canCloseSafety(admin, 'CHEST_PAIN', 'ALL')).toBe(false);
    expect(canCloseSafety(admin, 'PARQ_POSITIVE', 'ALL')).toBe(false);
    expect(canCloseSafety(admin, 'MENTAL_DISTRESS', 'ALL')).toBe(false);
    expect(canCloseSafety({ ...admin, registeredCouncil: 'CREF' }, 'PREGNANCY', 'ALL')).toBe(false);
  });

  it('sinal clínico: o ADMIN com CRM ativo encerra, como o profissional médico', () => {
    expect(canCloseSafety({ ...admin, registeredCouncil: 'CRM' }, 'CHEST_PAIN', 'ALL')).toBe(true);
    expect(
      canCloseSafety({ role: 'PROFESSIONAL', registeredCouncil: 'CRM' }, 'CHEST_PAIN', 'ALL'),
    ).toBe(true);
  });

  it('os demais sinais: o ADMIN encerra; o profissional, só no domínio do conselho dele', () => {
    expect(canCloseSafety(admin, 'SEVERE_PAIN', 'TRAINING')).toBe(true);
    expect(canCloseSafety(admin, 'EATING_DISORDER_SIGNS', 'ALL')).toBe(true);
    const cref = { role: 'PROFESSIONAL', registeredCouncil: 'CREF' } as const;
    expect(canCloseSafety(cref, 'SEVERE_PAIN', 'TRAINING')).toBe(true);
    expect(canCloseSafety(cref, 'EATING_DISORDER_SIGNS', 'ALL')).toBe(false);
    expect(
      canCloseSafety({ role: 'PROFESSIONAL', registeredCouncil: null }, 'SEVERE_PAIN', 'TRAINING'),
    ).toBe(false);
  });
});
