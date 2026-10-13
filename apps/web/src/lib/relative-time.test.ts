import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { elapsed } from './relative-time';

describe('elapsed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T12:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

  it('descreve a idade em minutos, horas e dias', () => {
    expect(elapsed(ago(20_000))).toBe('Agora');
    expect(elapsed(ago(5 * 60_000))).toBe('Há 5 min');
    expect(elapsed(ago(3 * 3_600_000))).toBe('Há 3 h');
    expect(elapsed(ago(30 * 3_600_000))).toBe('Há 1 dia');
    expect(elapsed(ago(50 * 3_600_000))).toBe('Há 2 dias');
  });

  it('nunca devolve idade negativa para datas no futuro', () => {
    expect(elapsed(ago(-10 * 60_000))).toBe('Agora');
  });
});
