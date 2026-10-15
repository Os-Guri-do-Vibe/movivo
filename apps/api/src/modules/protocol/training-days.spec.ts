import type { Weekday } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import {
  duplicatedWeekdays,
  normalizedPreferredDays,
  planTrainingWeekdays,
  validDaysPerWeek,
  WEEK_ORDER,
  weekdayPlanIssues,
  weeklySessionTarget,
} from './training-days';

const ALL_DAYS: Weekday[] = [...WEEK_ORDER];

/** Menor intervalo (circular) entre dois treinos seguidos da semana. */
function minGap(days: readonly Weekday[]): number {
  const idx = days.map((d) => WEEK_ORDER.indexOf(d)).sort((a, b) => a - b);
  if (idx.length < 2) return 7;
  return Math.min(
    ...idx.map((day, i) => ((idx[(i + 1) % idx.length] as number) - day + 7) % 7 || 7),
  );
}

describe('weeklySessionTarget — a disponibilidade é a meta e o teto', () => {
  it('usa daysPerWeek, independentemente de quantos dias preferidos foram marcados', () => {
    expect(weeklySessionTarget({ daysPerWeek: 4, preferredDays: ALL_DAYS })).toBe(4);
    expect(weeklySessionTarget({ daysPerWeek: 5, preferredDays: ['MON', 'WED'] })).toBe(5);
    expect(weeklySessionTarget({ daysPerWeek: 1, preferredDays: ALL_DAYS })).toBe(1);
  });

  it('protocolo antigo sem daysPerWeek mantém a regra legada (um por dia preferido)', () => {
    expect(weeklySessionTarget({ preferredDays: ['MON', 'WED', 'FRI'] })).toBe(3);
    expect(weeklySessionTarget({})).toBeUndefined();
  });

  it('nunca aceita disponibilidade fora de 1..7 nem não inteira', () => {
    for (const bad of [0, 8, 2.5, -1, Number.NaN, '4', null, undefined]) {
      expect(validDaysPerWeek(bad)).toBeUndefined();
    }
    expect(weeklySessionTarget({ daysPerWeek: 9, preferredDays: [] })).toBeUndefined();
  });
});

describe('planTrainingWeekdays — distribuição determinística dos dias', () => {
  it.each([1, 2, 3, 4, 5, 6, 7])(
    '%i dia(s) disponível(is) com os 7 dias preferidos → exatamente essa quantidade, sem repetir',
    (days) => {
      const plan = planTrainingWeekdays(days, ALL_DAYS);
      expect(plan).toHaveLength(days);
      expect(new Set(plan).size).toBe(days);
    },
  );

  it('espaça para recuperação: nunca deixa dois dias seguidos quando cabe folga', () => {
    expect(planTrainingWeekdays(3, ALL_DAYS)).toEqual(['MON', 'WED', 'FRI']);
    expect(minGap(planTrainingWeekdays(2, ALL_DAYS))).toBeGreaterThanOrEqual(3);
    // 4 em 7 não cabe sem um par seguido — mas nunca dois pares colados.
    expect(minGap(planTrainingWeekdays(4, ALL_DAYS))).toBe(1);
    expect(planTrainingWeekdays(4, ALL_DAYS)).toEqual(['MON', 'TUE', 'THU', 'SAT']);
  });

  it('com mais preferidos que a disponibilidade, escolhe SÓ entre os preferidos (caso real 2026-10-15)', () => {
    const preferred: Weekday[] = ['MON', 'WED', 'THU', 'SAT', 'SUN'];
    const plan = planTrainingWeekdays(4, preferred);
    expect(plan).toHaveLength(4);
    expect(plan.every((day) => preferred.includes(day))).toBe(true);
    expect(plan).toEqual(['MON', 'WED', 'THU', 'SAT']);
  });

  it('com menos preferidos que a disponibilidade, usa todos os preferidos e completa com outros dias', () => {
    const plan = planTrainingWeekdays(5, ['MON', 'WED']);
    expect(plan).toHaveLength(5);
    expect(plan).toEqual(expect.arrayContaining(['MON', 'WED']));
    expect(new Set(plan).size).toBe(5);
  });

  it('preferidos em quantidade igual à disponibilidade → exatamente os preferidos', () => {
    expect(planTrainingWeekdays(2, ['THU', 'TUE'])).toEqual(['TUE', 'THU']);
  });

  it('sem preferidos, distribui pela semana', () => {
    expect(planTrainingWeekdays(3, [])).toEqual(['MON', 'WED', 'FRI']);
  });

  it('é determinística', () => {
    expect(planTrainingWeekdays(4, ALL_DAYS)).toEqual(planTrainingWeekdays(4, ALL_DAYS));
  });
});

describe('weekdayPlanIssues / duplicatedWeekdays', () => {
  it('sessão fora dos preferidos quando há preferidos suficientes', () => {
    expect(
      weekdayPlanIssues(['MON', 'TUE'], { daysPerWeek: 2, preferredDays: ['MON', 'WED', 'FRI'] }),
    ).toEqual([{ kind: 'OUTSIDE_PREFERRED', weekdays: ['TUE'] }]);
  });

  it('preferido sem sessão quando há menos preferidos que a disponibilidade', () => {
    expect(
      weekdayPlanIssues(['MON', 'TUE', 'THU'], { daysPerWeek: 3, preferredDays: ['MON', 'WED'] }),
    ).toEqual([{ kind: 'MISSING_PREFERRED', weekdays: ['WED'] }]);
  });

  it('sessão sem dia definido com preferidos declarados', () => {
    expect(
      weekdayPlanIssues(['MON', undefined], { daysPerWeek: 2, preferredDays: ['MON', 'WED'] }),
    ).toEqual([{ kind: 'MISSING_WEEKDAY' }]);
  });

  it('sem preferidos não há o que conferir', () => {
    expect(weekdayPlanIssues(['SUN'], { daysPerWeek: 1, preferredDays: [] })).toEqual([]);
  });

  it('acusa dias repetidos e normaliza preferidos na ordem da semana', () => {
    expect(duplicatedWeekdays(['MON', 'WED', 'MON', undefined])).toEqual(['MON']);
    expect(normalizedPreferredDays(['FRI', 'MON', 'FRI'])).toEqual(['MON', 'FRI']);
  });
});
