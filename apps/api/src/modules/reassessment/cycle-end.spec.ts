import { describe, expect, it } from 'vitest';

import {
  NUTRITION_CYCLE_WEEKS,
  REASSESSMENT_GRACE_DAYS,
  lastDayOfCycle,
  nutritionLastDay,
  reassessmentDue,
} from './cycle-end';

describe('cycle-end', () => {
  it('o ciclo termina no último dia da última semana das fases', () => {
    // 8 semanas a partir de segunda 2026-09-07: termina no domingo 2026-11-01.
    expect(lastDayOfCycle('2026-09-07', [4, 3, 1])).toBe('2026-11-01');
    expect(lastDayOfCycle('2026-09-07', [1])).toBe('2026-09-13');
  });

  it('protocolo alimentar sem treino segue o prazo padrão', () => {
    expect(nutritionLastDay('2026-09-07')).toBe(
      lastDayOfCycle('2026-09-07', [NUTRITION_CYCLE_WEEKS]),
    );
  });

  it('abre no dia do vencimento e dentro da tolerância, não antes nem muito depois', () => {
    expect(reassessmentDue('2026-10-31', '2026-11-01')).toBe(false);
    expect(reassessmentDue('2026-11-01', '2026-11-01')).toBe(true);
    expect(reassessmentDue('2026-11-10', '2026-11-01')).toBe(true);
    const late = new Date(
      Date.parse('2026-11-01T00:00:00Z') + (REASSESSMENT_GRACE_DAYS + 1) * 86_400_000,
    );
    expect(reassessmentDue(late.toISOString().slice(0, 10), '2026-11-01')).toBe(false);
  });
});
