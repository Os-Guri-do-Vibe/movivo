import { describe, expect, it } from 'vitest';

import {
  protocolRenewalBlock3Schema,
  protocolRenewalBlock5Schema,
} from './protocol-renewal.schema';

describe('protocolRenewalBlock3Schema (segurança — repescagem de PAR-Q)', () => {
  it('aceita sem dor nova e sem mudança no PAR-Q', () => {
    const result = protocolRenewalBlock3Schema.safeParse({
      newPain: { hasNewPain: false },
      parqRecheck: { changedToYes: false },
    });
    expect(result.success).toBe(true);
  });

  it('dor nova sem região/intensidade/tendência/procura de cuidado é rejeitada', () => {
    const result = protocolRenewalBlock3Schema.safeParse({
      newPain: { hasNewPain: true },
      parqRecheck: { changedToYes: false },
    });
    expect(result.success).toBe(false);
  });

  it('dor nova região OTHER sem regionOther é rejeitada', () => {
    const result = protocolRenewalBlock3Schema.safeParse({
      newPain: { hasNewPain: true, region: 'OTHER', intensity: 5, trend: 'STABLE', soughtCare: false },
      parqRecheck: { changedToYes: false },
    });
    expect(result.success).toBe(false);
  });

  it('dor nova completa é aceita', () => {
    const result = protocolRenewalBlock3Schema.safeParse({
      newPain: { hasNewPain: true, region: 'KNEE', intensity: 5, trend: 'STABLE', soughtCare: false },
      parqRecheck: { changedToYes: false },
    });
    expect(result.success).toBe(true);
  });

  it('repescagem "mudou para Sim" sem detalhe é rejeitada', () => {
    const result = protocolRenewalBlock3Schema.safeParse({
      newPain: { hasNewPain: false },
      parqRecheck: { changedToYes: true },
    });
    expect(result.success).toBe(false);
  });

  it('repescagem "mudou para Sim" com detalhe é aceita', () => {
    const result = protocolRenewalBlock3Schema.safeParse({
      newPain: { hasNewPain: false },
      parqRecheck: { changedToYes: true, detail: 'nova medicação contínua para pressão' },
    });
    expect(result.success).toBe(true);
  });
});

const BASE_BLOCK5 = {
  changes: ['NONE'] as const,
  preferredDays: [],
  dislikedExercise: { has: false },
  barriers: [],
  goalChange: { changed: false },
};

describe('protocolRenewalBlock5Schema (contexto e logística)', () => {
  it('aceita "nenhuma mudança" sozinha', () => {
    expect(protocolRenewalBlock5Schema.safeParse(BASE_BLOCK5).success).toBe(true);
  });

  it('"nenhuma mudança" combinada com outra opção é rejeitada', () => {
    const result = protocolRenewalBlock5Schema.safeParse({
      ...BASE_BLOCK5,
      changes: ['NONE', 'DAYS_PER_WEEK'],
      daysPerWeek: 4,
    });
    expect(result.success).toBe(false);
  });

  it('DAYS_PER_WEEK marcado sem daysPerWeek é rejeitado', () => {
    const result = protocolRenewalBlock5Schema.safeParse({ ...BASE_BLOCK5, changes: ['DAYS_PER_WEEK'] });
    expect(result.success).toBe(false);
  });

  it('DAYS_PER_WEEK marcado com daysPerWeek é aceito', () => {
    const result = protocolRenewalBlock5Schema.safeParse({
      ...BASE_BLOCK5,
      changes: ['DAYS_PER_WEEK'],
      daysPerWeek: 4,
    });
    expect(result.success).toBe(true);
  });

  it('exercício não gostado marcado "sim" sem descrição é rejeitado', () => {
    const result = protocolRenewalBlock5Schema.safeParse({
      ...BASE_BLOCK5,
      dislikedExercise: { has: true },
    });
    expect(result.success).toBe(false);
  });

  it('mudança de objetivo marcada sem novo objetivo é rejeitada', () => {
    const result = protocolRenewalBlock5Schema.safeParse({
      ...BASE_BLOCK5,
      goalChange: { changed: true },
    });
    expect(result.success).toBe(false);
  });

  it('data-alvo "mudou a data" sem nova data é rejeitada', () => {
    const result = protocolRenewalBlock5Schema.safeParse({
      ...BASE_BLOCK5,
      targetEvent: { status: 'DATE_CHANGED' },
    });
    expect(result.success).toBe(false);
  });

  it('data-alvo "mudou a data" com nova data é aceita', () => {
    const result = protocolRenewalBlock5Schema.safeParse({
      ...BASE_BLOCK5,
      targetEvent: { status: 'DATE_CHANGED', newDate: '2026-12-01' },
    });
    expect(result.success).toBe(true);
  });
});
