import { describe, expect, it } from 'vitest';

import { daysBetween, levelToSend, reachedLevel, stepOf } from './silence';

const now = new Date('2026-11-10T14:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

describe('escada de silêncio', () => {
  it('só sobe de degrau depois dos dias de cada um', () => {
    expect([0, 2, 3, 5, 6, 9, 10, 20, 21, 40].map(reachedLevel)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 4, 4,
    ]);
  });

  it('dentro do normal não manda nada', () => {
    expect(
      levelToSend({ daysSilent: 2, lastSignalAt: daysAgo(2), outreaches: [], now }),
    ).toBeNull();
  });

  it('manda o degrau 1 primeiro, mesmo que o aluno já esteja além dos 6 dias', () => {
    expect(levelToSend({ daysSilent: 7, lastSignalAt: daysAgo(7), outreaches: [], now })).toBe(1);
  });

  it('um degrau só sai uma vez por episódio de silêncio', () => {
    const outreaches = [{ level: 1, sentAt: daysAgo(3) }];
    expect(levelToSend({ daysSilent: 4, lastSignalAt: daysAgo(4), outreaches, now })).toBeNull();
    expect(levelToSend({ daysSilent: 6, lastSignalAt: daysAgo(6), outreaches, now })).toBe(2);
  });

  it('o aluno dar sinal reinicia o episódio', () => {
    const outreaches = [
      { level: 1, sentAt: daysAgo(12) },
      { level: 2, sentAt: daysAgo(9) },
    ];
    // Deu sinal há 4 dias: os contatos de antes não contam mais.
    expect(levelToSend({ daysSilent: 4, lastSignalAt: daysAgo(4), outreaches, now })).toBe(1);
  });

  it('nunca manda dois contatos em menos de 2 dias', () => {
    const outreaches = [{ level: 1, sentAt: daysAgo(1) }];
    expect(levelToSend({ daysSilent: 6, lastSignalAt: daysAgo(6), outreaches, now })).toBeNull();
  });

  it('depois do degrau 4 não insiste', () => {
    const outreaches = [{ level: 4, sentAt: daysAgo(5) }];
    expect(levelToSend({ daysSilent: 30, lastSignalAt: daysAgo(30), outreaches, now })).toBeNull();
  });

  it('sem sinal algum registrado, os contatos já enviados contam no episódio', () => {
    const outreaches = [{ level: 1, sentAt: daysAgo(4) }];
    expect(levelToSend({ daysSilent: 6, lastSignalAt: null, outreaches, now })).toBe(2);
  });

  it('cada degrau tem abordagens próprias e dias entre datas são inteiros', () => {
    expect(stepOf(4).strategies).toEqual(['OPEN_DOOR']);
    expect(stepOf(2).strategies).toContain('MINIMUM_VERSION');
    expect(daysBetween('2026-11-01', '2026-11-10')).toBe(9);
    expect(daysBetween('2026-11-10', '2026-11-01')).toBe(0);
  });
});
