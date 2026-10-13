import { describe, expect, it } from 'vitest';

import {
  firstNameOf,
  localMidnightUtc,
  localParts,
  previousDay,
  shortWeekdayName,
} from './workout-eligibility';

describe('workout-eligibility', () => {
  it('localParts devolve data e hora no fuso e null para fuso inválido', () => {
    expect(localParts(new Date('2026-10-13T07:00:00Z'), 'America/Sao_Paulo')).toEqual({
      date: '2026-10-13',
      time: '04:00',
    });
    expect(localParts(new Date('2026-10-13T02:30:00Z'), 'America/Sao_Paulo')).toEqual({
      date: '2026-10-12',
      time: '23:30',
    });
    expect(localParts(new Date(), 'Marte/Olympus')).toBeNull();
  });

  it('previousDay atravessa mês e ano', () => {
    expect(previousDay('2026-10-13')).toBe('2026-10-12');
    expect(previousDay('2026-09-01')).toBe('2026-08-31');
    expect(previousDay('2026-01-01')).toBe('2025-12-31');
  });

  it('localMidnightUtc: meia-noite local de cada fuso em UTC', () => {
    expect(localMidnightUtc('2026-10-12', 'America/Sao_Paulo').toISOString()).toBe(
      '2026-10-12T03:00:00.000Z',
    );
    expect(localMidnightUtc('2026-10-12', 'America/Manaus').toISOString()).toBe(
      '2026-10-12T04:00:00.000Z',
    );
    expect(localMidnightUtc('2026-10-12', 'UTC').toISOString()).toBe('2026-10-12T00:00:00.000Z');
  });

  it('shortWeekdayName tira o "-feira"', () => {
    expect(shortWeekdayName('2026-10-09')).toBe('sexta');
    expect(shortWeekdayName('2026-10-10')).toBe('sábado');
    expect(shortWeekdayName('2026-10-12')).toBe('segunda');
  });

  it('firstNameOf usa o primeiro nome ou "atleta"', () => {
    expect(firstNameOf('  Pedro Teste ')).toBe('Pedro');
    expect(firstNameOf(null)).toBe('atleta');
    expect(firstNameOf('')).toBe('atleta');
  });
});
