import { describe, expect, it } from 'vitest';

import { maskHours, parseHours } from './check-in-fields';

describe('horas de sono', () => {
  it('máscara: só números, até 4 dígitos, os dois últimos viram os minutos', () => {
    expect(maskHours('7')).toBe('7');
    expect(maskHours('73')).toBe('73');
    expect(maskHours('730')).toBe('7:30');
    expect(maskHours('0745')).toBe('07:45');
    expect(maskHours('7:30')).toBe('7:30');
    expect(maskHours('12345')).toBe('12:34');
    expect(maskHours('7h3a0')).toBe('7:30');
  });

  it('valida de 1:00 a 16:00, com minutos de 00 a 59', () => {
    expect(parseHours('7:30')).toBe(450);
    expect(parseHours('07:45')).toBe(465);
    expect(parseHours('8')).toBe(480);
    expect(parseHours('16:00')).toBe(960);
    expect(parseHours('0:45')).toBeNull();
    expect(parseHours('16:01')).toBeNull();
    expect(parseHours('7:60')).toBeNull();
    expect(parseHours('25')).toBeNull();
    expect(parseHours('')).toBeNull();
  });
});
