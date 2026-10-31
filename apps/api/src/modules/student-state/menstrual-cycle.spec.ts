import { describe, expect, it } from 'vitest';

import { cycleView, parseCycleMessage } from './menstrual-cycle';

const TODAY = '2026-10-31';

describe('parseCycleMessage', () => {
  it('reconhece as frases fixas com ou sem acento e pontuação', () => {
    expect(parseCycleMessage('autorizo ciclo.', TODAY)).toEqual({ kind: 'AUTHORIZE' });
    expect(parseCycleMessage('  Revogar   CICLO! ', TODAY)).toEqual({ kind: 'REVOKE' });
  });

  it('lê o início relatado e a data', () => {
    expect(parseCycleMessage('Menstruei hoje', TODAY)).toEqual({
      kind: 'LOG',
      onDate: TODAY,
      question: false,
    });
    expect(parseCycleMessage('minha menstruação veio ontem', TODAY)).toMatchObject({
      onDate: '2026-10-30',
    });
    expect(parseCycleMessage('menstruei anteontem', TODAY)).toMatchObject({
      onDate: '2026-10-29',
    });
    expect(parseCycleMessage('menstruei dia 28', TODAY)).toMatchObject({ onDate: '2026-10-28' });
    // "dia 30" ainda não chegou neste mês: é o do mês anterior.
    expect(parseCycleMessage('fiquei menstruada dia 30', '2026-10-05')).toMatchObject({
      onDate: '2026-09-30',
    });
    expect(parseCycleMessage('estou menstruada, posso treinar?', TODAY)).toMatchObject({
      question: true,
    });
  });

  it('ignora o que não é registro', () => {
    expect(parseCycleMessage('treino de hoje feito', TODAY)).toBeNull();
    expect(parseCycleMessage(`menstruei hoje ${'e '.repeat(100)}`, TODAY)).toBeNull();
    // "dia 30" no futuro deste mês e fevereiro sem dia 30.
    expect(parseCycleMessage('menstruei dia 30', '2026-03-01')).toBeNull();
  });
});

describe('cycleView', () => {
  it('sem registro não há fatia', () => {
    expect(cycleView([], TODAY)).toBeNull();
  });

  it('estima dia e fase pelo comprimento típico das últimas menstruações', () => {
    const starts = ['2026-08-10', '2026-09-09', '2026-10-09'];
    expect(cycleView(starts, '2026-10-11')).toEqual({
      lastStart: '2026-10-09',
      cycleDay: 3,
      typicalLength: 30,
      phase: 'MENSTRUAL',
    });
    expect(cycleView(starts, '2026-10-16')?.phase).toBe('FOLLICULAR');
    expect(cycleView(starts, '2026-10-24')?.phase).toBe('OVULATORY');
    expect(cycleView(starts, '2026-10-31')?.phase).toBe('LUTEAL');
  });

  it('não especula a fase quando a menstruação atrasou muito', () => {
    expect(cycleView(['2026-09-01'], TODAY)).toMatchObject({ cycleDay: 61, phase: null });
  });
});
