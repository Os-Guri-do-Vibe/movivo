import { describe, expect, it } from 'vitest';

import { mealByClock } from './orchestrator.service';

const at = (iso: string) => new Date(iso);
const plan = ['BREAKFAST', 'LUNCH', 'AFTERNOON_SNACK', 'DINNER'] as const;

describe('refeição pela hora local', () => {
  it('escolhe a refeição do horário entre as do plano', () => {
    // 15:30 em São Paulo = 18:30 UTC
    expect(mealByClock(plan, at('2026-11-03T18:30:00Z'), 'America/Sao_Paulo')).toBe(
      'AFTERNOON_SNACK',
    );
    expect(mealByClock(plan, at('2026-11-03T15:00:00Z'), 'America/Sao_Paulo')).toBe('LUNCH');
    expect(mealByClock(plan, at('2026-11-03T11:00:00Z'), 'America/Sao_Paulo')).toBe('BREAKFAST');
    expect(mealByClock(plan, at('2026-11-03T23:00:00Z'), 'America/Sao_Paulo')).toBe('DINNER');
  });

  it('sem a refeição da hora no plano, não adivinha', () => {
    expect(
      mealByClock(['BREAKFAST', 'LUNCH'], at('2026-11-04T01:30:00Z'), 'America/Sao_Paulo'),
    ).toBeNull();
  });
});
