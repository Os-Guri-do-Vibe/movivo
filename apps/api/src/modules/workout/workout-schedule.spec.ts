import type { ProtocolStructure } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import {
  dayKey,
  plannedDaysBefore,
  sessionKeyFor,
  trainingWeekdays,
  weekday,
} from './workout-schedule';

function structure(weeklyFrequency: number, labels: string[]): ProtocolStructure {
  return {
    weeklyFrequency,
    sessions: labels.map((dayLabel) => ({ dayLabel })),
  } as unknown as ProtocolStructure;
}

describe('trainingWeekdays', () => {
  it('espaça as sessões com descanso entre elas nas frequências usuais', () => {
    expect(trainingWeekdays(1)).toEqual([3]);
    expect(trainingWeekdays(3)).toEqual([1, 3, 5]);
    expect(trainingWeekdays(7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it.each([
    ['zero', 0],
    ['negativa', -4],
    ['não numérica', Number.NaN],
  ])('frequência %s é tratada como 1 — nunca produz semana vazia', (_label, value) => {
    expect(trainingWeekdays(value)).toEqual([3]);
  });

  it('frequência acima de 7 satura em todo dia da semana, sem estourar o mapa', () => {
    expect(trainingWeekdays(12)).toHaveLength(7);
  });

  it('frequência fracionária é truncada, não arredondada para cima', () => {
    expect(trainingWeekdays(3.9)).toEqual(trainingWeekdays(3));
  });
});

describe('dayKey / weekday', () => {
  it('usa o dia civil de São Paulo, não o UTC — 23h BRT ainda é o mesmo dia', () => {
    // 2026-08-11T02:00Z = 2026-08-10 23:00 em São Paulo (segunda-feira).
    const at = new Date('2026-08-11T02:00:00.000Z');
    expect(dayKey(at)).toBe('2026-08-10');
    expect(weekday(at)).toBe(1);
  });
});

describe('sessionKeyFor', () => {
  const MWF = structure(3, ['A', 'B', 'C']);

  it('gira as sessões pela posição do dia dentro da semana', () => {
    expect(sessionKeyFor(new Date('2026-08-10T15:00:00.000Z'), MWF)).toBe('A'); // segunda
    expect(sessionKeyFor(new Date('2026-08-12T15:00:00.000Z'), MWF)).toBe('B'); // quarta
    expect(sessionKeyFor(new Date('2026-08-14T15:00:00.000Z'), MWF)).toBe('C'); // sexta
  });

  it('reusa as sessões em ciclo quando há mais dias de treino que sessões', () => {
    const twoSessions = structure(3, ['A', 'B']);
    expect(sessionKeyFor(new Date('2026-08-14T15:00:00.000Z'), twoSessions)).toBe('A');
  });

  it('devolve null em dia sem treino previsto', () => {
    expect(sessionKeyFor(new Date('2026-08-09T15:00:00.000Z'), MWF)).toBeNull(); // domingo
  });

  it('devolve null quando o protocolo não tem sessão alguma', () => {
    expect(sessionKeyFor(new Date('2026-08-10T15:00:00.000Z'), structure(3, []))).toBeNull();
  });
});

describe('plannedDaysBefore', () => {
  it('lista os dias previstos ANTES da referência, do mais antigo ao mais recente', () => {
    const planned = plannedDaysBefore(
      new Date('2026-08-16T15:00:00.000Z'),
      7,
      structure(3, ['A', 'B', 'C']),
    );
    expect(planned).toEqual([
      { completedAt: '2026-08-10', sessionKey: 'A' },
      { completedAt: '2026-08-12', sessionKey: 'B' },
      { completedAt: '2026-08-14', sessionKey: 'C' },
    ]);
  });

  it('não inclui a própria data de referência', () => {
    // 2026-08-14 é sexta (dia de treino) e é a referência: fica de fora.
    const planned = plannedDaysBefore(
      new Date('2026-08-14T15:00:00.000Z'),
      7,
      structure(3, ['A', 'B', 'C']),
    );
    expect(planned.map((day) => day.completedAt)).not.toContain('2026-08-14');
  });

  it('janela sem nenhum dia de treino devolve lista vazia', () => {
    expect(plannedDaysBefore(new Date('2026-08-10T15:00:00.000Z'), 1, structure(1, ['A']))).toEqual(
      [],
    );
  });
});
