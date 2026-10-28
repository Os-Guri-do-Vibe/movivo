import { describe, expect, it } from 'vitest';

import { ageLabel, describeAction, goalLabel } from './exception-copy';

describe('describeAction', () => {
  it('descreve ajuste de energia com o sentido certo', () => {
    expect(describeAction({ type: 'ADJUST_ENERGY_TARGET', deltaKcal: 150 })).toBe(
      'Aumentar a meta de energia em 150 kcal por dia.',
    );
    expect(describeAction({ type: 'ADJUST_ENERGY_TARGET', deltaKcal: -200 })).toContain('Reduzir');
  });

  it('descreve volume, troca e mensagem', () => {
    expect(
      describeAction({
        type: 'ADJUST_WEEKLY_VOLUME',
        modality: 'STRENGTH',
        percentChange: -10,
        weeks: 1,
      }),
    ).toContain('-10%');
    expect(
      describeAction({
        type: 'SUBSTITUTE_EXERCISE',
        fromExerciseId: 'a',
        toExerciseId: 'b',
        scope: 'PLAN',
      }),
    ).toContain('no plano todo');
    expect(describeAction({ type: 'SEND_MESSAGE', text: 'Oi' })).toContain('Oi');
  });

  it('ação desconhecida não quebra a tela', () => {
    expect(describeAction({ type: 'OUTRA' })).toBe('OUTRA');
  });
});

describe('goalLabel', () => {
  it('traduz o objetivo declarado e ignora o que não conhece', () => {
    expect(goalLabel('FAT_LOSS')).toBe('Perder gordura');
    expect(goalLabel('INEXISTENTE')).toBeNull();
    expect(goalLabel(undefined)).toBeNull();
  });
});

describe('ageLabel', () => {
  const now = new Date('2026-11-04T12:00:00Z');
  it('usa minutos, horas e dias', () => {
    expect(ageLabel('2026-11-04T11:30:00Z', now)).toBe('há 30 min');
    expect(ageLabel('2026-11-04T07:00:00Z', now)).toBe('há 5 h');
    expect(ageLabel('2026-11-01T12:00:00Z', now)).toBe('há 3 dias');
  });
});
