import type { ProtocolStructure } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import {
  dayKey,
  dayKeyIn,
  validTimezone,
  weekdayCodeIn,
  plannedDaysBefore,
  sessionFor,
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

describe('sessionFor com dias fixos (achado 2026-10-15, produção)', () => {
  // Protocolo real: SEG/TER/QUA/SEX/SÁB, 5x. Quinta-feira 15/10/2026 virava treino pelo
  // calendário padrão de 5x (seg–sex), acima da disponibilidade do aluno.
  const fixed = {
    weeklyFrequency: 5,
    sessions: (['MON', 'TUE', 'WED', 'FRI', 'SAT'] as const).map((weekday, i) => ({
      dayLabel: `Treino ${i + 1}`,
      weekday,
    })),
  } as unknown as ProtocolStructure;
  const at = (iso: string) => new Date(`${iso}T15:00:00Z`);

  it('dia fora do protocolo não é dia de treino quando todas as sessões têm dia fixo', () => {
    expect(sessionFor(at('2026-10-15'), fixed)).toBeNull(); // quinta
    expect(sessionFor(at('2026-10-18'), fixed)).toBeNull(); // domingo
  });

  it('cada dia fixo continua devolvendo a própria sessão', () => {
    expect(sessionKeyFor(at('2026-10-16'), fixed)).toBe('Treino 4'); // sexta
    expect(sessionKeyFor(at('2026-10-17'), fixed)).toBe('Treino 5'); // sábado
  });

  it('a semana tem exatamente uma sessão por dia fixo, nunca mais', () => {
    const days = [
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ];
    const training = days.filter((day) => sessionFor(at(day), fixed) !== null);
    expect(training).toHaveLength(5);
  });

  it('protocolo sem dia fixo (anterior a 2026-08-18) continua no calendário por frequência', () => {
    expect(sessionKeyFor(at('2026-10-14'), structure(3, ['A', 'B']))).toBe('B'); // quarta
  });
});

describe('dia no fuso do ALUNO (D3)', () => {
  // 2026-10-21T03:30Z = terça 23:30 em Manaus (UTC-4) e quarta 00:30 em São Paulo (UTC-3).
  const AT = new Date('2026-10-21T03:30:00.000Z');

  it('Manaus ainda está na terça quando São Paulo já virou para a quarta', () => {
    expect(dayKeyIn(AT, 'America/Manaus')).toBe('2026-10-20');
    expect(dayKeyIn(AT, 'America/Sao_Paulo')).toBe('2026-10-21');
    expect(weekdayCodeIn(AT, 'America/Manaus')).toBe('TUE');
    expect(weekdayCodeIn(AT, 'America/Sao_Paulo')).toBe('WED');
  });

  it('sem fuso ou com fuso inválido, cai no do produto em vez de quebrar', () => {
    expect(dayKeyIn(AT, null)).toBe('2026-10-21');
    expect(dayKeyIn(AT, 'Marte/Olympus')).toBe('2026-10-21');
    expect(validTimezone('Marte/Olympus')).toBe('America/Sao_Paulo');
    expect(validTimezone('America/Manaus')).toBe('America/Manaus');
  });
});
